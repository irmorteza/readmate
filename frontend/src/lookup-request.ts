import type { OcrResult, SentenceKind } from "./contract";
import type { WordSelectedEvent } from "./selection";
import type { WordInfoRequest } from "./word-info-contract";

export type ContextSource = "sentence" | "lines";

export const MAX_WORDS = 120;
export const MAX_WORD_CHARS = 64;
export const MAX_TEXT_CHARS = 600;

export interface BuiltLookup {
  request: WordInfoRequest;
  /** Parallel to `request.sentence.words`: maps response indexes back to page words. */
  wordIds: number[];
  contextSource: ContextSource;
  windowed: boolean;
  /** The words joined with single spaces, as the server rebuilds them. */
  context: string;
}

const joinedLength = (words: string[]) =>
  words.reduce((sum, w) => sum + w.length, 0) + Math.max(0, words.length - 1);

/** Grows a window from the tapped word, right then left, while both caps hold. */
function windowAround(words: string[], at: number): [number, number] {
  let lo = at;
  let hi = at;
  let count = 1;
  let length = words[at].length;
  const fits = (word: string) => count + 1 <= MAX_WORDS && length + 1 + word.length <= MAX_TEXT_CHARS;
  for (let grew = true; grew; ) {
    grew = false;
    if (hi + 1 < words.length && fits(words[hi + 1])) {
      hi += 1;
      count += 1;
      length += 1 + words[hi].length;
      grew = true;
    }
    if (lo > 0 && fits(words[lo - 1])) {
      lo -= 1;
      count += 1;
      length += 1 + words[lo].length;
      grew = true;
    }
  }
  return [lo, hi];
}

/** Builds the word-info request from a tapped word: its sentence, else the words of its lines. */
export function buildLookup(event: WordSelectedEvent, result: OcrResult): BuiltLookup {
  const byId = new Map(result.words.map((w) => [w.id, w]));
  let kind: SentenceKind;
  let contextSource: ContextSource;
  let ids: number[];
  let texts: string[];
  let wordIndex: number;

  if (event.sentence) {
    const { sentence } = event;
    const pieces = sentence.text.split(" ");
    const usable = pieces.length === sentence.wordIds.length && pieces.every((p) => p !== "");
    kind = sentence.kind;
    contextSource = "sentence";
    ids = sentence.wordIds;
    texts = usable ? pieces : ids.map((id) => byId.get(id)?.text ?? "");
    wordIndex = sentence.wordIndex;
  } else {
    const lineIds = new Set(event.word.lineIds);
    const shared = result.words.filter((w) => w.lineIds.some((id) => lineIds.has(id)));
    kind = "fragment";
    contextSource = "lines";
    ids = shared.map((w) => w.id);
    texts = shared.map((w) => w.text);
    wordIndex = ids.indexOf(event.word.id);
  }

  // An empty word is never sent; the tapped index moves with the removals before it.
  const keep = texts.map((t, i) => t !== "" || i === wordIndex);
  wordIndex = keep.slice(0, wordIndex).filter(Boolean).length;
  ids = ids.filter((_, i) => keep[i]);
  let words = texts.filter((_, i) => keep[i]).map((t, i) => (i === wordIndex ? t : t.slice(0, MAX_WORD_CHARS)));

  let windowed = false;
  if (words.length > MAX_WORDS || joinedLength(words) > MAX_TEXT_CHARS) {
    const [lo, hi] = windowAround(words, wordIndex);
    words = words.slice(lo, hi + 1);
    ids = ids.slice(lo, hi + 1);
    wordIndex -= lo;
    kind = "incomplete";
    windowed = true;
  }

  return {
    request: { word: event.word.text, wordIndex, sentence: { kind, words }, target: "en" },
    wordIds: ids,
    contextSource,
    windowed,
    context: words.join(" "),
  };
}
