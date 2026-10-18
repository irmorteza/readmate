import { button, h } from "./dom";
import { icon } from "./icons";
import type { WordInfo } from "./translation";

export interface WordSheetDeps {
  speak(text: string): void;
  comingSoon(label: string): void;
  onClose(): void;
}

export interface WordSheet {
  element: HTMLElement;
  /** Dimmed layer behind the sheet; tapping it closes the sheet. */
  backdrop: HTMLElement;
  showLoading(word: string): void;
  show(info: WordInfo): void;
  showUnavailable(): void;
  hide(): void;
}

const label = (text: string) => h("span", { class: "label", textContent: text });

function action(text: string, iconName: Parameters<typeof icon>[0], cls: string, onClick: () => void) {
  const el = button(text, onClick, cls);
  el.prepend(icon(iconName, { size: 16 }));
  return el;
}

export function createWordSheet(deps: WordSheetDeps): WordSheet {
  let currentWord = "";
  let currentExample = "";

  const wordEl = h("h2", { class: "sheet-word" });
  const phoneticEl = h("span", { class: "phonetic" });
  const posEl = h("span", { class: "pos" });
  const translationEl = h("p", { class: "translation" });
  const exampleDeEl = h("p", { class: "example-de" });
  const exampleEnEl = h("p", { class: "example-en" });

  const speaker = (aria: string, name: "volume-2" | "volume-1", onClick: () => void) => {
    const el = h("button", {
      type: "button",
      class: "icon-button",
      onclick: onClick,
      attrs: { "aria-label": aria },
    });
    el.append(icon(name, { size: name === "volume-2" ? 20 : 16 }));
    return el;
  };

  const closeButton = h("button", {
    type: "button",
    class: "sheet-close",
    onclick: deps.onClose,
    attrs: { "aria-label": "Close" },
  });
  closeButton.append(icon("x", { size: 24 }));

  const backdrop = h("div", { class: "sheet-backdrop", hidden: true, onclick: deps.onClose });
  const element = h(
    "div",
    { class: "sheet", hidden: true, attrs: { role: "dialog", "aria-label": "Word details" } },
    h("div", { class: "handle", onclick: deps.onClose }),
    h(
      "div",
      { class: "sheet-header" },
      h(
        "div",
        {},
        h(
          "div",
          { class: "sheet-title" },
          wordEl,
          speaker("Play pronunciation", "volume-2", () => deps.speak(currentWord)),
        ),
        h("div", { class: "sheet-badges" }, phoneticEl, posEl),
      ),
      closeButton,
    ),
    h(
      "div",
      { class: "sheet-body" },
      h("div", { class: "card-soft" }, label("English Translation"), translationEl),
      h(
        "div",
        {},
        label("Example Sentence"),
        h(
          "div",
          { class: "example-box" },
          h(
            "div",
            { class: "example-row" },
            exampleDeEl,
            speaker("Play example", "volume-1", () => currentExample && deps.speak(currentExample)),
          ),
          exampleEnEl,
        ),
      ),
    ),
    h(
      "div",
      { class: "sheet-footer" },
      action("Save to Flashcards", "bookmark", "primary full", () =>
        deps.comingSoon("Save to Flashcards"),
      ),
      h(
        "div",
        { class: "sheet-secondary" },
        action("Add Note", "pen-tool", "secondary", () => deps.comingSoon("Add Note")),
        action("Full Dictionary", "book", "secondary", () => deps.comingSoon("Full Dictionary")),
      ),
    ),
  );

  const setVisible = (visible: boolean) => {
    element.hidden = !visible;
    backdrop.hidden = !visible;
  };

  return {
    element,
    backdrop,
    showLoading(word) {
      currentWord = word;
      currentExample = "";
      wordEl.textContent = word;
      phoneticEl.textContent = "…";
      posEl.textContent = "";
      translationEl.textContent = "…";
      exampleDeEl.textContent = "…";
      exampleEnEl.textContent = "";
      setVisible(true);
    },
    show(info) {
      currentWord = info.word;
      currentExample = info.exampleDe;
      wordEl.textContent = info.word;
      phoneticEl.textContent = info.phonetic;
      posEl.textContent = info.pos;
      translationEl.textContent = info.translation;
      exampleDeEl.textContent = info.exampleDe;
      exampleEnEl.textContent = info.exampleEn;
    },
    showUnavailable() {
      currentExample = "";
      phoneticEl.textContent = "";
      posEl.textContent = "";
      translationEl.textContent = "Translation unavailable";
      exampleDeEl.textContent = "";
      exampleEnEl.textContent = "";
    },
    hide: () => setVisible(false),
  };
}
