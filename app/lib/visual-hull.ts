interface VisualHullResult {
  volumeMl: number;
  occupied: number;
  total: number;
  voxelMm: number;
  frameCount: number;
  duration: number;
}

async function seek(video: HTMLVideoElement, time: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("動画フレームを読み取れません。")); };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = Math.max(0, Math.min(video.duration - 0.02, time));
  });
}

async function extractMasks(file: File, count = 12): Promise<{ masks: Uint8Array[]; width: number; height: number; duration: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("動画を読み込めませんでした。"));
    });
    if (!Number.isFinite(video.duration) || video.duration < 5) throw new Error("Visual Hullには5秒以上の動画が必要です。");
    const width = 96;
    const height = 96;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("動画処理を開始できません。");
    const masks: Uint8Array[] = [];
    for (let index = 0; index < count; index += 1) {
      await seek(video, (video.duration * (index + 0.5)) / count);
      context.drawImage(video, 0, 0, width, height);
      const rgba = context.getImageData(0, 0, width, height).data;
      const mask = new Uint8Array(width * height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const source = (y * width + x) * 4;
          const r = rgba[source] / 255;
          const g = rgba[source + 1] / 255;
          const b = rgba[source + 2] / 255;
          const maximum = Math.max(r, g, b);
          const minimum = Math.min(r, g, b);
          const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
          const luminance = r * 0.299 + g * 0.587 + b * 0.114;
          const inCenter = x > width * 0.12 && x < width * 0.88;
          mask[y * width + x] = inCenter && (saturation > 0.11 || (luminance > 0.12 && luminance < 0.82)) ? 1 : 0;
        }
      }
      masks.push(mask);
    }
    return { masks, width, height, duration: video.duration };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

export async function runVisualHull(params: {
  file: File;
  dimensions: { length: number; width: number; height: number };
  voxelMm: number;
  viewCoverageDeg: number;
  onProgress: (progress: number) => void;
}): Promise<VisualHullResult> {
  const extracted = await extractMasks(params.file, 12);
  const worker = new Worker("/workers/visual-hull-worker.js");
  return await new Promise<VisualHullResult>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ type: string; progress?: number; error?: string; volumeMl?: number; occupied?: number; total?: number; voxelMm?: number }>) => {
      if (event.data.type === "progress") params.onProgress(event.data.progress ?? 0);
      if (event.data.type === "error") {
        worker.terminate();
        reject(new Error(event.data.error ?? "Visual Hull処理に失敗しました。"));
      }
      if (event.data.type === "complete") {
        worker.terminate();
        resolve({
          volumeMl: event.data.volumeMl ?? 0,
          occupied: event.data.occupied ?? 0,
          total: event.data.total ?? 0,
          voxelMm: event.data.voxelMm ?? params.voxelMm,
          frameCount: extracted.masks.length,
          duration: extracted.duration,
        });
      }
    };
    worker.onerror = () => { worker.terminate(); reject(new Error("Visual Hull Workerを開始できません。")); };
    worker.postMessage({
      dimensions: params.dimensions,
      voxelMm: params.voxelMm,
      masks: extracted.masks,
      maskWidth: extracted.width,
      maskHeight: extracted.height,
      viewCoverageDeg: params.viewCoverageDeg,
    });
  });
}
