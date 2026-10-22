import { describe, expect, it } from "vitest";
import type { OcrResult, SentenceKind } from "./contract";
import { buildLookup, MAX_TEXT_CHARS, MAX_WORD_CHARS, MAX_WORDS } from "./lookup-request";
import type { WordSelectedEvent } from "./selection";
import { gappedResult, sentenceResult } from "./test-fixtures";

/** Words with ids 100+i on one line, so ids never equal indexes. */
function resultOf(texts: string[]): OcrResult {
  return {
    version: 1,
    engine: "fake",
    lines: [],
    boxes: [],
    words: texts.map((text, i) => ({ id: 100 + i, text, boxIds: [], lineIds: [1] })),
  };
}

function sentenceEvent(
  result: OcrResult,
  tapped: number,
  opts: { text?: string; kind?: SentenceKind } = {},
): WordSelectedEvent {
  const wordIds = result.words.map((w) => w.id);
  return {
    word: result.words[tapped],
    boxes: [],
    lineTexts: [],
    sentence: {
      id: 0,
      kind: opts.kind ?? "sentence",
      text: opts.text ?? result.words.map((w) => w.text).join(" "),
      wordIds,
      wordIndex: tapped,
    },
  };
}

const texts = (n: number, make = (i: number) => `w${i}`) => Array.from({ length: n }, (_, i) => make(i));

describe("buildLookup with a sentence", () => {
  it("uses the sentence pieces, keeping punctuation, and maps the ids", () => {
    const result = resultOf(["Sie", "stellte", "ihn", "vor"]);
    const event = sentenceEvent(result, 1, { text: "Sie stellte ihn vor." });
    const built = buildLookup(event, result);
    expect(built.request).toEqual({
      word: "stellte",
      wordIndex: 1,
      sentence: { kind: "sentence", words: ["Sie", "stellte", "ihn", "vor."] },
      target: "en",
    });
    expect(built.wordIds).toEqual([100, 101, 102, 103]);
    expect(built.contextSource).toBe("sentence");
    expect(built.windowed).toBe(false);
    expect(built.context).toBe("Sie stellte ihn vor.");
  });

  it("copies the sentence kind", () => {
    const result = resultOf(["a", "b"]);
    expect(buildLookup(sentenceEvent(result, 0, { kind: "incomplete" }), result).request.sentence.kind).toBe(
      "incomplete",
    );
  });

  it("falls back to the word texts when the piece count differs, so indexes never shift", () => {
    const built = buildLookup(
      { word: gappedResult.words[1], boxes: [], lineTexts: [], sentence: { id: 0, kind: "sentence", text: "Vorstellungskraft  war", wordIds: [2, 9], wordIndex: 1 } },
      gappedResult,
    );
    expect(built.request.sentence.words).toEqual(["Vorstellungskraft", "war"]);
    expect(built.request.wordIndex).toBe(1);
    expect(built.wordIds).toEqual([2, 9]);
  });

  it("never sends an empty piece", () => {
    const result = resultOf(["a", "b", "c"]);
    const built = buildLookup(sentenceEvent(result, 2, { text: "a  c" }), result);
    expect(built.request.sentence.words).toEqual(["a", "b", "c"]);
  });

  it("works on the shared sentence fixture", () => {
    const built = buildLookup(
      { word: sentenceResult.words[0], boxes: [], lineTexts: [], sentence: { id: 0, kind: "sentence", text: "Vorstellungskraft war", wordIds: [2, 9], wordIndex: 0 } },
      sentenceResult,
    );
    expect(built.request.sentence.words).toEqual(["Vorstellungskraft", "war"]);
    expect(built.wordIds).toEqual([2, 9]);
  });
});

describe("buildLookup without a sentence", () => {
  it("uses the words of the shared lines as a fragment", () => {
    const built = buildLookup({ word: gappedResult.words[1], boxes: [], lineTexts: [] }, gappedResult);
    expect(built.request.sentence).toEqual({ kind: "fragment", words: ["Vorstellungskraft", "war"] });
    expect(built.request.word).toBe("war");
    expect(built.request.wordIndex).toBe(1);
    expect(built.wordIds).toEqual([2, 9]);
    expect(built.contextSource).toBe("lines");
  });
});

describe("windowing", () => {
  it("windows a 150-word sentence around word 140", () => {
    const result = resultOf(texts(150));
    const built = buildLookup(sentenceEvent(result, 140), result);
    const { words } = built.request.sentence;
    expect(words.length).toBeLessThanOrEqual(MAX_WORDS);
    expect(built.context.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(built.request.sentence.kind).toBe("incomplete");
    expect(built.windowed).toBe(true);
    expect(words[built.request.wordIndex]).toBe("w140");
    expect(built.wordIds[built.request.wordIndex]).toBe(240);
    expect(built.wordIds).toEqual(Array.from({ length: words.length }, (_, k) => built.wordIds[0] + k));
    expect(built.context).toBe(words.join(" "));
  });

  it("windows by characters for 40 words of 20 characters", () => {
    const result = resultOf(texts(40, (i) => String(i).padStart(2, "0").padEnd(20, "x")));
    const built = buildLookup(sentenceEvent(result, 20), result);
    expect(built.windowed).toBe(true);
    expect(built.context.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(built.request.sentence.words).toContain(result.words[20].text);
    expect(built.request.sentence.kind).toBe("incomplete");
  });

  it("does not window exactly 120 words joined to exactly 600 characters", () => {
    const result = resultOf(["aaaaa", ...Array<string>(119).fill("bbbb")]);
    const built = buildLookup(sentenceEvent(result, 3), result);
    expect(built.context.length).toBe(MAX_TEXT_CHARS);
    expect(built.request.sentence.words).toHaveLength(MAX_WORDS);
    expect(built.windowed).toBe(false);
    expect(built.request.sentence.kind).toBe("sentence");
  });

  it("windows one word over the word cap", () => {
    const result = resultOf(texts(121, () => "a"));
    expect(buildLookup(sentenceEvent(result, 60), result).windowed).toBe(true);
  });
});

describe("clipping", () => {
  const long = "x".repeat(80);

  it("clips another word to 64 characters", () => {
    const result = resultOf(["a", long, "b"]);
    const built = buildLookup(sentenceEvent(result, 0), result);
    expect(built.request.sentence.words[1]).toBe("x".repeat(MAX_WORD_CHARS));
  });

  it("keeps the tapped word at its full length", () => {
    const result = resultOf(["a", long, "b"]);
    const built = buildLookup(sentenceEvent(result, 1), result);
    expect(built.request.sentence.words[1]).toBe(long);
    expect(built.request.word).toBe(long);
  });
});

describe("buildLookup target", () => {
  it("defaults to en and passes a chosen target through", () => {
    const result = resultOf(texts(4));
    const event = sentenceEvent(result, 1);
    const plain = buildLookup(event, result).request;
    expect(plain.target).toBe("en");
    const fa = buildLookup(event, result, "fa").request;
    expect(fa.target).toBe("fa");
    expect({ ...fa, target: "en" }).toEqual(plain);
  });
});
