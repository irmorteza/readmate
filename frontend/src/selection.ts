import type { OcrBox, OcrResult, OcrWord } from "./contract";

export interface WordSelectedEvent {
  word: OcrWord;
  boxes: OcrBox[];
  lineTexts: string[];
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
  const subscribers = new Set<(wordId: number | null) => void>();
  let current: number | null = null;

  const notify = () => subscribers.forEach((fn) => fn(current));

  return {
    select(wordId) {
      const word = words.get(wordId);
      if (!word) return;
      current = wordId;
      notify();
      onWordSelected({
        word,
        boxes: word.boxIds.flatMap((id) => boxes.get(id) ?? []),
        lineTexts: word.lineIds.flatMap((id) => lines.get(id)?.text ?? []),
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
