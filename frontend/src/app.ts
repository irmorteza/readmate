import type { OcrResult } from "./contract";
import { AppError } from "./errors";
import type { PreparedImage } from "./image";

export type State =
  | { kind: "needsToken" }
  | { kind: "idle" }
  | { kind: "resizing" }
  | { kind: "uploading"; blob: Blob; imageUrl: string }
  | { kind: "result"; blob: Blob; imageUrl: string; result: OcrResult }
  | { kind: "error"; error: AppError; blob?: Blob; imageUrl?: string };

export interface ControllerDeps {
  prepareImage(file: File): Promise<PreparedImage>;
  postOcr(blob: Blob, token: string): Promise<OcrResult>;
  getToken(): string | null;
  saveToken(raw: string): string | null;
  clearToken(): void;
  isOnline(): boolean;
  createObjectURL(blob: Blob): string;
}

export interface Controller {
  getState(): State;
  subscribe(fn: (state: State) => void): () => void;
  saveToken(raw: string): void;
  resetToken(): void;
  chooseFile(file: File): Promise<void>;
  retry(): Promise<void>;
  newPhoto(): void;
  /** True once a result exists; it survives New photo and is dropped when the token is reset. */
  hasLastResult(): boolean;
  showLastResult(): void;
}

export const NO_TEXT_MESSAGE =
  "No text found — try more light and hold the phone parallel to the page.";

export function initialState(token: string | null): State {
  return token ? { kind: "idle" } : { kind: "needsToken" };
}

export function isEmptyResult(result: OcrResult): boolean {
  return result.words.length === 0;
}

export function errorMessage(error: AppError): string {
  switch (error.kind) {
    case "offline":
      return "No internet connection. Scanning needs internet.";
    case "unauthorized":
      return "Token rejected";
    case "unreadable":
      return "Couldn't read this image. Try another photo.";
    case "busy":
      return "Service busy, try again in a moment.";
    default:
      return "Something went wrong. Try again.";
  }
}

const toAppError = (e: unknown): AppError => (e instanceof AppError ? e : new AppError("generic"));

export function createController(deps: ControllerDeps): Controller {
  let state: State = initialState(deps.getToken());
  const subscribers = new Set<(state: State) => void>();
  let lastResult: Extract<State, { kind: "result" }> | null = null;
  // Bumped whenever the user leaves or starts a scan; a scan that finishes under an older number
  // was abandoned and must not touch the screen or the stored result.
  let generation = 0;
  const set = (next: State) => {
    state = next;
    subscribers.forEach((fn) => fn(state));
  };

  async function upload(blob: Blob, imageUrl: string, scan: number): Promise<void> {
    set({ kind: "uploading", blob, imageUrl });
    if (!deps.isOnline()) {
      set({ kind: "error", error: new AppError("offline"), blob, imageUrl });
      return;
    }
    try {
      const result = await deps.postOcr(blob, deps.getToken() ?? "");
      if (scan !== generation) return;
      lastResult = { kind: "result", blob, imageUrl, result };
      set(lastResult);
    } catch (e) {
      if (scan !== generation) return;
      set({ kind: "error", error: toAppError(e), blob, imageUrl });
    }
  }

  return {
    getState: () => state,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    saveToken(raw) {
      if (deps.saveToken(raw)) set({ kind: "idle" });
    },
    resetToken() {
      deps.clearToken();
      generation++;
      lastResult = null;
      set({ kind: "needsToken" });
    },
    async chooseFile(file) {
      const scan = ++generation;
      set({ kind: "resizing" });
      let prepared: PreparedImage;
      try {
        prepared = await deps.prepareImage(file);
      } catch (e) {
        if (scan !== generation) return;
        set({ kind: "error", error: toAppError(e) });
        return;
      }
      if (scan !== generation) return;
      await upload(prepared.blob, deps.createObjectURL(prepared.blob), scan);
    },
    async retry() {
      if (state.kind !== "error" || !state.blob || !state.imageUrl) return;
      await upload(state.blob, state.imageUrl, ++generation);
    },
    newPhoto() {
      generation++;
      set({ kind: "idle" });
    },
    hasLastResult: () => lastResult !== null,
    showLastResult() {
      if (!lastResult) return;
      generation++;
      set(lastResult);
    },
  };
}
