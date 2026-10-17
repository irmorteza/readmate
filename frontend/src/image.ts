import { AppError } from "./errors";

const MAX_EDGE = 2000;
const MAX_BYTES = 4 * 1024 * 1024;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

export function computeTargetSize(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AppError("unreadable", "The browser could not decode this image."));
    };
    img.src = url;
  });
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new AppError("unreadable", "JPEG export failed."))),
      "image/jpeg",
      quality,
    ),
  );
}

/** Loads (EXIF-oriented by the browser), downsizes to a long edge of 2000 px and exports JPEG. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const img = await loadImage(file);
  const { width, height } = computeTargetSize(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AppError("generic", "Canvas is not available.");
  ctx.drawImage(img, 0, 0, width, height);
  let blob = await toJpeg(canvas, 0.85);
  if (blob.size > MAX_BYTES) blob = await toJpeg(canvas, 0.7);
  return { blob, width, height };
}
