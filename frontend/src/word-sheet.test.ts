import { describe, expect, it, vi } from "vitest";
import css from "./styles.css?raw";
import { declarations } from "./test-css";
import type { WordInfo } from "./translation";
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
