import { isOcrResult, type OcrResult } from "./contract";
import { AppError } from "./errors";

const TIMEOUT_MS = 20_000;

function errorForStatus(status: number): AppError {
  // Map by status only: the Function URL itself can answer with bodies in a different shape.
  if (status === 401) return new AppError("unauthorized");
  if (status === 413 || status === 422) return new AppError("unreadable");
  if (status === 429) return new AppError("busy");
  return new AppError("generic");
}

export async function postOcr(blob: Blob, token: string, signal?: AbortSignal): Promise<OcrResult> {
  const base = String(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort());

  let response: Response;
  try {
    response = await fetch(`${base}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "X-Pilot-Token": token },
      body: blob,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw new AppError("generic");
    throw new AppError("offline");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw errorForStatus(response.status);

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AppError("generic");
  }
  if (!isOcrResult(data)) throw new AppError("generic");
  return data;
}
