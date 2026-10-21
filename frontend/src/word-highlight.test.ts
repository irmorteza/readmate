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
