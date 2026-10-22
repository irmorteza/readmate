import { MAX_WORD_CHARS } from "./lookup-request";
import { postWordInfo, WordLookupError } from "./word-info-api";
import type { WordInfoRequest, WordInfoResponse } from "./word-info-contract";

/** What the word sheet shows for a tapped word. */
export interface WordInfo {
  word: string;
  phonetic: string;
  pos: string;
  translation: string;
  exampleDe: string;
  exampleEn: string;
  lemma?: string;
  senseInContext?: string;
  article?: string | null;
  plural?: string | null;
  separableVerb?: { infinitive: string; wordIndexes: number[]; parts: string[] } | null;
  expression?: {
    text: string;
    meaning: string;
    type: string;
    wordIndexes: number[];
    parts: string[];
  } | null;
  meta?: Record<string, unknown>;
}

/** The boundary to the meaning lookup; the UI only knows this interface. */
export interface TranslationService {
  /** Short name of the implementation, shown in the developer debug panel. */
  readonly source?: string;
  lookup(request: WordInfoRequest): Promise<WordInfo>;
}

type Entry = Readonly<Omit<WordInfo, "word">>;

const freeze = (entry: Entry): Entry => Object.freeze({ ...entry });

/** UI mock data from the designer's concept. These are not real translations. */
export const DUMMY_DICTIONARY: Readonly<Record<string, Entry>> = Object.freeze({
  Wortschatz: freeze({
    phonetic: "/ˈvɔʁtˌʃat͡s/",
    pos: "Noun (m.)",
    translation: "Vocabulary / Lexicon",
    exampleDe: "Das Lesen von Büchern erweitert den Wortschatz.",
    exampleEn: "Reading books expands vocabulary.",
  }),
  Lesen: freeze({
    phonetic: "/ˈleːzn̩/",
    pos: "Noun (n.)",
    translation: "Reading / To read",
    exampleDe: "Tägliches Lesen stärkt das Gedächtnis.",
    exampleEn: "Daily reading strengthens memory.",
  }),
  Büchern: freeze({
    phonetic: "/ˈbyːçɐn/",
    pos: "Noun (pl. dat.)",
    translation: "Books",
    exampleDe: "Wir lernen viel aus guten Büchern.",
    exampleEn: "We learn a lot from good books.",
  }),
  erweitert: freeze({
    phonetic: "/ɛɐ̯ˈvaɪ̯tɐt/",
    pos: "Verb (3rd pers.)",
    translation: "Expands / Broadens",
    exampleDe: "Reisen erweitert den Horizont.",
    exampleEn: "Travel expands one's horizon.",
  }),
  Sprachverständnis: freeze({
    phonetic: "/ˈʃpʁaːxvɛɐ̯ˌʃtɛntnɪs/",
    pos: "Noun (n.)",
    translation: "Language comprehension",
    exampleDe: "Ein gutes Sprachverständnis ist wichtig.",
    exampleEn: "Good language comprehension is important.",
  }),
});

/** Generic placeholder for a word the dummy dictionary does not know. */
export function fallbackInfo(word: string): WordInfo {
  return {
    word,
    phonetic: `/${word.toLowerCase()}/`,
    pos: "Word",
    translation: `Meaning of "${word}"`,
    exampleDe: `Hier ist ein Beispielsatz mit ${word}.`,
    exampleEn: `Here is an example sentence with ${word}.`,
  };
}

/** Placeholder service: the dummy dictionary, a generic fallback otherwise. */
export const stubTranslationService: TranslationService = {
  source: "stub",
  async lookup({ word }) {
    const entry = Object.hasOwn(DUMMY_DICTIONARY, word) ? DUMMY_DICTIONARY[word] : undefined;
    return entry ? { ...entry, word } : fallbackInfo(word);
  },
};

const posLabel = (response: WordInfoResponse): string =>
  response.article
    ? `Noun (${response.article})`
    : response.pos.charAt(0).toUpperCase() + response.pos.slice(1).replace(/-/g, " ");

/** Maps the API response to what the sheet shows; group indexes become the sentence words. */
export function toWordInfo(response: WordInfoResponse, request: WordInfoRequest): WordInfo {
  const parts = (indexes: number[]) => indexes.map((i) => request.sentence.words[i]);
  const { separableVerb, expression } = response;
  return {
    word: response.word,
    phonetic: response.phonetic,
    pos: posLabel(response),
    translation: response.translation,
    exampleDe: response.exampleDe,
    exampleEn: response.exampleEn,
    lemma: response.lemma,
    senseInContext: response.senseInContext,
    article: response.article,
    plural: response.plural,
    separableVerb: separableVerb && { ...separableVerb, parts: parts(separableVerb.wordIndexes) },
    expression: expression && { ...expression, parts: parts(expression.wordIndexes) },
    meta: { ...response.meta },
  };
}

export function createApiTranslationService(deps: {
  getToken: () => string | null;
  post?: typeof postWordInfo;
}): TranslationService {
  const post = deps.post ?? postWordInfo;
  return {
    source: "api",
    async lookup(request) {
      const token = deps.getToken();
      // An OCR-merged tapped word is never clipped by the builder, so it is refused here.
      if (!token || request.word.length > MAX_WORD_CHARS) throw new WordLookupError("unavailable");
      return toWordInfo(await post(request, token), request);
    },
  };
}

export function createTranslationService(deps: { getToken: () => string | null }): TranslationService {
  return String(import.meta.env.VITE_API_URL ?? "") !== ""
    ? createApiTranslationService(deps)
    : stubTranslationService;
}
