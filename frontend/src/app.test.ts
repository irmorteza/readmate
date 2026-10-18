import { describe, expect, it, vi } from "vitest";
import example from "../../contract/example.json";
import {
  createController,
  errorMessage,
  initialState,
  isEmptyResult,
  type ControllerDeps,
} from "./app";
import type { OcrResult } from "./contract";
import { AppError } from "./errors";
import { emptyResult } from "./test-fixtures";

const result = example as OcrResult;
const prepared = { blob: new Blob(["jpeg"]), width: 10, height: 10 };

function makeDeps(overrides: Partial<ControllerDeps> = {}) {
  let token: string | null = "tok";
  const deps: ControllerDeps = {
    prepareImage: vi.fn().mockResolvedValue(prepared),
    postOcr: vi.fn().mockResolvedValue(result),
    getToken: () => token,
    saveToken: vi.fn((raw: string) => {
      token = raw.trim() || null;
      return token;
    }),
    clearToken: vi.fn(() => {
      token = null;
    }),
    isOnline: () => true,
    createObjectURL: () => "blob:preview",
    ...overrides,
  };
  return deps;
}

const file = new File(["x"], "a.jpg");

describe("initialState", () => {
  it("needs a token when none is stored", () => {
    expect(initialState(null).kind).toBe("needsToken");
  });
  it("starts idle when a token exists", () => {
    expect(initialState("tok").kind).toBe("idle");
  });
});

describe("errorMessage", () => {
  it.each([
    ["offline", "No internet connection. Scanning needs internet."],
    ["unauthorized", "Token rejected"],
    ["unreadable", "Couldn't read this image. Try another photo."],
    ["busy", "Service busy, try again in a moment."],
    ["generic", "Something went wrong. Try again."],
  ] as const)("%s", (kind, message) => {
    expect(errorMessage(new AppError(kind))).toBe(message);
  });
});

describe("controller", () => {
  it("saving a token moves needsToken to idle", () => {
    const c = createController(makeDeps({ getToken: () => null }));
    expect(c.getState().kind).toBe("needsToken");
    c.saveToken("  new  ");
    expect(c.getState().kind).toBe("idle");
  });

  it("an empty token stays on needsToken", () => {
    const c = createController(makeDeps({ getToken: () => null }));
    c.saveToken("  ");
    expect(c.getState().kind).toBe("needsToken");
  });

  it("walks idle -> resizing -> uploading -> result", async () => {
    const c = createController(makeDeps());
    const seen: string[] = [];
    c.subscribe((s) => seen.push(s.kind));
    await c.chooseFile(file);
    expect(seen).toEqual(["resizing", "uploading", "result"]);
    const state = c.getState();
    expect(state.kind === "result" && state.result).toEqual(result);
  });

  it("an empty words list is a result flagged as empty", async () => {
    const c = createController(makeDeps({ postOcr: vi.fn().mockResolvedValue(emptyResult) }));
    await c.chooseFile(file);
    const state = c.getState();
    expect(state.kind).toBe("result");
    expect(state.kind === "result" && isEmptyResult(state.result)).toBe(true);
  });

  it("a rejected token becomes an unauthorized error and can reset the token", async () => {
    const deps = makeDeps({ postOcr: vi.fn().mockRejectedValue(new AppError("unauthorized")) });
    const c = createController(deps);
    await c.chooseFile(file);
    const state = c.getState();
    expect(state.kind === "error" && state.error.kind).toBe("unauthorized");
    c.resetToken();
    expect(deps.clearToken).toHaveBeenCalled();
    expect(c.getState().kind).toBe("needsToken");
  });

  it("offline before sending fails without calling fetch", async () => {
    const deps = makeDeps({ isOnline: () => false });
    const c = createController(deps);
    await c.chooseFile(file);
    const state = c.getState();
    expect(state.kind === "error" && state.error.kind).toBe("offline");
    expect(deps.postOcr).not.toHaveBeenCalled();
  });

  it("Try again re-sends the same blob", async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(new AppError("generic"))
      .mockResolvedValueOnce(result);
    const c = createController(makeDeps({ postOcr: post }));
    await c.chooseFile(file);
    expect(c.getState().kind).toBe("error");
    await c.retry();
    expect(c.getState().kind).toBe("result");
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toBe(post.mock.calls[1][0]);
    expect(post.mock.calls[0][0]).toBe(prepared.blob);
  });

  it("a decode failure shows the unreadable message and never uploads", async () => {
    const deps = makeDeps({ prepareImage: vi.fn().mockRejectedValue(new AppError("unreadable")) });
    const c = createController(deps);
    await c.chooseFile(file);
    const state = c.getState();
    expect(state.kind === "error" && errorMessage(state.error)).toBe(
      "Couldn't read this image. Try another photo.",
    );
    expect(deps.postOcr).not.toHaveBeenCalled();
    await c.retry(); // nothing to re-send: stays an error
    expect(c.getState().kind).toBe("error");
  });

  it("a non-AppError failure is reported as generic", async () => {
    const c = createController(makeDeps({ postOcr: vi.fn().mockRejectedValue(new Error("boom")) }));
    await c.chooseFile(file);
    const state = c.getState();
    expect(state.kind === "error" && state.error.kind).toBe("generic");
  });

  it("New photo returns to idle", async () => {
    const c = createController(makeDeps());
    await c.chooseFile(file);
    c.newPhoto();
    expect(c.getState().kind).toBe("idle");
  });
});

