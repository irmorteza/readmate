import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getTargetLanguage, setTargetLanguage } from "./target-language";

beforeEach(() => {
  localStorage.clear();
  setTargetLanguage("en");
});
afterEach(() => vi.restoreAllMocks());

it("defaults to en", () => {
  localStorage.clear();
  expect(getTargetLanguage()).toBe("en");
});

it("saves and reads back", () => {
  setTargetLanguage("fa");
  expect(getTargetLanguage()).toBe("fa");
  expect(localStorage.getItem("readmate.targetLanguage")).toBe("fa");
});

it("ignores an unknown code", () => {
  setTargetLanguage("fa");
  setTargetLanguage("xx");
  expect(getTargetLanguage()).toBe("fa");
});

it("reads a stored unknown value as en", () => {
  localStorage.setItem("readmate.targetLanguage", "klingon");
  expect(getTargetLanguage()).toBe("en");
});

it("falls back to memory when storage throws", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => setTargetLanguage("ar")).not.toThrow();
  expect(getTargetLanguage()).toBe("ar");
});

it("keeps the chosen language when only the save fails", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  setTargetLanguage("fa");
  expect(getTargetLanguage()).toBe("fa");
});
