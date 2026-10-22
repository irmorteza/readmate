import { expect, it, describe } from "vitest";
import css from "./styles.css?raw";
import { declarations } from "./test-css";
import { createWordHighlighter } from "./word-highlight";

function setup() {
  const els = new Map([1, 2, 3].map((id) => [id, [document.createElement("span"), document.createElement("div")]]));
  const hl = createWordHighlighter((id) => els.get(id) ?? []);
  const marked = () => [...els].filter(([, list]) => list.every((e) => e.classList.contains("hl-sentence"))).map(([id]) => id);
  return { hl, els, marked };
}

it("set adds hl-<style> to every target of each word", () => {
  const { hl, marked } = setup();
  hl.set("sentence", [1, 2]);
  expect(marked()).toEqual([1, 2]);
});

it("set replaces the previous words of that style", () => {
  const { hl, els, marked } = setup();
  hl.set("sentence", [1, 2]);
  hl.set("sentence", [3]);
  expect(marked()).toEqual([3]);
  expect(els.get(1)![0].classList.contains("hl-sentence")).toBe(false);
});

it("clear removes one style, or all styles without an argument", () => {
  const { hl, marked } = setup();
  hl.set("sentence", [1]);
  hl.clear("sentence");
  expect(marked()).toEqual([]);
  hl.set("sentence", [2]);
  hl.clear();
  expect(marked()).toEqual([]);
});

it("ignores unknown word ids", () => {
  const { hl, marked } = setup();
  hl.set("sentence", [42, 1]);
  expect(marked()).toEqual([1]);
});

describe("highlight CSS", () => {
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)]
    .flatMap(([, list]) => list.split(",").map((s) => s.trim()));

  it("no .hl-* rule targets ::before or ::after (the word hit area must never change)", () => {
    const bad = selectors.filter((s) => s.includes(".hl-") && /:{1,2}(before|after)\b/.test(s));
    expect(bad).toEqual([]);
  });

  it("styles the sentence highlight on words and boxes", () => {
    expect(declarations(".word.hl-sentence")).toContain("text-decoration");
    expect(declarations(".box.hl-sentence")).toContain("border-style: dashed");
  });
});

describe("independent styles", () => {
  it("setting one style never clears another; clear(style) leaves the rest", () => {
    const { hl, els } = setup();
    const has = (id: number, style: string) => els.get(id)!.every((e) => e.classList.contains(`hl-${style}`));
    hl.set("verb-part", [1, 2]);
    hl.set("collocation", [2, 3]);
    expect(has(2, "verb-part") && has(2, "collocation")).toBe(true);
    hl.clear("verb-part");
    expect(has(1, "verb-part")).toBe(false);
    expect(has(2, "verb-part")).toBe(false);
    expect(has(2, "collocation") && has(3, "collocation")).toBe(true);
    hl.set("verb-part", [1]);
    hl.clear();
    for (const id of [1, 2, 3]) for (const style of ["verb-part", "collocation", "sentence"]) expect(has(id, style)).toBe(false);
  });
});

describe("part highlight CSS", () => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = (selector: string) => plain.indexOf(`${selector} {`);

  it("outlines verb parts and collocations on words", () => {
    expect(declarations(".word.hl-verb-part")).toContain("outline: 0.125rem solid var(--violet-600)");
    expect(declarations(".word.hl-collocation")).toContain("outline: 0.125rem dashed var(--emerald-700)");
  });

  it("colours the boxes with a solid and a dotted border", () => {
    expect(declarations(".box.hl-verb-part")).toContain("border-style: solid");
    expect(declarations(".box.hl-collocation")).toContain("border-style: dotted");
  });

  it("never fights hl-sentence or .selected on words", () => {
    for (const selector of [".word.hl-verb-part", ".word.hl-collocation"]) {
      const body = declarations(selector);
      for (const forbidden of ["text-decoration", "box-shadow", "background"]) expect(body).not.toContain(forbidden);
    }
  });

  it("declares the box rules after .box.hl-sentence so the part style wins", () => {
    const sentence = at(".box.hl-sentence");
    expect(sentence).toBeGreaterThan(-1);
    expect(at(".box.hl-verb-part")).toBeGreaterThan(sentence);
    expect(at(".box.hl-collocation")).toBeGreaterThan(sentence);
  });
});
