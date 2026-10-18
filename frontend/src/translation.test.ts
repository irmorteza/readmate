import { describe, expect, it } from "vitest";
import {
  createTranslationService,
  DUMMY_DICTIONARY,
  fallbackInfo,
  stubTranslationService,
} from "./translation";

const entries = [
  ["Wortschatz", "/ˈvɔʁtˌʃat͡s/", "Noun (m.)", "Vocabulary / Lexicon", "Das Lesen von Büchern erweitert den Wortschatz.", "Reading books expands vocabulary."],
  ["Lesen", "/ˈleːzn̩/", "Noun (n.)", "Reading / To read", "Tägliches Lesen stärkt das Gedächtnis.", "Daily reading strengthens memory."],
  ["Büchern", "/ˈbyːçɐn/", "Noun (pl. dat.)", "Books", "Wir lernen viel aus guten Büchern.", "We learn a lot from good books."],
  ["erweitert", "/ɛɐ̯ˈvaɪ̯tɐt/", "Verb (3rd pers.)", "Expands / Broadens", "Reisen erweitert den Horizont.", "Travel expands one's horizon."],
  ["Sprachverständnis", "/ˈʃpʁaːxvɛɐ̯ˌʃtɛntnɪs/", "Noun (n.)", "Language comprehension", "Ein gutes Sprachverständnis ist wichtig.", "Good language comprehension is important."],
] as const;

describe("stub translation service", () => {
  it.each(entries)("knows %s", async (word, phonetic, pos, translation, exampleDe, exampleEn) => {
    expect(await stubTranslationService.lookup(word, "any context")).toEqual({
      word,
      phonetic,
      pos,
      translation,
      exampleDe,
      exampleEn,
    });
  });

  it("gives every other word a generic fallback built from the tapped word", async () => {
    expect(await stubTranslationService.lookup("Zeitlupe", "")).toEqual({
      word: "Zeitlupe",
      phonetic: "/zeitlupe/",
      pos: "Word",
      translation: 'Meaning of "Zeitlupe"',
      exampleDe: "Hier ist ein Beispielsatz mit Zeitlupe.",
      exampleEn: "Here is an example sentence with Zeitlupe.",
    });
    expect(fallbackInfo("Haus").word).toBe("Haus");
  });

  it("does not let callers mutate the shared dictionary", async () => {
    const first = await stubTranslationService.lookup("Lesen", "");
    first.translation = "changed";
    const second = await stubTranslationService.lookup("Lesen", "");
    expect(second.translation).toBe("Reading / To read");
    expect(Object.isFrozen(DUMMY_DICTIONARY)).toBe(true);
    expect(Object.isFrozen(DUMMY_DICTIONARY.Lesen)).toBe(true);
  });

  it("is what createTranslationService returns until a real service exists", async () => {
    const service = createTranslationService();
    expect((await service.lookup("x", "y")).word).toBe("x");
  });
});
