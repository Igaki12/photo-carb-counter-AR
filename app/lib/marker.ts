import type { CropRect } from "../types/domain";

export interface TagDetection {
  id: number;
  corners: Array<{ x: number; y: number }>;
  center: { x: number; y: number };
  pose?: { e?: number };
}

export interface MarkerImageResult {
  width: number;
  height: number;
  detections: TagDetection[];
  reprojectionErrorPx: number;
  pixelsPerMm: number;
}

const TAG_CENTERS: Record<number, [number, number]> = {
  0: [24, 24],
  1: [273, 24],
  2: [273, 186],
  3: [24, 186],
};
const TAG_SIZE_MM = 24;

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: (value: TagDetection[]) => void; reject: (error: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker("/workers/apriltag-worker.js");
  worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; detections?: TagDetection[]; error?: string }>) => {
    const callback = pending.get(event.data.id);
    if (!callback) return;
    pending.delete(event.data.id);
    if (event.data.ok) callback.resolve(event.data.detections ?? []);
    else callback.reject(new Error(event.data.error ?? "AprilTag検出に失敗しました。"));
  };
  return worker;
}

async function imageDataFromFile(file: File): Promise<{ imageData: ImageData; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("画像処理を開始できません。");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { imageData: context.getImageData(0, 0, width, height), width, height };
}

export async function detectAprilTags(file: File): Promise<MarkerImageResult> {
  const { imageData, width, height } = await imageDataFromFile(file);
  const id = ++requestId;
  const detections = await new Promise<TagDetection[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({
      id,
      type: "detect",
      rgba: imageData.data,
      width,
      height,
      camera: { fx: Math.max(width, height) * 0.92, fy: Math.max(width, height) * 0.92, cx: width / 2, cy: height / 2 },
    }, [imageData.data.buffer]);
  });
  const valid = detections.filter((item) => item.id in TAG_CENTERS);
  const edges = valid.flatMap((item) => item.corners.map((corner, index) => distance(corner, item.corners[(index + 1) % 4])));
  const pixelsPerMm = edges.length ? edges.reduce((sum, value) => sum + value, 0) / edges.length / TAG_SIZE_MM : 0;
  const poseErrors = valid.map((item) => Math.sqrt(Math.max(0, Number(item.pose?.e ?? 0))) * Math.max(width, height));
  return {
    width,
    height,
    detections: valid,
    reprojectionErrorPx: poseErrors.length ? poseErrors.reduce((sum, value) => sum + value, 0) / poseErrors.length : 99,
    pixelsPerMm,
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function solveLinear(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 1e-10) throw new Error("マーカー配置から座標変換を求められません。");
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  return augmented.map((row) => row[size]);
}

function homography(source: Array<[number, number]>, target: Array<[number, number]>): number[] {
  const ata = Array.from({ length: 8 }, () => Array(8).fill(0));
  const atb = Array(8).fill(0);
  source.forEach(([x, y], index) => {
    const [u, v] = target[index];
    const rows = [
      { a: [x, y, 1, 0, 0, 0, -u * x, -u * y], b: u },
      { a: [0, 0, 0, x, y, 1, -v * x, -v * y], b: v },
    ];
    for (const row of rows) {
      for (let i = 0; i < 8; i += 1) {
        atb[i] += row.a[i] * row.b;
        for (let j = 0; j < 8; j += 1) ata[i][j] += row.a[i] * row.a[j];
      }
    }
  });
  return [...solveLinear(ata, atb), 1];
}

function applyHomography(h: number[], x: number, y: number): [number, number] {
  const denominator = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / denominator, (h[3] * x + h[4] * y + h[5]) / denominator];
}

function correspondences(detections: TagDetection[]): { image: Array<[number, number]>; world: Array<[number, number]> } {
  const image: Array<[number, number]> = [];
  const world: Array<[number, number]> = [];
  for (const detection of detections) {
    const center = TAG_CENTERS[detection.id];
    if (!center || detection.corners.length !== 4) continue;
    const half = TAG_SIZE_MM / 2;
    const worldCorners: Array<[number, number]> = [
      [center[0] - half, center[1] - half],
      [center[0] + half, center[1] - half],
      [center[0] + half, center[1] + half],
      [center[0] - half, center[1] + half],
    ];
    detection.corners.forEach((corner, index) => {
      image.push([corner.x, corner.y]);
      world.push(worldCorners[index]);
    });
  }
  return { image, world };
}

export function measureCropOnMat(result: MarkerImageResult, crop: CropRect): { length: number; width: number; area: number; reprojectionErrorPx: number } {
  const points = correspondences(result.detections);
  if (points.image.length < 12) throw new Error("計測には3個以上のタグが必要です。");
  const imageToWorld = homography(points.image, points.world);
  const worldToImage = homography(points.world, points.image);
  const left = crop.x * result.width;
  const top = crop.y * result.height;
  const right = (crop.x + crop.width) * result.width;
  const bottom = (crop.y + crop.height) * result.height;
  const corners = [
    applyHomography(imageToWorld, left, top),
    applyHomography(imageToWorld, right, top),
    applyHomography(imageToWorld, right, bottom),
    applyHomography(imageToWorld, left, bottom),
  ];
  const length = (distance({ x: corners[0][0], y: corners[0][1] }, { x: corners[1][0], y: corners[1][1] }) + distance({ x: corners[3][0], y: corners[3][1] }, { x: corners[2][0], y: corners[2][1] })) / 2;
  const width = (distance({ x: corners[0][0], y: corners[0][1] }, { x: corners[3][0], y: corners[3][1] }) + distance({ x: corners[1][0], y: corners[1][1] }, { x: corners[2][0], y: corners[2][1] })) / 2;
  const area = Math.abs(corners.reduce((sum, point, index) => {
    const next = corners[(index + 1) % corners.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
  const pixelErrors = points.world.map((point, index) => {
    const projected = applyHomography(worldToImage, point[0], point[1]);
    return Math.hypot(projected[0] - points.image[index][0], projected[1] - points.image[index][1]);
  });
  return {
    length: Math.round(length),
    width: Math.round(width),
    area: Math.round(area),
    reprojectionErrorPx: Math.round((pixelErrors.reduce((sum, value) => sum + value, 0) / pixelErrors.length) * 100) / 100,
  };
}

export function estimateHeightFromMarkerImage(result: MarkerImageResult, baseYRatio: number, topYRatio: number): number {
  if (!result.pixelsPerMm) return 0;
  return Math.round(Math.abs(baseYRatio - topYRatio) * result.height / result.pixelsPerMm);
}
