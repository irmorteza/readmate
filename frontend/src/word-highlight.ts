export type HighlightStyle = "sentence"; // later: "verb-part", "collocation", …

export interface WordHighlighter {
  /** Marks the words' elements with `hl-<style>`, replacing that style's previous words. */
  set(style: HighlightStyle, wordIds: Iterable<number>): void;
  /** Removes one style, or all styles without an argument. */
  clear(style?: HighlightStyle): void;
}

/** Class-based, so a highlight adds no element and never changes what a tap hits. */
export function createWordHighlighter(targetsFor: (wordId: number) => Element[]): WordHighlighter {
  const marked = new Map<HighlightStyle, Element[]>();

  const clear = (style?: HighlightStyle) => {
    for (const s of style ? [style] : [...marked.keys()]) {
      for (const el of marked.get(s) ?? []) el.classList.remove(`hl-${s}`);
      marked.delete(s);
    }
  };

  return {
    set(style, wordIds) {
      clear(style);
      const elements = [...wordIds].flatMap(targetsFor);
      for (const el of elements) el.classList.add(`hl-${style}`);
      marked.set(style, elements);
    },
    clear,
  };
}
