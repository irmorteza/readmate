import { describe, expect, it } from "vitest";
import {
  createTranslationService,
  DEFAULT_WORD_INFO,
  stubTranslationService,
} from "./translation";

describe("stub translation service", () => {
  it("echoes the tapped word and returns the default payload", async () => {
    const info = await stubTranslationService.lookup("Lesen", "Das Lesen macht Spaß.");
    expect(info).toEqual({
      word: "Lesen",
      type: "Noun (der)",
      ipa: "/ˈvɔʁtˌʃats/",
      translation: "Vocabulary / Lexicon",
      example: "Ein großer Wortschatz hilft beim Sprachenlernen.",
    });
  });

  it("does not let callers mutate the shared defaults", async () => {
    const first = await stubTranslationService.lookup("A", "");
    first.translation = "changed";
    const second = await stubTranslationService.lookup("B", "");
    expect(second.translation).toBe(DEFAULT_WORD_INFO.translation);
    expect(Object.isFrozen(DEFAULT_WORD_INFO)).toBe(true);
  });

  it("is what createTranslationService returns until a real service exists", async () => {
    const service = createTranslationService();
    expect((await service.lookup("x", "y")).word).toBe("x");
  });
});
