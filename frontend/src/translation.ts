/** What the word sheet shows for a tapped word. */
export interface WordInfo {
  word: string;
  phonetic: string;
  pos: string;
  translation: string;
  exampleDe: string;
  exampleEn: string;
}

/**
 * The boundary to the meaning lookup. The owner defines the real service later (for example
 * POST /explain with { word, context }); the UI only knows this interface.
 */
export interface TranslationService {
  /** Short name of the implementation, shown in the developer debug panel. */
  readonly source?: string;
  lookup(word: string, context: string): Promise<WordInfo>;
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
  async lookup(word) {
    const entry = Object.hasOwn(DUMMY_DICTIONARY, word) ? DUMMY_DICTIONARY[word] : undefined;
    return entry ? { ...entry, word } : fallbackInfo(word);
  },
};

export function createTranslationService(): TranslationService {
  return stubTranslationService;
}
