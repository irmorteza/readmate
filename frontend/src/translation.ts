/** What the translation sheet shows for a tapped word. */
export interface WordInfo {
  word: string;
  type: string;
  ipa: string;
  translation: string;
  example: string;
}

/**
 * The boundary to the meaning lookup. Phase 2 replaces the stub below with a real service
 * (e.g. POST /explain with { word, context }); the UI only knows this interface.
 */
export interface TranslationService {
  lookup(word: string, context: string): Promise<WordInfo>;
}

/** What the stub service answers for every word. */
export const DEFAULT_WORD_INFO: Readonly<Omit<WordInfo, "word">> = Object.freeze({
  type: "Noun (der)",
  ipa: "/ˈvɔʁtˌʃats/",
  translation: "Vocabulary / Lexicon",
  example: "Ein großer Wortschatz hilft beim Sprachenlernen.",
});

/** Placeholder service: the tapped word plus the default payload. Not a real translation. */
export const stubTranslationService: TranslationService = {
  async lookup(word) {
    return { ...DEFAULT_WORD_INFO, word };
  },
};

export function createTranslationService(): TranslationService {
  return stubTranslationService;
}
