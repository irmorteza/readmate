import { describe, expect, it } from "vitest";
import example from "../../contract/example.json";
import { isOcrResult } from "./contract";

const clone = () => structuredClone(example) as Record<string, any>;

describe("isOcrResult", () => {
  it("accepts contract/example.json", () => {
    expect(isOcrResult(example)).toBe(true);
  });

  it("rejects a copy missing any top-level field", () => {
    for (const key of Object.keys(example)) {
      const copy = clone();
      delete copy[key];
      expect(isOcrResult(copy), `missing ${key}`).toBe(false);
    }
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
