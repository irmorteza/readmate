import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import example from "../../contract/word-info.example.json";
import { postWordInfo, TIMEOUT_MS, WordLookupError, type LookupFailure } from "./word-info-api";
import type { WordInfoRequest } from "./word-info-contract";

const request = example.request as WordInfoRequest;

function respond(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

async function failure(): Promise<WordLookupError> {
  const err = await postWordInfo(request, "tok").catch((e) => e);
  expect(err).toBeInstanceOf(WordLookupError);
  return err;
}

beforeEach(() => vi.stubEnv("VITE_API_URL", "http://api.test/"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("postWordInfo", () => {
  it("returns the response on success", async () => {
    vi.stubGlobal("fetch", respond(200, example.response));
    expect(await postWordInfo(request, "tok")).toEqual(example.response);
  });

  it("posts the request as JSON with exactly the two headers", async () => {
    const fetchMock = respond(200, example.response);
    vi.stubGlobal("fetch", fetchMock);
    await postWordInfo(request, "tok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/v1/word-info");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "X-Pilot-Token": "tok" });
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it("uses a 35 s timeout", () => expect(TIMEOUT_MS).toBe(35_000));

  it.each<[number, unknown, LookupFailure]>([
    [401, {}, "unauthorized"],
    [429, { error: { code: "DAILY_LIMIT" } }, "limit"],
    [429, { error: { code: "BUSY" } }, "busy"],
    [429, "<html>throttled</html>", "busy"],
    [400, {}, "unavailable"],
    [404, {}, "unavailable"],
    [405, {}, "unavailable"],
    [500, {}, "unavailable"],
    [502, {}, "unavailable"],
    [503, {}, "unavailable"],
    [400, { error: { code: "BAD_REQUEST" } }, "unavailable"],
  ])("maps %s %j to %s", async (status, body, kind) => {
    vi.stubGlobal("fetch", respond(status, body));
    expect((await failure()).kind).toBe(kind);
  });

  it("treats a 200 that fails the guard as unavailable", async () => {
    const bad = structuredClone(example.response) as Record<string, any>;
    bad.separableVerb = { infinitive: "x", wordIndexes: [1, 99] };
    vi.stubGlobal("fetch", respond(200, bad));
    expect((await failure()).kind).toBe("unavailable");
  });

  it("treats a 200 with a non-JSON body as unavailable", async () => {
    vi.stubGlobal("fetch", respond(200, "not json"));
    expect((await failure()).kind).toBe("unavailable");
  });

  it("maps a network failure to offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect((await failure()).kind).toBe("offline");
  });

  it("aborts after the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
        ),
      ),
    );
    const pending = postWordInfo(request, "tok").catch((e) => e);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    await vi.advanceTimersByTimeAsync(1);
    const err = await pending;
    expect(err).toBeInstanceOf(WordLookupError);
    expect(err.kind).toBe("unavailable");
  });

  it("maps an external abort to unavailable", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
        ),
      ),
    );
    const pending = postWordInfo(request, "tok", controller.signal).catch((e) => e);
    controller.abort();
    expect((await pending).kind).toBe("unavailable");
  });
});
