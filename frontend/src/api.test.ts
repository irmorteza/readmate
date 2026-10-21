import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import example from "../../contract/example.json";
import { postOcr } from "./api";
import { AppError, type ErrorKind } from "./errors";

const blob = new Blob(["jpeg"], { type: "image/jpeg" });

function respond(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

async function failure(): Promise<AppError> {
  const err = await postOcr(blob, "tok").catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  return err;
}

beforeEach(() => vi.stubEnv("VITE_API_URL", "http://api.test/"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("postOcr", () => {
  it("returns the parsed result on success", async () => {
    vi.stubGlobal("fetch", respond(200, example));
    expect(await postOcr(blob, "tok")).toEqual(example);
  });

  it("accepts a response whose sentences are malformed, keeping the words", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = structuredClone(example) as Record<string, any>;
    body.sentences[0].kind = "bogus";
    vi.stubGlobal("fetch", respond(200, body));
    const result = await postOcr(blob, "tok");
    expect(result.words).toEqual(example.words);
    expect(result.sentences).toBeUndefined();
  });

  it("sends token and content type to <base>/ocr", async () => {
    const fetchMock = respond(200, example);
    vi.stubGlobal("fetch", fetchMock);
    await postOcr(blob, "tok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/ocr");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("image/jpeg");
    expect(init.headers["X-Pilot-Token"]).toBe("tok");
    expect(init.body).toBe(blob);
  });

  it.each<[number, ErrorKind]>([
    [401, "unauthorized"],
    [413, "unreadable"],
    [422, "unreadable"],
    [429, "busy"],
    [400, "generic"],
    [500, "generic"],
    [502, "generic"],
  ])("maps HTTP %i to %s using the status only", async (status, kind) => {
    vi.stubGlobal("fetch", respond(status, "<html>not our error shape</html>"));
    expect((await failure()).kind).toBe(kind);
  });

  it("maps a network failure to offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect((await failure()).kind).toBe("offline");
  });

  it("maps invalid JSON on 200 to generic", async () => {
    vi.stubGlobal("fetch", respond(200, "not json"));
    expect((await failure()).kind).toBe("generic");
  });

  it("maps a 200 body that fails isOcrResult to generic", async () => {
    vi.stubGlobal("fetch", respond(200, { version: 1 }));
    expect((await failure()).kind).toBe("generic");
  });

  it("aborts after 20 s and reports generic", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      ),
    );
    const pending = postOcr(blob, "tok").catch((e) => e);
    await vi.advanceTimersByTimeAsync(19_999);
    let settled = false;
    pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const err = await pending;
    expect(err).toBeInstanceOf(AppError);
    expect(err.kind).toBe("generic");
  });
});
