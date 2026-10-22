import { describe, expect, it, vi } from "vitest";
import css from "./styles.css?raw";
import { declarations } from "./test-css";
import type { WordInfo } from "./translation";
import { LANGUAGES } from "./languages";
import { createWordSheet } from "./word-sheet";

const info: WordInfo = {
  word: "Wortschatz",
  phonetic: "/ˈvɔʁtˌʃat͡s/",
  pos: "Noun (m.)",
  translation: "Vocabulary / Lexicon",
  exampleDe: "Das Lesen von Büchern erweitert den Wortschatz.",
  exampleEn: "Reading books expands vocabulary.",
};

function make() {
  const deps = { speak: vi.fn(), comingSoon: vi.fn(), onClose: vi.fn() };
  const sheet = createWordSheet(deps);
  document.body.replaceChildren(sheet.backdrop, sheet.element);
  return { sheet, deps };
}

const text = (sheet: HTMLElement, selector: string) => sheet.querySelector(selector)?.textContent;
const byLabel = (root: HTMLElement, label: string) =>
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const byText = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!;

describe("word sheet", () => {
  it("is hidden by default, together with its backdrop", () => {
    const { sheet } = make();
    expect(sheet.element.hidden).toBe(true);
    expect(sheet.backdrop.hidden).toBe(true);
    expect(sheet.element.getAttribute("role")).toBe("dialog");
  });

  it("showLoading opens it at once with the word and placeholders", () => {
    const { sheet } = make();
    sheet.showLoading("Zeitlupe");
    expect(sheet.element.hidden).toBe(false);
    expect(sheet.backdrop.hidden).toBe(false);
    expect(text(sheet.element, ".sheet-word")).toBe("Zeitlupe");
    expect(text(sheet.element, ".phonetic")).toBe("…");
    expect(text(sheet.element, ".translation")).toBe("…");
    expect(text(sheet.element, ".example-de")).toBe("…");
  });

  it("show fills every field from the word info", () => {
    const { sheet } = make();
    sheet.showLoading("Wortschatz");
    sheet.show(info);
    expect(text(sheet.element, ".sheet-word")).toBe("Wortschatz");
    expect(text(sheet.element, ".phonetic")).toBe("/ˈvɔʁtˌʃat͡s/");
    expect(text(sheet.element, ".pos")).toBe("Noun (m.)");
    expect(text(sheet.element, ".translation")).toBe("Vocabulary / Lexicon");
    expect(text(sheet.element, ".example-de")).toBe("Das Lesen von Büchern erweitert den Wortschatz.");
    expect(text(sheet.element, ".example-en")).toBe("Reading books expands vocabulary.");
    expect(sheet.element.textContent).toContain("English Translation");
    expect(sheet.element.textContent).toContain("Example Sentence");
  });

  it("showUnavailable explains that no translation is available", () => {
    const { sheet } = make();
    sheet.showLoading("x");
    sheet.showUnavailable();
    expect(text(sheet.element, ".translation")).toBe("Translation unavailable");
    expect(text(sheet.element, ".example-de")).toBe("");
  });

  it("the backdrop, the handle and the close button all call onClose", () => {
    const { sheet, deps } = make();
    sheet.showLoading("x");
    sheet.backdrop.click();
    sheet.element.querySelector<HTMLElement>(".handle")!.click();
    byLabel(sheet.element, "Close").click();
    expect(deps.onClose).toHaveBeenCalledTimes(3);
  });

  it("hide hides the sheet and the backdrop", () => {
    const { sheet } = make();
    sheet.showLoading("x");
    sheet.hide();
    expect(sheet.element.hidden).toBe(true);
    expect(sheet.backdrop.hidden).toBe(true);
  });

  it("the speaker buttons speak the word and the German example", () => {
    const { sheet, deps } = make();
    sheet.showLoading("Wortschatz");
    sheet.show(info);
    byLabel(sheet.element, "Play pronunciation").click();
    expect(deps.speak).toHaveBeenLastCalledWith("Wortschatz");
    byLabel(sheet.element, "Play example").click();
    expect(deps.speak).toHaveBeenLastCalledWith("Das Lesen von Büchern erweitert den Wortschatz.");
  });

  it("the example speaker says nothing while the example is not known yet", () => {
    const { sheet, deps } = make();
    sheet.showLoading("Wortschatz");
    byLabel(sheet.element, "Play example").click();
    expect(deps.speak).not.toHaveBeenCalled();
  });

  it("Save to Flashcards, Add Note and Full Dictionary report coming soon", () => {
    const { sheet, deps } = make();
    sheet.showLoading("x");
    for (const label of ["Save to Flashcards", "Add Note", "Full Dictionary"]) {
      byText(sheet.element, label).click();
      expect(deps.comingSoon).toHaveBeenLastCalledWith(label);
    }
  });

  it("the stylesheet caps the sheet at 85dvh with internal scroll and a 32px top radius", () => {
    const rule = css.match(/\.sheet\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("max-height: 85dvh");
    expect(rule).toContain("overflow-y: auto");
    expect(rule).toMatch(/border-radius:\s*2rem 2rem 0 0/);
    expect(rule).toContain("position: absolute");
  });
});

describe("long words in the sheet", () => {
  it.each([".sheet-word", ".phonetic", ".pos", ".translation", ".example-de", ".example-en"])(
    "%s may wrap anywhere so a long compound cannot widen the sheet",
    (selector) => {
      expect(declarations(selector)).toContain("overflow-wrap: anywhere");
    },
  );

  it("the example text can shrink next to its speaker button", () => {
    expect(declarations(".example-de")).toContain("min-width: 0");
  });

  it("the heading column and the badge row can shrink and wrap", () => {
    expect(declarations(".sheet-heading")).toContain("min-width: 0");
    expect(declarations(".sheet-badges")).toContain("flex-wrap: wrap");
  });

  it("the sheet never scrolls sideways", () => {
    expect(declarations(".sheet")).toContain("overflow-x: hidden");
  });

  it("the heading column is part of the sheet markup", () => {
    const { sheet } = make();
    sheet.showLoading("Donaudampfschifffahrtsgesellschaftskapitaen");
    expect(sheet.element.querySelector(".sheet-heading .sheet-word")).not.toBeNull();
  });
});

describe("dialog behavior", () => {
  function opener() {
    const b = document.createElement("button");
    b.textContent = "tapped word";
    document.body.append(b);
    b.focus();
    return b;
  }
  const escape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

  it("is announced as a modal dialog", () => {
    const { sheet } = make();
    expect(sheet.element.getAttribute("aria-modal")).toBe("true");
  });

  it("opening moves focus into the sheet, onto the close button", () => {
    const { sheet } = make();
    opener();
    sheet.showLoading("x");
    expect(document.activeElement).toBe(sheet.element.querySelector('button[aria-label="Close"]'));
  });

  it("closing returns focus to whatever opened it", () => {
    const { sheet } = make();
    const trigger = opener();
    sheet.showLoading("x");
    sheet.hide();
    expect(document.activeElement).toBe(trigger);
  });

  it("switching to another word keeps the original opener and does not steal focus again", () => {
    const { sheet } = make();
    const trigger = opener();
    sheet.showLoading("one");
    const close = sheet.element.querySelector<HTMLElement>('button[aria-label="Close"]')!;
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    sheet.showLoading("two");
    expect(document.activeElement).toBe(other);
    sheet.hide();
    expect(document.activeElement).toBe(trigger);
    expect(close).toBeDefined();
  });

  it("does not fail when the opener has left the page", () => {
    const { sheet } = make();
    const trigger = opener();
    sheet.showLoading("x");
    trigger.remove();
    expect(() => sheet.hide()).not.toThrow();
  });

  it("hide when already hidden does not move focus", () => {
    const { sheet } = make();
    const trigger = opener();
    sheet.hide();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape closes it while open and is ignored once closed", () => {
    const { sheet, deps } = make();
    sheet.showLoading("x");
    escape();
    expect(deps.onClose).toHaveBeenCalledTimes(1);
    sheet.hide();
    escape();
    expect(deps.onClose).toHaveBeenCalledTimes(1);
  });
});


it("mounts an optional debug element as the last child of the sheet body", () => {
  const debug = document.createElement("details");
  const sheet = createWordSheet({ speak: vi.fn(), comingSoon: vi.fn(), onClose: vi.fn(), debug });
  expect(sheet.element.querySelector(".sheet-body")!.lastElementChild).toBe(debug);
});

describe("word sheet with word-info fields", () => {
  const full: WordInfo = {
    ...info,
    word: "stellte",
    phonetic: "/ʃtɛltə/",
    pos: "Verb",
    translation: "introduced",
    lemma: "vorstellen",
    senseInContext: "She introduced him to her mother.",
    article: null,
    plural: null,
    separableVerb: { infinitive: "vorstellen", wordIndexes: [1, 5], parts: ["stellte", "vor."] },
    expression: {
      text: "zur Verfügung stellen",
      meaning: "to make available",
      type: "verb-pattern",
      wordIndexes: [1, 3],
      parts: ["stellte", "Verfügung"],
    },
  };
  const hiddenOf = (sheet: HTMLElement) =>
    [".sense", ".lemma-line", ".noun-line", ".card-separable", ".card-expression"].map(
      (s) => sheet.querySelector<HTMLElement>(s)!.hidden,
    );

  it("shows every new section with its exact text", () => {
    const { sheet } = make();
    sheet.show(full);
    const el = sheet.element;
    expect(text(el, ".sense")).toBe("She introduced him to her mother.");
    expect(text(el, ".lemma-line")).toBe("Lemma: vorstellen");
    expect(el.querySelector<HTMLElement>(".noun-line")!.hidden).toBe(true);
    expect(text(el, ".card-separable .label")).toBe("Separable verb");
    expect(text(el, ".card-separable strong")).toBe("vorstellen");
    expect(text(el, ".card-separable .parts")).toBe("stellte … vor.");
    expect(el.querySelector(".card-separable .swatch.swatch-verb-part")).not.toBeNull();
    expect(text(el, ".card-expression .label")).toBe("Expression");
    expect(text(el, ".card-expression strong")).toBe("zur Verfügung stellen");
    expect(text(el, ".card-expression .meaning")).toBe("to make available");
    expect(text(el, ".card-expression .chip")).toBe("verb-pattern");
    expect(text(el, ".card-expression .parts")).toBe("stellte … Verfügung");
    expect(el.querySelector(".card-expression .swatch.swatch-collocation")).not.toBeNull();
    expect(el.querySelector<HTMLElement>(".card-separable")!.hidden).toBe(false);
    expect(el.querySelector<HTMLElement>(".card-expression")!.hidden).toBe(false);
  });

  it("hides every new section for a base-fields-only info", () => {
    const { sheet } = make();
    sheet.show(info);
    expect(hiddenOf(sheet.element)).toEqual([true, true, true, true, true]);
  });

  it("hides the lemma line when the lemma equals the word", () => {
    const { sheet } = make();
    sheet.show({ ...info, lemma: info.word });
    expect(sheet.element.querySelector<HTMLElement>(".lemma-line")!.hidden).toBe(true);
  });

  it("shows the noun line with the plural", () => {
    const { sheet } = make();
    sheet.show({ ...info, word: "Mutter", lemma: "Mutter", article: "die", plural: "Mütter" });
    const line = sheet.element.querySelector<HTMLElement>(".noun-line")!;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe("die Mutter · Plural: die Mütter");
  });

  it("shows the noun line without a plural part when there is none", () => {
    const { sheet } = make();
    sheet.show({ ...info, word: "Mutter", lemma: "Mutter", article: "die", plural: null });
    expect(text(sheet.element, ".noun-line")).toBe("die Mutter");
  });

  it("showLoading hides all new sections again", () => {
    const { sheet } = make();
    sheet.show(full);
    sheet.showLoading("x");
    expect(hiddenOf(sheet.element)).toEqual([true, true, true, true, true]);
  });

  it("showUnavailable hides all new sections", () => {
    const { sheet } = make();
    sheet.show(full);
    sheet.showUnavailable();
    expect(hiddenOf(sheet.element)).toEqual([true, true, true, true, true]);
  });

  it("showUnavailable takes an optional message", () => {
    const { sheet } = make();
    sheet.showUnavailable("Daily lookup limit reached");
    expect(text(sheet.element, ".translation")).toBe("Daily lookup limit reached");
    sheet.showUnavailable();
    expect(text(sheet.element, ".translation")).toBe("Translation unavailable");
  });

  it("renders markup from the API as literal text", () => {
    const { sheet } = make();
    const evil = "<img src=x onerror=alert(1)>";
    sheet.show({
      ...full,
      translation: evil,
      senseInContext: evil,
      lemma: evil,
      expression: { text: evil, meaning: evil, type: evil, wordIndexes: [0, 1], parts: [evil, evil] },
      separableVerb: { infinitive: evil, wordIndexes: [0, 1], parts: [evil, evil] },
    });
    expect(sheet.element.querySelector("img")).toBeNull();
    expect(text(sheet.element, ".translation")).toBe(evil);
    expect(text(sheet.element, ".sense")).toBe(evil);
    expect(text(sheet.element, ".card-expression .meaning")).toBe(evil);
    expect(text(sheet.element, ".card-expression .parts")).toBe(`${evil} … ${evil}`);
  });
});

describe("word sheet css", () => {
  it("styles the swatches with the highlight colours", () => {
    expect(declarations(".swatch-verb-part")).toContain("outline: 0.125rem solid var(--violet-600)");
    expect(declarations(".swatch-collocation")).toContain("outline: 0.125rem dashed var(--emerald-700)");
  });

  it("declares the two highlight tokens", () => {
    expect(css).toContain("--violet-600: #7c3aed");
    expect(css).toContain("--emerald-700: #047857");
  });
});

describe("target language", () => {
  const rich: WordInfo = {
    ...info,
    lemma: "anrufen",
    article: "die",
    plural: "Anrufe",
    senseInContext: "sense",
    separableVerb: { infinitive: "anrufen", wordIndexes: [0, 2], parts: ["ruft", "an"] },
    expression: { text: "in Frage stellen", meaning: "to question", type: "idiom", wordIndexes: [1, 2], parts: ["in", "Frage"] },
  };

  function makeWith(extra: { getTarget?: () => string; onTargetChange?: (code: string) => void } = {}) {
    const sheet = createWordSheet({ speak: vi.fn(), comingSoon: vi.fn(), onClose: vi.fn(), ...extra });
    document.body.replaceChildren(sheet.backdrop, sheet.element);
    return sheet;
  }
  const attrs = (el: Element | null) => [el?.getAttribute("lang"), el?.getAttribute("dir")];

  it("renders a picker row before the header, with native names in data order", () => {
    const { element } = makeWith();
    const select = element.querySelector<HTMLSelectElement>('select[aria-label="Translation language"]')!;
    const row = select.closest(".target-picker")!;
    expect(row.textContent).toContain("Translate to");
    expect(row.compareDocumentPosition(element.querySelector(".sheet-header")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const options = [...select.options];
    expect(options.map((o) => o.value)).toEqual(LANGUAGES.map((l) => l.code));
    expect(options.map((o) => o.textContent)).toEqual(LANGUAGES.map((l) => l.native));
    options.forEach((o, i) => {
      expect(o.lang).toBe(LANGUAGES[i].code);
      expect(o.getAttribute("dir")).toBe(LANGUAGES[i].dir);
    });
  });

  it("shows the stored target when opened", () => {
    const sheet = makeWith({ getTarget: () => "fa" });
    sheet.showLoading("x");
    expect(sheet.element.querySelector<HTMLSelectElement>("select")!.value).toBe("fa");
  });

  it("reports a change once", () => {
    const onTargetChange = vi.fn();
    const sheet = makeWith({ onTargetChange });
    const select = sheet.element.querySelector<HTMLSelectElement>("select")!;
    select.value = "ar";
    select.dispatchEvent(new Event("change"));
    expect(onTargetChange).toHaveBeenCalledOnce();
    expect(onTargetChange).toHaveBeenCalledWith("ar");
  });

  it("labels the card by language and mode", () => {
    const sheet = makeWith();
    sheet.show({ ...info, target: "fa" });
    expect(text(sheet.element, ".card-soft .label")).toBe("Persian Translation");
    sheet.show({ ...info, target: "de" });
    expect(text(sheet.element, ".card-soft .label")).toBe("Simple German Explanation");
    sheet.show(info);
    expect(text(sheet.element, ".card-soft .label")).toBe("English Translation");
  });

  it("sets lang and dir for a right-to-left target and keeps German and IPA ltr", () => {
    const sheet = makeWith();
    sheet.show({ ...rich, target: "fa", translation: "ترجمه", senseInContext: "توضیح", exampleTranslation: "مثال" });
    const el = sheet.element;
    for (const sel of [".translation", ".sense", ".example-en"]) expect(attrs(el.querySelector(sel))).toEqual(["fa", "rtl"]);
    expect(text(el, ".example-en")).toBe("مثال");
    const german = [
      ".sheet-word", ".example-de", ".lemma-line", ".noun-line",
      ".card-separable strong", ".card-separable .parts", ".card-expression .parts", ".card-expression strong",
    ];
    for (const sel of german) expect(attrs(el.querySelector(sel)), sel).toEqual(["de", "ltr"]);
    expect(el.querySelector(".phonetic")?.getAttribute("dir")).toBe("ltr");
  });

  it("sets the target direction on the expression meaning", () => {
    const sheet = makeWith();
    sheet.show({ ...rich, target: "ar" });
    expect(attrs(sheet.element.querySelector(".meaning"))).toEqual(["ar", "rtl"]);
  });

  it("falls back to exampleEn tagged English when there is no exampleTranslation", () => {
    const sheet = makeWith();
    sheet.show({ ...info, target: "en" });
    expect(text(sheet.element, ".example-en")).toBe(info.exampleEn);
    expect(attrs(sheet.element.querySelector(".example-en"))).toEqual(["en", "ltr"]);
    sheet.show({ ...info, target: "fa" });
    expect(text(sheet.element, ".example-en")).toBe(info.exampleEn);
    expect(attrs(sheet.element.querySelector(".example-en"))).toEqual(["en", "ltr"]);
  });

  it("renders markup literally", () => {
    const sheet = makeWith();
    sheet.show({ ...info, translation: "<img src=x onerror=alert(1)>" });
    expect(text(sheet.element, ".translation")).toBe("<img src=x onerror=alert(1)>");
    expect(sheet.element.querySelector(".translation img")).toBeNull();
  });

  it("gives the picker a touch-sized select", () => {
    expect(declarations(".target-select")).toContain("min-height: 2.75rem");
  });
});