describe("last result", () => {
  it("has none initially", () => {
    expect(createController(makeDeps()).hasLastResult()).toBe(false);
  });

  it("is kept after New photo", async () => {
    const c = createController(makeDeps());
    await c.chooseFile(file);
    c.newPhoto();
    expect(c.getState().kind).toBe("idle");
    expect(c.hasLastResult()).toBe(true);
  });

  it("showLastResult returns to the result state with the same result and image", async () => {
    const c = createController(makeDeps());
    await c.chooseFile(file);
    const first = c.getState();
    c.newPhoto();
    c.showLastResult();
    const state = c.getState();
    expect(state.kind).toBe("result");
    expect(state.kind === "result" && state.result).toBe(first.kind === "result" && first.result);
    expect(state.kind === "result" && state.imageUrl).toBe("blob:preview");
  });

  it("showLastResult without a result is a no-op", () => {
    const c = createController(makeDeps());
    c.showLastResult();
    expect(c.getState().kind).toBe("idle");
  });

  it("is forgotten when the token is reset", async () => {
    const c = createController(makeDeps());
    await c.chooseFile(file);
    c.resetToken();
    expect(c.hasLastResult()).toBe(false);
    c.showLastResult();
    expect(c.getState().kind).toBe("needsToken");
  });

  it("is replaced by a newer result", async () => {
    const second = { ...result, engine: "second" } as OcrResult;
    const post = vi.fn().mockResolvedValueOnce(result).mockResolvedValueOnce(second);
    const c = createController(makeDeps({ postOcr: post }));
    await c.chooseFile(file);
    c.newPhoto();
    await c.chooseFile(file);
    c.newPhoto();
    c.showLastResult();
    const state = c.getState();
    expect(state.kind === "result" && state.result.engine).toBe("second");
  });
});

describe("leaving a scan", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("a result that arrives after New photo does not change the screen", async () => {
    const slow = deferred<OcrResult>();
    const c = createController(makeDeps({ postOcr: vi.fn().mockReturnValue(slow.promise) }));
    const scan = c.chooseFile(file);
    await tick();
    c.newPhoto();
    slow.resolve(result);
    await scan;
    expect(c.getState().kind).toBe("idle");
    expect(c.hasLastResult()).toBe(false);
  });

  it("a scan that finishes while the user re-reads the previous page is dropped", async () => {
    const second = deferred<OcrResult>();
    const post = vi.fn().mockResolvedValueOnce(result).mockReturnValueOnce(second.promise);
    const c = createController(makeDeps({ postOcr: post }));
    await c.chooseFile(file); // page 1
    const first = c.getState();
    c.newPhoto();
    const scan = c.chooseFile(file); // page 2 starts
    await tick();
    c.showLastResult(); // the user goes back to page 1
    second.resolve({ ...result, engine: "second" } as OcrResult);
    await scan;
    expect(c.getState()).toBe(first);
    c.newPhoto();
    c.showLastResult();
    const state = c.getState();
    expect(state.kind === "result" && state.result.engine).toBe(result.engine);
  });

  it("the newest scan wins even when an older one finishes last", async () => {
    const a = deferred<OcrResult>();
    const b = deferred<OcrResult>();
    const post = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const c = createController(makeDeps({ postOcr: post }));
    const scanA = c.chooseFile(file);
    await tick();
    c.newPhoto();
    const scanB = c.chooseFile(file);
    await tick();
    b.resolve({ ...result, engine: "B" } as OcrResult);
    await scanB;
    a.resolve({ ...result, engine: "A" } as OcrResult);
    await scanA;
    const state = c.getState();
    expect(state.kind === "result" && state.result.engine).toBe("B");
    c.newPhoto();
    c.showLastResult();
    const last = c.getState();
    expect(last.kind === "result" && last.result.engine).toBe("B");
  });

  it("a failure that arrives after leaving does not show an error screen", async () => {
    const slow = deferred<OcrResult>();
    const c = createController(makeDeps({ postOcr: vi.fn().mockReturnValue(slow.promise) }));
    const scan = c.chooseFile(file);
    await tick();
    c.newPhoto();
    slow.reject(new AppError("generic"));
    await scan;
    expect(c.getState().kind).toBe("idle");
  });

  it("an image that finishes resizing after leaving is not uploaded", async () => {
    const resizing = deferred<{ blob: Blob; width: number; height: number }>();
    const deps = makeDeps({ prepareImage: vi.fn().mockReturnValue(resizing.promise) });
    const c = createController(deps);
    const scan = c.chooseFile(file);
    await tick();
    c.newPhoto();
    resizing.resolve(prepared);
    await scan;
    expect(deps.postOcr).not.toHaveBeenCalled();
    expect(c.getState().kind).toBe("idle");
  });

  it("resetting the token abandons a running scan", async () => {
    const slow = deferred<OcrResult>();
    const c = createController(makeDeps({ postOcr: vi.fn().mockReturnValue(slow.promise) }));
    const scan = c.chooseFile(file);
    await tick();
    c.resetToken();
    slow.resolve(result);
    await scan;
    expect(c.getState().kind).toBe("needsToken");
    expect(c.hasLastResult()).toBe(false);
  });
});
