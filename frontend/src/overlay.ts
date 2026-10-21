import type { Box, OcrResult } from "./contract";
import type { Selection } from "./selection";

export type ZoomLevel = 1 | 2 | 3;

export interface Overlay {
  setZoom(level: ZoomLevel): void;
  setOutlines(on: boolean): void;
  elementsForWord(wordId: number): HTMLElement[];
}

export function boxToCss(box: Box): { left: string; top: string; width: string; height: string } {
  const pct = (v: number) => `${v * 100}%`;
  return { left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) };
}

/** Image plus one percent-positioned element per box; boxes track the image at any size. */
export function renderOverlay(
  container: HTMLElement,
  imageUrl: string,
  result: OcrResult,
  selection: Selection,
): Overlay {
  const scroller = document.createElement("div");
  scroller.className = "overlay-scroll";
  const stage = document.createElement("div");
  stage.className = "overlay-stage";
  stage.style.width = "100%";
  const img = document.createElement("img");
  img.src = imageUrl;
  img.alt = "Photographed page";
  stage.append(img);

  const words = new Map(result.words.map((w) => [w.id, w]));
  const elements = new Map<number, HTMLElement>();
  for (const box of result.boxes) {
    const div = document.createElement("div");
    div.className = "box";
    div.dataset.boxId = String(box.id);
    Object.assign(div.style, boxToCss(box.box));
    div.addEventListener("click", (event) => {
      event.stopPropagation();
      selection.select(box.wordId);
    });
    elements.set(box.id, div);
    stage.append(div);
  }
  stage.addEventListener("click", () => selection.clear());

  selection.subscribe((wordId) => {
    const selected = new Set(wordId === null ? [] : (words.get(wordId)?.boxIds ?? []));
    for (const [id, div] of elements) div.classList.toggle("selected", selected.has(id));
  });

  scroller.append(stage);
  container.replaceChildren(scroller);

  return {
    setZoom(level) {
      stage.style.width = `${level * 100}%`;
    },
    setOutlines(on) {
      stage.classList.toggle("outlines", on);
    },
    elementsForWord: (wordId) =>
      words.get(wordId)?.boxIds.flatMap((id) => elements.get(id) ?? []) ?? [],
  };
}
