import { afterEach, expect, it, vi } from "vitest";
import { createDebugPanel } from "./debug-panel";
import { setClipboard, snap } from "./debug-test-helpers";
import { declarations } from "./test-css";
import { gappedResult, sentenceResult } from "./test-fixtures";
import { buildDebugSnapshot } from "./debug-snapshot";
import { buildLookup } from "./lookup-request";
import { createSelection, type WordSelectedEvent } from "./selection";

afterEach(() => setClipboard(undefined));

const section = (name: string) => document.querySelector<HTMLElement>(`[data-debug="${name}"]`)!;

it("starts hidden and empty; render shows it closed", () => {
  const panel = createDebugPanel();
  document.body.replaceChildren(panel.element);
  expect(panel.element.hidden).toBe(true);
  panel.render(snap(sentenceResult, 9));
  expect(panel.element.hidden).toBe(false);
  expect(panel.element.open).toBe(false);
  expect(panel.element.querySelector("summary")!.textContent).toContain("Debug");
});

it("keeps the open state across renders; clear hides and empties it", () => {
  const panel = createDebugPanel();
  document.body.replaceChildren(panel.element);
  panel.render(snap(sentenceResult, 9));
  panel.element.open = true;
  panel.render(snap(sentenceResult, 2));
  expect(panel.element.open).toBe(true);
  panel.clear();
  expect(panel.element.hidden).toBe(true);
  expect(panel.element.querySelector(".debug-body")!.textContent).toBe("");
});

it("shows word, sentence with the tapped word marked, lines, request with context length, and result", () => {
  const panel = createDebugPanel();
  document.body.replaceChildren(panel.element);
  panel.render(snap(sentenceResult, 9, { status: "ok", response: { translation: "was" }, meta: null }));
  expect(section("word").textContent).toContain("war");
  expect(section("word").textContent).toContain("9");
  expect(section("sentence").querySelector("mark")!.textContent).toBe("war");
  expect(section("sentence").textContent).toContain("sentence");
  expect(section("lines").textContent).toContain("Das Vorstel- war");
  expect(section("request").querySelector("pre")!.textContent).toBe(
    JSON.stringify({ word: "war", wordIndex: 1, sentence: { kind: "sentence", words: ["Vorstellungskraft", "war"] }, target: "en" }, null, 2));
  expect(section("request").querySelector(".debug-context-length")!.textContent).toBe("Context: 21 characters (sentence)");
  expect(section("result").textContent).toContain("stub");
  expect(section("result").textContent).toContain("was");
  expect(section("result").textContent).toContain("none"); // meta is null
});

it("shows the sentence unmarked when its pieces do not match the word ids", () => {
  const s = snap(sentenceResult, 9);
  s.sentence!.text = "Vorstellungs kraft war";
  const panel = createDebugPanel();
  document.body.replaceChildren(panel.element);
  panel.render(s);
  expect(section("sentence").querySelector("mark")).toBeNull();
  expect(section("sentence").textContent).toContain("Vorstellungs kraft war");
});

it.each([
  ["absent", "No sentence data (older backend)"],
  ["ignored", "Sentence data was malformed and ignored"],
  ["not-found", "Word not found in sentences"],
] as const)("explains a missing sentence (%s)", (status, message) => {
  const s = { ...snap(gappedResult, 2), sentenceStatus: status };
  const panel = createDebugPanel();
  document.body.replaceChildren(panel.element);
  panel.render(s);
  expect(section("sentence").textContent).toContain(message);
});

it("Copy JSON writes the snapshot and confirms", async () => {
  const writeText = vi.fn(async (_text: string) => {});
  const panel = createDebugPanel({ writeText });
  document.body.replaceChildren(panel.element);
  const s = snap(sentenceResult, 9);
  panel.render(s);
  const copy = document.querySelector<HTMLButtonElement>("button.debug-copy")!;
  expect(copy.textContent).toBe("Copy JSON");
  copy.click();
  await vi.waitFor(() => expect(copy.textContent).toBe("Copied"));
  expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(s);
});

it("on copy failure shows the JSON in a selected textarea", async () => {
  const panel = createDebugPanel({ writeText: async () => { throw new Error("denied"); } });
  document.body.replaceChildren(panel.element);
  const s = snap(sentenceResult, 9);
  panel.render(s);
  document.querySelector<HTMLButtonElement>("button.debug-copy")!.click();
  await vi.waitFor(() => expect(document.querySelector("button.debug-copy")!.textContent).toBe("Copy failed — select the text below"));
  const area = document.querySelector<HTMLTextAreaElement>("textarea.debug-fallback")!;
  expect(area.hidden).toBe(false);
  expect(area.readOnly).toBe(true);
  expect(JSON.parse(area.value)).toEqual(s);
});

it("falls back when navigator.clipboard does not exist", async () => {
  setClipboard(undefined);
  const panel = createDebugPanel();
  document.body.replaceChildren(panel.element);
  panel.render(snap(sentenceResult, 9));
  document.querySelector<HTMLButtonElement>("button.debug-copy")!.click();
  await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>("textarea.debug-fallback")!.hidden).toBe(false));
});

it("summary and copy button are at least 2.75rem high", () => {
  expect(declarations(".debug summary")).toContain("min-height: 2.75rem");
  expect(declarations(".debug-copy")).toContain("min-height: 2.75rem");
});

it("a new copy attempt cancels the previous Copied timer", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const writeText = vi.fn<(text: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("denied"));
    const panel = createDebugPanel({ writeText });
    document.body.replaceChildren(panel.element);
    panel.render(snap(sentenceResult, 9));
    const copy = document.querySelector<HTMLButtonElement>("button.debug-copy")!;
    copy.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(copy.textContent).toBe("Copied");
    copy.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(copy.textContent).toBe("Copy failed — select the text below");
    await vi.advanceTimersByTimeAsync(2500);
    expect(copy.textContent).toBe("Copy failed — select the text below");
  } finally {
    vi.useRealTimers();
  }
});

it("says when the lookup was windowed", () => {
  const panel = createDebugPanel();
  document.body.replaceChildren(panel.element);
  const s = snap(sentenceResult, 9);
  panel.render({ ...s, lookup: { ...s.lookup, windowed: true } });
  expect(section("request").querySelector(".debug-context-length")!.textContent).toBe(
    "Context: 21 characters (sentence) · windowed");
  panel.render(s);
  expect(section("request").querySelector(".debug-context-length")!.textContent).toBe("Context: 21 characters (sentence)");
});

it("shows the target language code and English name", () => {
  let event!: WordSelectedEvent;
  createSelection(sentenceResult, (e) => (event = e)).select(9);
  const lookup = buildLookup(event, sentenceResult, "fa");
  const panel = createDebugPanel();
  document.body.replaceChildren(panel.element);
  panel.render(
    buildDebugSnapshot({ build: "abc1234", result: sentenceResult, event, lookup, source: "stub", outcome: { status: "pending" } }),
  );
  expect(section("request").textContent).toContain("Target: fa (Persian)");
});
