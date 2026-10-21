import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import example from "../../contract/example.json";
import schema from "../../contract/ocr-result.schema.json";
import { isOcrResult, parseOcrResult, sentencesIgnored } from "./contract";

const clone = () => structuredClone(example) as Record<string, any>;

describe("isOcrResult", () => {
  it("accepts contract/example.json", () => {
    expect(isOcrResult(example)).toBe(true);
  });

  it("rejects a copy missing any top-level field", () => {
    for (const key of schema.required) {
      const copy = clone();
      delete copy[key];
      expect(isOcrResult(copy), `missing ${key}`).toBe(false);
    }
  });

  it("accepts a result without sentences (older backend)", () => {
    const copy = clone();
    delete copy.sentences;
    expect(isOcrResult(copy)).toBe(true);
  });

  it("rejects a nested box missing a field", () => {
    const copy = clone();
    delete copy.boxes[0].wordId;
    expect(isOcrResult(copy)).toBe(false);
  });

  it("rejects wrong types", () => {
    const copy = clone();
    copy.boxes[0].conf = "0.9";
    expect(isOcrResult(copy)).toBe(false);
    const copy2 = clone();
    copy2.words[0].boxIds = "1";
    expect(isOcrResult(copy2)).toBe(false);
  });

  it("rejects version 2", () => {
    const copy = clone();
    copy.version = 2;
    expect(isOcrResult(copy)).toBe(false);
  });

  it("rejects coordinates outside 0-1", () => {
    const copy = clone();
    copy.boxes[0].box.x = 1.5;
    expect(isOcrResult(copy)).toBe(false);
  });

  it("rejects non-objects", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      expect(isOcrResult(bad)).toBe(false);
    }
  });
});

const malformed: Array<[string, (c: Record<string, any>) => void]> = [
  ["unknown kind", (c) => (c.sentences[0].kind = "paragraph")],
  ["unknown word id", (c) => c.sentences[0].wordIds.push(999)],
  ["empty wordIds", (c) => (c.sentences[0].wordIds = [])],
  ["null", (c) => (c.sentences = null)],
  ["not an array", (c) => (c.sentences = { 0: {} })],
  ["entry missing text", (c) => delete c.sentences[0].text],
  ["negative id", (c) => (c.sentences[0].id = -1)],
];

describe("sentences", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("accepts the example with sentences", () => {
    expect(example.sentences).toHaveLength(1);
    expect(isOcrResult(example)).toBe(true);
  });

  it.each(malformed)("isOcrResult rejects sentences with %s", (_, breakIt) => {
    const copy = clone();
    breakIt(copy);
    expect(isOcrResult(copy)).toBe(false);
  });

  it.each(malformed)("parseOcrResult drops sentences with %s and keeps the words", (_, breakIt) => {
    const copy = clone();
    breakIt(copy);
    const parsed = parseOcrResult(copy)!;
    expect(parsed).not.toBeNull();
    expect(parsed.words).toEqual(example.words);
    expect("sentences" in parsed).toBe(false);
    expect(sentencesIgnored(parsed)).toBe(true);
    expect(console.warn).toHaveBeenCalledWith("readmate: ignoring malformed sentences");
  });

  it("parseOcrResult returns a valid result unchanged and not ignored", () => {
    const copy = clone();
    expect(parseOcrResult(copy)).toBe(copy);
    expect(sentencesIgnored(copy as never)).toBe(false);
  });

  it("parseOcrResult accepts a result without sentences, not marked ignored", () => {
    const copy = clone();
    delete copy.sentences;
    expect(sentencesIgnored(parseOcrResult(copy)!)).toBe(false);
  });

  it("parseOcrResult returns null when the core is broken, even with bad sentences", () => {
    const copy = clone();
    delete copy.words;
    copy.sentences = null;
    expect(parseOcrResult(copy)).toBeNull();
  });
});
