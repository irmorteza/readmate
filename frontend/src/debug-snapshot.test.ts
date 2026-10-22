import { expect, it, vi } from "vitest";
import { parseOcrResult } from "./contract";
import { okOutcome } from "./debug-snapshot";
import { snap } from "./debug-test-helpers";
import { buildDebugSnapshot } from "./debug-snapshot";
import { buildLookup } from "./lookup-request";
import { createSelection, type WordSelectedEvent } from "./selection";
import { gappedResult, sentenceResult } from "./test-fixtures";

it("describes a word with a sentence", () => {
  expect(snap(sentenceResult, 9)).toEqual({
    format: "readmate-debug/2", build: "abc1234", engine: "fake",
    word: { id: 9, text: "war" },
    sentenceStatus: "ok",
    sentence: { id: 0, kind: "sentence", text: "Vorstellungskraft war", wordIds: [2, 9], wordIndex: 1 },
    lineTexts: ["Das Vorstel- war"],
    lookup: {
      request: { word: "war", wordIndex: 1, sentence: { kind: "sentence", words: ["Vorstellungskraft", "war"] }, target: "en" },
      contextSource: "sentence", contextLength: 21, windowed: false, target: "en",
      status: "pending", source: "stub", response: null, meta: null, error: null },
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
  expect(snap(gappedResult, 2).lookup.contextLength).toBe("Vorstellungskraft war".length);
});

it("carries an ok response with optional meta, or an error", () => {
  const ok = snap(sentenceResult, 2, { status: "ok", response: { translation: "x" }, meta: { cached: true } });
  expect(ok.lookup).toMatchObject({ status: "ok", response: { translation: "x" }, meta: { cached: true }, error: null });
  const err = snap(sentenceResult, 2, { status: "error", error: "boom" });
  expect(err.lookup).toMatchObject({ status: "error", response: null, meta: null, error: "boom" });
});

it("okOutcome moves the meta out of the response", () => {
  const info = { word: "war", pos: "Word", phonetic: "", translation: "was", exampleDe: "", exampleEn: "", meta: { cached: true } };
  const { lookup } = snap(sentenceResult, 9, okOutcome(info));
  expect(lookup.meta).toEqual({ cached: true });
  expect(lookup.response).toMatchObject({ word: "war", translation: "was" });
  expect(lookup.response).not.toHaveProperty("meta");
});

it("okOutcome gives a null meta when the info carries none", () => {
  const info = { word: "war", pos: "Word", phonetic: "", translation: "was", exampleDe: "", exampleEn: "" };
  expect(snap(sentenceResult, 9, okOutcome(info)).lookup.meta).toBeNull();
});

it("a windowed lookup says so in the snapshot", () => {
  const texts = Array.from({ length: 150 }, (_, i) => `w${i}`);
  const result = {
    version: 1 as const, engine: "fake", lines: [], boxes: [],
    words: texts.map((text, i) => ({ id: i, text, boxIds: [], lineIds: [] })),
    sentences: [{ id: 0, kind: "sentence" as const, wordIds: texts.map((_, i) => i), text: texts.join(" ") }],
  };
  const { lookup } = snap(result, 140);
  expect(lookup.windowed).toBe(true);
  expect(lookup.request.sentence.kind).toBe("incomplete");
  expect(lookup.contextLength).toBe(lookup.request.sentence.words.join(" ").length);
});

it("records a non-default target", () => {
  let event!: WordSelectedEvent;
  createSelection(sentenceResult, (e) => (event = e)).select(9);
  const lookup = buildLookup(event, sentenceResult, "fa");
  const { lookup: recorded } = buildDebugSnapshot({
    build: "abc1234", result: sentenceResult, event, lookup, source: "stub", outcome: { status: "pending" },
  });
  expect(recorded.target).toBe("fa");
  expect(recorded.request.target).toBe("fa");
});
