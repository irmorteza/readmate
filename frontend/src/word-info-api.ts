import {
  isWordInfoResponse,
  type WordInfoRequest,
  type WordInfoResponse,
} from "./word-info-contract";

/** Matches the 30 s Lambda timeout (spec §10.3). */
export const TIMEOUT_MS = 35_000;

export type LookupFailure = "unauthorized" | "limit" | "busy" | "offline" | "unavailable";

/** Kept apart from the OCR AppError/ErrorKind so lookup failures never reach the OCR screens. */
export class WordLookupError extends Error {
  constructor(readonly kind: LookupFailure) {
    super(kind);
    this.name = "WordLookupError";
  }
}

async function failureForStatus(response: Response): Promise<WordLookupError> {
  const { status } = response;
  if (status === 401) return new WordLookupError("unauthorized");
  if (status === 429) {
    const code = await response
      .json()
      .then((body: any) => body?.error?.code)
      .catch(() => undefined);
    return new WordLookupError(code === "DAILY_LIMIT" ? "limit" : "busy");
  }
  // 400 (old backend, after its token check), 404, 405 and server errors all mean no lookup.
  return new WordLookupError("unavailable");
}

export async function postWordInfo(
  request: WordInfoRequest,
  token: string,
  signal?: AbortSignal,
): Promise<WordInfoResponse> {
  const base = String(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort());

  let response: Response;
  try {
    response = await fetch(`${base}/v1/word-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pilot-Token": token },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new WordLookupError("unavailable");
    }
    throw new WordLookupError("offline");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw await failureForStatus(response);

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new WordLookupError("unavailable");
  }
  if (!isWordInfoResponse(data, request.sentence.words.length)) {
    throw new WordLookupError("unavailable");
  }
  return data;
}
