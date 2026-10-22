import { afterEach, describe, expect, it, vi } from "vitest";
import example from "../../contract/word-info.example.json";
import { MAX_WORD_CHARS } from "./lookup-request";
import { WordLookupError } from "./word-info-api";
import type { WordInfoRequest, WordInfoResponse } from "./word-info-contract";
import {
  createApiTranslationService,
  createTranslationService,
  toWordInfo,
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

const req = (word: string): WordInfoRequest => ({
  word,
  wordIndex: 0,
  sentence: { kind: "fragment", words: [word] },
  target: "en",
});

afterEach(() => vi.unstubAllEnvs());

describe("stub translation service", () => {
  it("names its source 'stub'", () => expect(stubTranslationService.source).toBe("stub"));

  it.each(entries)("knows %s", async (word, phonetic, pos, translation, exampleDe, exampleEn) => {
    expect(await stubTranslationService.lookup(req(word))).toEqual({
      word,
      phonetic,
      pos,
      translation,
      exampleDe,
      exampleEn,
    });
  });

  it("gives every other word a generic fallback built from the tapped word", async () => {
    expect(await stubTranslationService.lookup(req("Zeitlupe"))).toEqual({
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
    const first = await stubTranslationService.lookup(req("Lesen"));
    first.translation = "changed";
    const second = await stubTranslationService.lookup(req("Lesen"));
    expect(second.translation).toBe("Reading / To read");
    expect(Object.isFrozen(DUMMY_DICTIONARY)).toBe(true);
    expect(Object.isFrozen(DUMMY_DICTIONARY.Lesen)).toBe(true);
  });
});

const golden = example.response as WordInfoResponse;
const goldenRequest = example.request as WordInfoRequest;

describe("toWordInfo", () => {
  it("maps the golden response, resolving the separable-verb parts", () => {
    const info = toWordInfo(golden, goldenRequest);
    expect(info).toMatchObject({
      word: "stellte",
      lemma: "vorstellen",
      pos: "Verb",
      translation: "to introduce",
      senseInContext: golden.senseInContext,
      article: null,
      plural: null,
      expression: null,
    });
    expect(info.separableVerb).toEqual({ infinitive: "vorstellen", wordIndexes: [1, 5], parts: ["stellte", "vor."] });
    expect(info.meta).toEqual(golden.meta);
  });

  it("labels a noun with its article", () => {
    expect(toWordInfo({ ...golden, pos: "noun", article: "die" }, goldenRequest).pos).toBe("Noun (die)");
  });

  it("capitalizes the pos and turns - into a space", () => {
    expect(toWordInfo({ ...golden, pos: "proper-noun" }, goldenRequest).pos).toBe("Proper noun");
  });

  it("resolves the expression parts", () => {
    const expression = { text: "sich vorstellen", meaning: "to imagine", type: "verb-pattern" as const, wordIndexes: [1, 2] };
    expect(toWordInfo({ ...golden, expression }, goldenRequest).expression).toEqual({ ...expression, parts: ["stellte", "sich"] });
  });
});

describe("API translation service", () => {
  it("posts the request with the token and maps the result", async () => {
    const post = vi.fn().mockResolvedValue(golden);
    const service = createApiTranslationService({ getToken: () => "tok", post });
    expect(service.source).toBe("api");
    expect(await service.lookup(goldenRequest)).toEqual(toWordInfo(golden, goldenRequest));
    expect(post).toHaveBeenCalledWith(goldenRequest, "tok");
  });

  it("rejects without calling post when there is no token", async () => {
    const post = vi.fn();
    const err = await createApiTranslationService({ getToken: () => null, post }).lookup(goldenRequest).catch((e) => e);
    expect(err).toBeInstanceOf(WordLookupError);
    expect(err.kind).toBe("unavailable");
    expect(post).not.toHaveBeenCalled();
  });

  it("rejects a tapped word longer than 64 characters without calling post", async () => {
    const post = vi.fn();
    const word = "x".repeat(MAX_WORD_CHARS + 1);
    const err = await createApiTranslationService({ getToken: () => "tok", post }).lookup(req(word)).catch((e) => e);
    expect(err).toBeInstanceOf(WordLookupError);
    expect(err.kind).toBe("unavailable");
    expect(post).not.toHaveBeenCalled();
  });
});

describe("createTranslationService", () => {
  it("returns the API service when VITE_API_URL is set", () => {
    vi.stubEnv("VITE_API_URL", "http://api.test");
    expect(createTranslationService({ getToken: () => "tok" }).source).toBe("api");
  });

  it("returns the stub when VITE_API_URL is empty", async () => {
    vi.stubEnv("VITE_API_URL", "");
    const service = createTranslationService({ getToken: () => "tok" });
    expect(service.source).toBe("stub");
    expect((await service.lookup(req("x"))).word).toBe("x");
  });
});
