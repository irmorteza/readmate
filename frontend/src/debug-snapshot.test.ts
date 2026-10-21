import { expect, it, vi } from "vitest";
import { parseOcrResult } from "./contract";
import { snap } from "./debug-test-helpers";
import { gappedResult, sentenceResult } from "./test-fixtures";

it("describes a word with a sentence", () => {
  expect(snap(sentenceResult, 9)).toEqual({
    format: "readmate-debug/1", build: "abc1234", engine: "fake",
    word: { id: 9, text: "war" },
    sentenceStatus: "ok",
    sentence: { id: 0, kind: "sentence", text: "Vorstellungskraft war", wordIds: [2, 9], wordIndex: 1 },
    lineTexts: ["Das Vorstel- war"],
    lookup: { request: { word: "war", context: "Vorstellungskraft war" }, contextSource: "sentence",
      contextLength: 21, status: "pending", source: "stub", response: null, meta: null, error: null },
  });
});

it("reports absent, not-found and ignored sentence data", () => {
  expect(snap(gappedResult, 2).sentenceStatus).toBe("absent");
  const partial = { ...sentenceResult, sentences: [{ id: 0, kind: "fragment" as const, wordIds: [2], text: "X" }] };
  expect(snap(partial, 9).sentenceStatus).toBe("not-found");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const ignored = parseOcrResult({ ...structuredClone(gappedResult), sentences: null })!;
  expect(snap(ignored, 2).sentenceStatus).toBe("ignored");
  expect(snap(ignored, 2).sentence).toBeNull();
});

it("counts the context length of the line fallback", () => {
  expect(snap(gappedResult, 2).lookup.contextLength).toBe("Das Vorstel- war lungskraft groß".length);
});

it("carries an ok response with optional meta, or an error", () => {
  const ok = snap(sentenceResult, 2, { status: "ok", response: { translation: "x" }, meta: { cached: true } });
  expect(ok.lookup).toMatchObject({ status: "ok", response: { translation: "x" }, meta: { cached: true }, error: null });
  const err = snap(sentenceResult, 2, { status: "error", error: "boom" });
  expect(err.lookup).toMatchObject({ status: "error", response: null, meta: null, error: "boom" });
});
