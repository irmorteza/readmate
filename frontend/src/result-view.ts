import { isEmptyResult, NO_TEXT_MESSAGE } from "./app";
import type { OcrBox, OcrResult, OcrWord } from "./contract";
import { createDebugPanel } from "./debug-panel";
import { buildDebugSnapshot, type LookupOutcome } from "./debug-snapshot";
import { button, h } from "./dom";
import { icon } from "./icons";
import { buildLookupRequest } from "./lookup-request";
import { renderOverlay, type ZoomLevel } from "./overlay";
import { createSelection } from "./selection";
import type { TranslationService } from "./translation";
import { createWordHighlighter } from "./word-highlight";
import { createWordSheet } from "./word-sheet";

export interface ResultViewDeps {
  translation: TranslationService;
  onNewPhoto: () => void;
  speak: (text: string) => void;
  comingSoon: (label: string) => void;
  devMode: { get(): boolean; subscribe(fn: (on: boolean) => void): () => void };
  /** Build id shown in the developer debug panel. */
  build: string;
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

export interface ResultViewState {
  result: OcrResult;
  imageUrl: string;
  /** Optional text for the card header, e.g. "Page 42"; omitted when not available. */
  pageLabel?: string;
  /** Optional full-sentence translation card; omitted when not available. */
  sentenceTranslation?: string;
}

export function createResultView(state: ResultViewState, deps: ResultViewDeps): HTMLElement {
  const { result, imageUrl, pageLabel, sentenceTranslation } = state;
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

  const panel = createDebugPanel();
  const sheet = createWordSheet({
    speak: deps.speak,
    comingSoon: deps.comingSoon,
    onClose: () => selection.clear(),
    debug: panel.element,
  });
  // Targets are resolved per tap, after the overlay below exists.
  const highlighter = createWordHighlighter((id) => [
    ...(wordSpans.has(id) ? [wordSpans.get(id)!] : []),
    ...overlay.elementsForWord(id),
  ]);
  const source = deps.translation.source ?? "unknown";
  const selection = createSelection(result, (event) => {
    const mine = ++lookupId;
    const { request, contextSource } = buildLookupRequest(event);
    const snapshot = (outcome: LookupOutcome) =>
      buildDebugSnapshot({ build: deps.build, result, event, request, contextSource, source, outcome });
    const showDebug = (outcome: LookupOutcome) => {
      if (deps.devMode.get()) panel.render(snapshot(outcome));
    };

    sheet.showLoading(event.word.text);
    if (deps.devMode.get()) {
      if (event.sentence) highlighter.set("sentence", event.sentence.wordIds);
      else highlighter.clear("sentence");
      showDebug({ status: "pending" });
    } else {
      highlighter.clear("sentence");
      panel.clear();
    }
    deps.translation.lookup(request.word, request.context).then(
      (info) => {
        if (mine !== lookupId) return;
        sheet.show(info);
        showDebug({ status: "ok", response: { ...info } });
      },
      (e) => {
        if (mine !== lookupId) return;
        sheet.showUnavailable();
        showDebug({ status: "error", error: e instanceof Error ? e.message : String(e) });
      },
    );
  });
  selection.subscribe((id) => {
    if (id === null) {
      lookupId++; // a lookup still running must not reopen anything
      sheet.hide();
      highlighter.clear("sentence");
      panel.clear();
    }
    for (const [wordId, span] of wordSpans) span.classList.toggle("selected", wordId === id);
  });

  // Clean Text pane
  const words = h("div", { class: "words" });
  for (const word of result.words) {
    const el = h("button", {
      type: "button",
      class: "word",
      textContent: displayText(word, boxes),
      onclick: (event: MouseEvent) => {
        event.stopPropagation();
        selection.select(word.id);
      },
    });
    el.dataset.wordId = String(word.id);
    wordSpans.set(word.id, el);
    words.append(el);
  }
  words.addEventListener("click", () => selection.clear());
  const infoText = h("span", { class: "info-text" }, icon("info", { size: 14 }));
  infoText.append("Tap word for translation & audio");
  const textPane = h(
    "div",
    { class: "text-pane", attrs: { "data-pane": "text" } },
    h(
      "div",
      { class: "info-strip" },
      infoText,
      h("span", { class: "badge", textContent: "DE ➔ EN" }),
    ),
    h(
      "div",
      { class: "card reader-card" },
      ...(pageLabel ? [h("h3", { class: "page-label", textContent: pageLabel })] : []),
      words,
      ...(sentenceTranslation
        ? [
            h(
              "div",
              { class: "sentence-card" },
              h("strong", { textContent: "Full Sentence Translation:" }),
              h("p", { textContent: sentenceTranslation }),
            ),
          ]
        : []),
    ),
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
  const tab = (name: "text" | "image", iconName: "image" | "type", label: string) => {
    const el = h("button", {
      type: "button",
      class: "tab",
      onclick: () => setTab(name),
      attrs: { role: "tab", "data-tab": name },
    });
    el.append(icon(iconName, { size: 14 }), label);
    tabs.set(name, el);
    return el;
  };
  const rescan = h("button", {
    type: "button",
    class: "rescan",
    onclick: deps.onNewPhoto,
    attrs: { "aria-label": "New photo", title: "New photo" },
  });
  rescan.append(icon("refresh-cw", { size: 14 }));
  const readerBar = h(
    "div",
    { class: "reader-bar" },
    h(
      "div",
      { class: "segmented", attrs: { role: "tablist" } },
      tab("image", "image", "Smart Image"),
      tab("text", "type", "Clean Text"),
    ),
    rescan,
  );
  setTab("text");

  const screen = h("section", { class: "screen" }, readerBar, textPane, imagePane, sheet.backdrop, sheet.element);
  // The screen is rebuilt on state changes; a disconnected one unsubscribes on the next toggle.
  const off = deps.devMode.subscribe((on) => {
    if (!screen.isConnected) return off();
    if (!on) {
      highlighter.clear("sentence");
      panel.clear();
    }
  });
  return screen;
}
