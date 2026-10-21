import type { OcrBox, OcrResult, OcrSentence, OcrWord, SentenceKind } from "./contract";

export interface SelectedSentence {
  id: number;
  kind: SentenceKind;
  text: string;
  wordIds: number[];
  wordIndex: number;
}

export interface WordSelectedEvent {
  word: OcrWord;
  boxes: OcrBox[];
  lineTexts: string[];
  sentence?: SelectedSentence;
}

export interface Selection {
  select(wordId: number): void;
  clear(): void;
  current(): number | null;
  subscribe(fn: (wordId: number | null) => void): () => void;
}

/** Ids are not contiguous (filter_noise keeps them), so everything is looked up by value. */
export function createSelection(
  result: OcrResult,
  onWordSelected: (event: WordSelectedEvent) => void,
): Selection {
  const words = new Map(result.words.map((w) => [w.id, w]));
  const boxes = new Map(result.boxes.map((b) => [b.id, b]));
  const lines = new Map(result.lines.map((l) => [l.id, l]));
  // First occurrence wins when a word is listed in more than one sentence.
  const sentenceOf = new Map<number, { sentence: OcrSentence; index: number }>();
  for (const sentence of result.sentences ?? []) {
    sentence.wordIds.forEach((id, index) => {
      if (!sentenceOf.has(id)) sentenceOf.set(id, { sentence, index });
    });
  }
  const subscribers = new Set<(wordId: number | null) => void>();
  let current: number | null = null;

  const notify = () => subscribers.forEach((fn) => fn(current));

  return {
    select(wordId) {
      const word = words.get(wordId);
      if (!word) return;
      current = wordId;
      notify();
      const found = sentenceOf.get(wordId);
      onWordSelected({
        word,
        boxes: word.boxIds.flatMap((id) => boxes.get(id) ?? []),
        lineTexts: word.lineIds.flatMap((id) => lines.get(id)?.text ?? []),
        ...(found
          ? {
              sentence: {
                id: found.sentence.id,
                kind: found.sentence.kind,
                text: found.sentence.text,
                wordIds: found.sentence.wordIds,
                wordIndex: found.index,
              },
            }
          : {}),
      });
    },
    clear() {
      current = null;
      notify();
    },
    current: () => current,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
