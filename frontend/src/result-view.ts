import { isEmptyResult, NO_TEXT_MESSAGE } from "./app";
import type { OcrBox, OcrResult, OcrWord } from "./contract";
import { button, h } from "./dom";
import { renderOverlay, type ZoomLevel } from "./overlay";
import { createSelection } from "./selection";
import type { TranslationService } from "./translation";
import { createWordSheet } from "./word-sheet";

export interface ResultViewDeps {
  translation: TranslationService;
  onNewPhoto: () => void;
  speak: (text: string) => void;
  comingSoon: (label: string) => void;
}

const LEADING = /^[»«„“”"'‘’(\[]+/u;
const TRAILING = /[.,;:!?»«„“”"'‘’)\]]+$/u;

/** The word as printed: a single box keeps its raw text, a merged word keeps its outer punctuation. */
function displayText(word: OcrWord, boxes: Map<number, OcrBox>): string {
  const first = boxes.get(word.boxIds[0]);
  const last = boxes.get(word.boxIds[word.boxIds.length - 1]);
  if (!first || !last) return word.text;
  if (first === last) return first.raw;
  return (first.raw.match(LEADING)?.[0] ?? "") + word.text + (last.raw.match(TRAILING)?.[0] ?? "");
}

export function createResultView(
  state: { result: OcrResult; imageUrl: string },
  deps: ResultViewDeps,
): HTMLElement {
  const { result, imageUrl } = state;
  const newPhoto = button("New photo", deps.onNewPhoto, "secondary full");

  if (isEmptyResult(result)) {
    return h(
      "section",
      { class: "screen" },
      h("div", { class: "card" }, h("p", { textContent: NO_TEXT_MESSAGE })),
      newPhoto,
    );
  }

  let lookupId = 0;
  const wordSpans = new Map<number, HTMLElement>();
  const boxes = new Map(result.boxes.map((b) => [b.id, b]));

  const sheet = createWordSheet({
    speak: deps.speak,
    comingSoon: deps.comingSoon,
    onClose: () => selection.clear(),
  });
  const selection = createSelection(result, ({ word, lineTexts }) => {
    const mine = ++lookupId;
    sheet.showLoading(word.text);
    deps.translation.lookup(word.text, lineTexts.join(" ")).then(
      (info) => mine === lookupId && sheet.show(info),
      () => mine === lookupId && sheet.showUnavailable(),
    );
  });
  selection.subscribe((id) => {
    if (id === null) {
      lookupId++; // a lookup still running must not reopen anything
      sheet.hide();
    }
    for (const [wordId, span] of wordSpans) span.classList.toggle("selected", wordId === id);
  });

  // Clean Text pane
  const words = h("div", { class: "words" });
  for (const word of result.words) {
    const span = h("span", {
      class: "word",
      textContent: displayText(word, boxes),
      onclick: (event: MouseEvent) => {
        event.stopPropagation();
        selection.select(word.id);
      },
    });
    span.dataset.wordId = String(word.id);
    wordSpans.set(word.id, span);
    words.append(span, " ");
  }
  words.addEventListener("click", () => selection.clear());
  const textPane = h(
    "div",
    { class: "card", attrs: { "data-pane": "text" } },
    h("p", { class: "caption", textContent: "Tap any word to see translation" }),
    words,
  );

  // Smart Image pane
  const stageHost = h("div", { class: "stage-host" });
  const overlay = renderOverlay(stageHost, imageUrl, result, selection);
  const outlines = h("input", {
    type: "checkbox",
    onchange: () => overlay.setOutlines(outlines.checked),
  });
  const zoom = (label: string, level: ZoomLevel) =>
    button(label, () => overlay.setZoom(level), "chip");
  const imagePane = h(
    "div",
    { attrs: { "data-pane": "image" }, hidden: true },
    h(
      "div",
      { class: "toolbar" },
      zoom("Fit", 1),
      zoom("2×", 2),
      zoom("3×", 3),
      h("label", { class: "chip-label" }, outlines, " Outlines"),
    ),
    stageHost,
  );

  // Tabs
  const tabs = new Map<string, HTMLElement>();
  const panes = { text: textPane, image: imagePane };
  const setTab = (name: "text" | "image") => {
    for (const [key, pane] of Object.entries(panes)) pane.hidden = key !== name;
    for (const [key, tab] of tabs) {
      const active = key === name;
      tab.setAttribute("aria-selected", String(active));
      tab.classList.toggle("active", active);
    }
  };
  const tab = (name: "text" | "image", label: string) => {
    const el = h("button", {
      type: "button",
      class: "tab",
      textContent: label,
      onclick: () => setTab(name),
      attrs: { role: "tab", "data-tab": name },
    });
    tabs.set(name, el);
    return el;
  };
  const tabBar = h(
    "div",
    { class: "tabs", attrs: { role: "tablist" } },
    tab("image", "🖼️ Smart Image"),
    tab("text", "📄 Clean Text"),
  );
  setTab("text");

  return h("section", { class: "screen" }, tabBar, textPane, imagePane, newPhoto, sheet.backdrop, sheet.element);
}
