import type { CropRect } from "../types/domain";

export interface ImagePayload {
  mimeType: string;
  base64: string;
}

export async function cropImageFile(file: File, crop: CropRect, maxSize = 1280): Promise<ImagePayload> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("画像を読み込めませんでした。"));
      element.src = url;
    });
    const sourceX = Math.round(image.naturalWidth * crop.x);
    const sourceY = Math.round(image.naturalHeight * crop.y);
    const sourceWidth = Math.max(1, Math.round(image.naturalWidth * crop.width));
    const sourceHeight = Math.max(1, Math.round(image.naturalHeight * crop.height));
    const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像の切り抜きに失敗しました。");
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    return { mimeType: "image/jpeg", base64: dataUrl.split(",")[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}
