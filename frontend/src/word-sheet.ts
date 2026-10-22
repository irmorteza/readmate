import { button, h } from "./dom";
import { icon } from "./icons";
import { createModalFocus } from "./modal-focus";
import type { WordInfo } from "./translation";

export interface WordSheetDeps {
  speak(text: string): void;
  comingSoon(label: string): void;
  onClose(): void;
  /** Optional developer debug panel, mounted as the last child of the sheet body. */
  debug?: HTMLElement;
}

export interface WordSheet {
  element: HTMLElement;
  /** Dimmed layer behind the sheet; tapping it closes the sheet. */
  backdrop: HTMLElement;
  showLoading(word: string): void;
  show(info: WordInfo): void;
  showUnavailable(message?: string): void;
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
  const senseEl = h("p", { class: "sense", hidden: true });
  const lemmaEl = h("p", { class: "lemma-line", hidden: true });
  const nounEl = h("p", { class: "noun-line", hidden: true });
  const swatch = (kind: string) => h("span", { class: `swatch swatch-${kind}`, attrs: { "aria-hidden": "true" } });
  const verbInfinitiveEl = h("strong");
  const verbPartsEl = h("span", { class: "parts" });
  const verbCard = h(
    "div",
    { class: "card-separable", hidden: true },
    label("Separable verb"),
    verbInfinitiveEl,
    h("p", { class: "parts-row" }, swatch("verb-part"), verbPartsEl),
  );
  const expressionTextEl = h("strong");
  const expressionMeaningEl = h("p", { class: "meaning" });
  const expressionTypeEl = h("span", { class: "chip" });
  const expressionPartsEl = h("span", { class: "parts" });
  const expressionCard = h(
    "div",
    { class: "card-expression", hidden: true },
    label("Expression"),
    h("p", { class: "expression-head" }, expressionTextEl, expressionTypeEl),
    expressionMeaningEl,
    h("p", { class: "parts-row" }, swatch("collocation"), expressionPartsEl),
  );
  const extras = [senseEl, lemmaEl, nounEl, verbCard, expressionCard];
  const hideExtras = () => {
    for (const el of extras) el.hidden = true;
  };
  const fill = (el: HTMLElement, value: string | null | undefined) => {
    el.textContent = value ?? "";
    el.hidden = !value;
  };
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
    { class: "sheet", hidden: true, attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Word details" } },
    h("div", { class: "handle", onclick: deps.onClose }),
    h(
      "div",
      { class: "sheet-header" },
      h(
        "div",
        { class: "sheet-heading" },
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
      h("div", { class: "card-soft" }, label("English Translation"), translationEl, senseEl),
      lemmaEl,
      nounEl,
      verbCard,
      expressionCard,
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
      ...(deps.debug ? [deps.debug] : []),
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

  const focus = createModalFocus(deps.onClose, element);
  const setVisible = (visible: boolean) => {
    element.hidden = !visible;
    backdrop.hidden = !visible;
    if (visible) focus.activate(closeButton);
    else focus.release();
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
      hideExtras();
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
      fill(senseEl, info.senseInContext);
      fill(lemmaEl, info.lemma && info.lemma !== info.word ? `Lemma: ${info.lemma}` : null);
      if (info.article && info.lemma) {
        const plural = info.plural ? ` · Plural: die ${info.plural}` : "";
        fill(nounEl, `${info.article} ${info.lemma}${plural}`);
      } else fill(nounEl, null);
      const verb = info.separableVerb;
      verbCard.hidden = !verb;
      verbInfinitiveEl.textContent = verb?.infinitive ?? "";
      verbPartsEl.textContent = verb?.parts.join(" … ") ?? "";
      const expression = info.expression;
      expressionCard.hidden = !expression;
      expressionTextEl.textContent = expression?.text ?? "";
      expressionMeaningEl.textContent = expression?.meaning ?? "";
      expressionTypeEl.textContent = expression?.type ?? "";
      expressionPartsEl.textContent = expression?.parts.join(" … ") ?? "";
      exampleDeEl.textContent = info.exampleDe;
      exampleEnEl.textContent = info.exampleEn;
    },
    showUnavailable(message = "Translation unavailable") {
      currentExample = "";
      phoneticEl.textContent = "";
      posEl.textContent = "";
      hideExtras();
      translationEl.textContent = message;
      exampleDeEl.textContent = "";
      exampleEnEl.textContent = "";
    },
    hide: () => setVisible(false),
  };
}
