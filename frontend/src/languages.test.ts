import { expect, it } from "vitest";
import { DEFAULT_TARGET, isTargetCode, LANGUAGES, languageFor } from "./languages";
import source from "../../contract/languages.json";
import copy from "./languages.json";

it("frontend copy matches contract/languages.json (run python scripts/sync_languages.py)", () =>
  expect(copy).toEqual(source));

it("lists the languages in file order", () =>
  expect(LANGUAGES.map((l) => l.code)).toEqual(["en", "de", "fa", "ar", "tr", "uk", "ru", "pl", "es", "fr", "it", "zh-Hans"]));

it("defaults to English", () => expect(DEFAULT_TARGET).toBe("en"));

it("knows Persian is right-to-left", () => {
  expect(languageFor("fa").dir).toBe("rtl");
  expect(languageFor("fa").native).toBe("فارسی");
});

it("falls back to English for unknown or missing codes", () => {
  expect(languageFor("xx").code).toBe("en");
  expect(languageFor(undefined).code).toBe("en");
});

it("matches codes case-sensitively", () => expect(isTargetCode("FA")).toBe(false));
