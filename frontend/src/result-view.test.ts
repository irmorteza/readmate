import { afterEach, describe, expect, it, vi } from "vitest";
import example from "../../contract/word-info.example.json";
import { parseOcrResult } from "./contract";
import { setClipboard } from "./debug-test-helpers";
import { createResultView } from "./result-view";
import { clearToken, saveToken } from "./settings";
import { declarations } from "./test-css";
import { emptyResult, gappedResult, sentenceResult } from "./test-fixtures";
import { createApiTranslationService, type TranslationService, type WordInfo } from "./translation";
import { WordLookupError } from "./word-info-api";
import type { WordInfoRequest } from "./word-info-contract";

const info = (word: string): WordInfo => ({
  word,
  pos: "Noun (der)",
  phonetic: "/ipa/",
  translation: "Translated " + word,
  exampleDe: "Example for " + word,
  exampleEn: "Translated example for " + word,
});

function service(lookup?: TranslationService["lookup"]): TranslationService & { lookup: ReturnType<typeof vi.fn> } {
  return { lookup: vi.fn(lookup ?? (async (request) => info(request.word))) };
}

function fakeDevMode(initial = false) {
  let on = initial;
  const subs = new Set<(on: boolean) => void>();
  return {
    get: () => on,
    subscribe: (fn: (on: boolean) => void) => (subs.add(fn), () => subs.delete(fn)),
    set(next: boolean) { on = next; subs.forEach((fn) => fn(next)); },
  };
}

function mount(
  result = gappedResult,
  translation: TranslationService = service(),
  extra: { pageLabel?: string; sentenceTranslation?: string } = {},
  devMode = fakeDevMode(),
) {
  const onNewPhoto = vi.fn();
  const speak = vi.fn();
  const comingSoon = vi.fn();
  const view = createResultView(
    { result, imageUrl: "blob:img", ...extra },
    { translation, onNewPhoto, speak, comingSoon, devMode, build: "abc1234" },
  );
  document.body.replaceChildren(view);
  return { view, onNewPhoto, translation, speak, comingSoon, devMode };
}

const pane = (name: string) => document.querySelector<HTMLElement>(`[data-pane="${name}"]`)!;
const tab = (name: string) => document.querySelector<HTMLElement>(`[data-tab="${name}"]`)!;
const word = (id: number) => document.querySelector<HTMLElement>(`.word[data-word-id="${id}"]`)!;
const sheet = () => document.querySelector<HTMLElement>(".sheet")!;
const text = (selector: string) => sheet().querySelector(selector)?.textContent;

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setClipboard(undefined);
});

describe("tabs", () => {
  it("offers Smart Image and Clean Text, with Clean Text active first", () => {
    mount();
    expect(tab("image").textContent).toContain("Smart Image");
    expect(tab("text").textContent).toContain("Clean Text");
    expect(tab("text").getAttribute("aria-selected")).toBe("true");
    expect(pane("text").hidden).toBe(false);
    expect(pane("image").hidden).toBe(true);
  });

  it("switches panes and the selected tab", () => {
    mount();
    tab("image").click();
    expect(pane("image").hidden).toBe(false);
    expect(pane("text").hidden).toBe(true);
    expect(tab("image").getAttribute("aria-selected")).toBe("true");
    expect(tab("text").getAttribute("aria-selected")).toBe("false");
    tab("text").click();
    expect(pane("text").hidden).toBe(false);
  });
});

describe("reader bar", () => {
  it("has a rescan button that returns to the empty state through onNewPhoto", () => {
    const { onNewPhoto } = mount();
    const rescan = document.querySelector<HTMLButtonElement>("button.rescan")!;
    expect(rescan.getAttribute("aria-label")).toBe("New photo");
    rescan.click();
    expect(onNewPhoto).toHaveBeenCalledTimes(1);
  });
});

describe("word buttons", () => {
  it("every word is a button", () => {
    mount();
    const words = [...document.querySelectorAll(".word")];
    expect(words).toHaveLength(2);
    expect(words.every((w) => w.tagName === "BUTTON")).toBe(true);
  });

  it("a long compound can still wrap inside the line", () => {
    const rule = declarations(".word");
    expect(rule).toContain("overflow-wrap: anywhere");
    expect(rule).toContain("max-width: 100%");
  });

  it("renders a very long German compound whole in one button", () => {
    const result = structuredClone(gappedResult);
    result.boxes[1].raw = "Donaudampfschifffahrtsgesellschaft";
    mount(result);
    expect(word(9).textContent).toBe("Donaudampfschifffahrtsgesellschaft");
  });
});

describe("optional cards", () => {
  it("shows neither the page label nor the sentence card by default", () => {
    mount();
    expect(document.querySelector(".page-label")).toBeNull();
    expect(document.querySelector(".sentence-card")).toBeNull();
  });

  it("shows them when a value is provided", () => {
    mount(gappedResult, service(), {
      pageLabel: "Page 42 • Extracted Text",
      sentenceTranslation: "Reading books expands vocabulary.",
    });
    expect(document.querySelector(".page-label")?.textContent).toBe("Page 42 • Extracted Text");
    const card = document.querySelector(".sentence-card")!;
    expect(card.textContent).toContain("Full Sentence Translation");
    expect(card.textContent).toContain("Reading books expands vocabulary.");
  });
});

describe("clean text", () => {
  it("renders one tappable span per word in reading order", () => {
    mount();
    expect([...document.querySelectorAll(".word")].map((w) => w.textContent)).toEqual([
      "Vorstellungskraft",
      "war",
    ]);
  });

  it("keeps surrounding punctuation, also on a hyphen-merged word", () => {
    const result = structuredClone(gappedResult);
    result.boxes[2].raw = "lungskraft,";
    result.boxes[1].raw = "»war.«";
    mount(result);
    expect([...document.querySelectorAll(".word")].map((w) => w.textContent)).toEqual([
      "Vorstellungskraft,",
      "»war.«",
    ]);
  });

  it("explains how to use it", () => {
    mount();
    expect(pane("text").textContent).toContain("Tap word for translation & audio");
    expect(pane("text").querySelector(".badge")?.textContent).toBe("DE ➔ EN");
  });
});

describe("translation sheet", () => {
  it("is hidden until a word is tapped", () => {
    mount();
    expect(sheet().hidden).toBe(true);
  });

  it("shows the word and the service output after a tap", async () => {
    mount();
    word(9).click();
    await vi.waitFor(() => expect(text(".translation")).toBe("Translated war"));
    expect(sheet().hidden).toBe(false);
    expect(text(".sheet-word")).toBe("war");
    expect(text(".pos")).toBe("Noun (der)");
    expect(text(".phonetic")).toBe("/ipa/");
    expect(text(".example-de")).toBe("Example for war");
    expect(text(".example-en")).toBe("Translated example for war");
    expect(sheet().textContent).toContain("English Translation");
    expect(sheet().textContent).toContain("Example Sentence");
    expect(sheet().textContent).toContain("Save to Flashcards");
  });

  it("shows the word at once and placeholders until the lookup resolves", async () => {
    let resolve!: (v: WordInfo) => void;
    mount(
      gappedResult,
      service(() => new Promise<WordInfo>((r) => (resolve = r))),
    );
    word(9).click();
    expect(sheet().hidden).toBe(false);
    expect(text(".sheet-word")).toBe("war");
    expect(text(".translation")).toBe("…");
    resolve(info("war"));
    await vi.waitFor(() => expect(text(".translation")).toBe("Translated war"));
  });

  it("sends the built request", async () => {
    const { translation } = mount();
    word(2).click();
    await vi.waitFor(() => expect(translation.lookup).toHaveBeenCalled());
    expect(translation.lookup).toHaveBeenCalledWith({
      word: "Vorstellungskraft",
      wordIndex: 0,
      sentence: { kind: "fragment", words: ["Vorstellungskraft", "war"] },
      target: "en",
    });
  });

  it("ignores a slow lookup that finishes after another word was tapped", async () => {
    const pending = new Map<string, (v: WordInfo) => void>();
    mount(
      gappedResult,
      service((req) => new Promise<WordInfo>((r) => pending.set(req.word, r))),
    );
    word(2).click();
    word(9).click();
    pending.get("war")!(info("war"));
    await vi.waitFor(() => expect(text(".translation")).toBe("Translated war"));
    pending.get("Vorstellungskraft")!(info("Vorstellungskraft"));
    await Promise.resolve();
    await Promise.resolve();
    expect(text(".sheet-word")).toBe("war");
    expect(text(".translation")).toBe("Translated war");
  });

  it("shows an unavailable message when the lookup fails", async () => {
    mount(
      gappedResult,
      service(async () => {
        throw new Error("down");
      }),
    );
    word(9).click();
    await vi.waitFor(() => expect(text(".translation")).toBe("Translation unavailable"));
  });

  it("closes with the Close button and with the handle, and clears the highlight", async () => {
    mount();
    word(9).click();
    await vi.waitFor(() => expect(text(".translation")).toBe("Translated war"));
    sheet().querySelector<HTMLElement>('button[aria-label="Close"]')!.click();
    expect(sheet().hidden).toBe(true);
    expect(word(9).classList.contains("selected")).toBe(false);
    word(9).click();
    sheet().querySelector<HTMLElement>(".handle")!.click();
    expect(sheet().hidden).toBe(true);
  });
});

describe("sheet backdrop and wiring", () => {
  const backdrop = () => document.querySelector<HTMLElement>(".sheet-backdrop")!;

  it("shows a backdrop with the sheet and tapping it closes the sheet and clears the highlight", async () => {
    mount();
    expect(backdrop().hidden).toBe(true);
    word(9).click();
    expect(backdrop().hidden).toBe(false);
    backdrop().click();
    expect(sheet().hidden).toBe(true);
    expect(backdrop().hidden).toBe(true);
    expect(word(9).classList.contains("selected")).toBe(false);
  });

  it("closing the sheet while a lookup is pending does not reopen or refill it", async () => {
    let resolve!: (v: WordInfo) => void;
    mount(
      gappedResult,
      service(() => new Promise<WordInfo>((r) => (resolve = r))),
    );
    word(9).click();
    backdrop().click();
    resolve(info("war"));
    await Promise.resolve();
    await Promise.resolve();
    expect(sheet().hidden).toBe(true);
    expect(text(".translation")).not.toBe("Translated war");
  });

  it("the speaker button speaks the tapped word through the injected speak", async () => {
    const { speak } = mount();
    word(9).click();
    await vi.waitFor(() => expect(text(".translation")).toBe("Translated war"));
    sheet().querySelector<HTMLElement>('button[aria-label="Play pronunciation"]')!.click();
    expect(speak).toHaveBeenCalledWith("war");
  });

  it("Save to Flashcards reports coming soon through the injected callback", () => {
    const { comingSoon } = mount();
    word(9).click();
    [...sheet().querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Save to Flashcards"))!
      .click();
    expect(comingSoon).toHaveBeenCalledWith("Save to Flashcards");
  });
});

describe("selection is shared by both tabs", () => {
  it("highlights the clean-text word when its box is tapped in Smart Image", () => {
    mount();
    document.querySelector<HTMLElement>('[data-box-id="7"]')!.click();
    expect(word(9).classList.contains("selected")).toBe(true);
    expect(word(2).classList.contains("selected")).toBe(false);
  });

  it("highlights every box of a merged word when its clean-text word is tapped", () => {
    mount();
    word(2).click();
    const selected = [...document.querySelectorAll(".box.selected")].map((b) =>
      Number((b as HTMLElement).dataset.boxId),
    );
    expect(selected).toEqual([3, 12]);
    expect(word(2).classList.contains("selected")).toBe(true);
  });
});

describe("other behavior", () => {
  it("tells the user when no text was found and offers a new photo", () => {
    const { onNewPhoto } = mount(emptyResult);
    expect(document.body.textContent).toContain(
      "No text found — try more light and hold the phone parallel to the page.",
    );
    [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New photo"))!.click();
    expect(onNewPhoto).toHaveBeenCalledTimes(1);
  });

  it("keeps the zoom and outline controls in the Smart Image pane", () => {
    mount();
    const labels = [...pane("image").querySelectorAll("button, label")].map((e) => e.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(["Fit", "2×", "3×"]));
    expect(pane("image").textContent).toContain("Outlines");
  });
});

describe("Clean Text reads like a continuous paragraph", () => {
  it("lays the words out like running text with tight natural spacing", () => {
    const words = declarations(".words");
    expect(words).toContain("column-gap: 0.125rem");
    expect(words).toContain("align-items: baseline");
    expect(words).toContain("line-height: 1.625");
    expect(words).toContain("flex-wrap: wrap");
  });

  it("an ordinary word has no border, shadow or background and only a hairline of padding", () => {
    const word = declarations(".word");
    expect(word).toContain("border: 0");
    expect(word).toContain("background: transparent");
    expect(word).toContain("padding: 0.125rem");
    expect(word).not.toContain("box-shadow");
    expect(word).not.toMatch(/border:\s*[12]px/);
    expect(word).not.toContain("min-height");
  });

  it("feedback appears only while hovering or tapping a word", () => {
    expect(declarations(".word:hover")).toContain("background: #e0e7ff");
    expect(declarations(".word:hover")).toContain("color: var(--indigo-700)");
    expect(declarations(".word:active")).toContain("background: #c7d2fe");
  });

  it("the selected word is a soft yellow highlight with a thin yellow ring and a dot", () => {
    const selected = declarations(".word.selected");
    expect(selected).toContain("background: #fef08a");
    expect(selected).toContain("font-weight: 700");
    expect(selected).toContain("box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.8)");
    const dot = declarations(".word.selected::after");
    expect(dot).toContain('content: ""');
    expect(dot).toContain("border-radius: 50%");
    expect(dot).toContain("var(--indigo-600)");
  });

  it("words are small, so each one gets an invisible hit area that tiles the line", () => {
    expect(declarations(".word")).toContain("position: relative");
    const before = declarations(".word::before");
    expect(before).toContain('content: ""');
    expect(before).toContain("position: absolute");
    expect(before).toMatch(/inset:\s*-0\.1875rem/);
  });
});

describe("sentences and developer mode", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const outlined = () => [...document.querySelectorAll<HTMLElement>(".word.hl-sentence")].map((e) => Number(e.dataset.wordId));
  const outlinedBoxes = () => [...document.querySelectorAll<HTMLElement>(".box.hl-sentence")].map((e) => Number(e.dataset.boxId));
  const panel = () => document.querySelector<HTMLDetailsElement>("details.debug")!;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("looks up with the sentence pieces", () => {
    const { translation } = mount(sentenceResult);
    word(9).click();
    expect(translation.lookup).toHaveBeenCalledWith({
      word: "war",
      wordIndex: 1,
      sentence: { kind: "sentence", words: ["Vorstellungskraft", "war"] },
      target: "en",
    });
  });

  it("looks up with the words of the lines when there are no sentences", () => {
    const { translation } = mount(gappedResult);
    word(2).click();
    expect(translation.lookup).toHaveBeenCalledWith({
      word: "Vorstellungskraft",
      wordIndex: 0,
      sentence: { kind: "fragment", words: ["Vorstellungskraft", "war"] },
      target: "en",
    });
  });

  it("with developer mode off: no outline, debug panel hidden and empty", () => {
    mount(sentenceResult);
    word(9).click();
    expect(outlined()).toEqual([]);
    expect(panel().hidden).toBe(true);
    expect(panel().querySelector(".debug-body")!.textContent).toBe("");
  });

  it("with developer mode on: outlines the sentence in text and image, panel present and closed", () => {
    mount(sentenceResult, service(), {}, fakeDevMode(true));
    word(9).click();
    expect(outlined()).toEqual([2, 9]);
    expect(outlinedBoxes().sort((a, b) => a - b)).toEqual([3, 7, 12]);
    expect(panel().hidden).toBe(false);
    expect(panel().open).toBe(false);
  });

  it("a highlighted neighbour is still tappable and selects itself", () => {
    const { translation } = mount(sentenceResult, service(), {}, fakeDevMode(true));
    word(9).click();
    word(2).click();
    expect(word(2).classList.contains("selected")).toBe(true);
    expect(translation.lookup).toHaveBeenLastCalledWith({
      word: "Vorstellungskraft",
      wordIndex: 0,
      sentence: { kind: "sentence", words: ["Vorstellungskraft", "war"] },
      target: "en",
    });
  });

  it("a tap on a word without a sentence clears the outline", () => {
    const result = { ...sentenceResult, sentences: [{ id: 0, kind: "fragment" as const, wordIds: [2], text: "Vorstellungskraft" }] };
    mount(result, service(), {}, fakeDevMode(true));
    word(2).click();
    expect(outlined()).toEqual([2]);
    word(9).click();
    expect(outlined()).toEqual([]);
  });

  it("closing the sheet clears the outline and the panel", () => {
    mount(sentenceResult, service(), {}, fakeDevMode(true));
    word(9).click();
    document.querySelector<HTMLButtonElement>('.sheet button[aria-label="Close"]')!.click();
    expect(outlined()).toEqual([]);
    expect(panel().hidden).toBe(true);
  });

  it("turning developer mode off clears at once and a late lookup does not bring it back", async () => {
    let resolve!: (info: WordInfo) => void;
    const dev = fakeDevMode(true);
    mount(sentenceResult, service(() => new Promise((r) => (resolve = r))), {}, dev);
    word(9).click();
    dev.set(false);
    expect(outlined()).toEqual([]);
    expect(panel().hidden).toBe(true);
    resolve(info("war"));
    await flush();
    expect(panel().hidden).toBe(true);
    expect(outlined()).toEqual([]);
  });

  it("shows the result of the latest tap only", async () => {
    const pending: Array<(i: WordInfo) => void> = [];
    mount(sentenceResult, service(() => new Promise((r) => pending.push(r))), {}, fakeDevMode(true));
    word(2).click();
    word(9).click();
    pending[1](info("war"));
    pending[0](info("Vorstellungskraft"));
    await flush();
    const resultText = panel().querySelector('[data-debug="result"]')!.textContent!;
    expect(resultText).toContain("Translated war");
    expect(resultText).not.toContain("Translated Vorstellungskraft");
  });

  it("an ignored-sentences result still shows and selects words, and the panel says so", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ignored = parseOcrResult({ ...structuredClone(gappedResult), sentences: [{ id: 0, kind: "x", wordIds: [2], text: "" }] })!;
    mount(ignored, service(), {}, fakeDevMode(true));
    word(2).click();
    expect(word(2).classList.contains("selected")).toBe(true);
    expect(panel().textContent).toContain("Sentence data was malformed and ignored");
  });

  it("never puts the token or a request header in the DOM or the copied JSON", async () => {
    saveToken("tok-SECRET-123");
    const writeText = vi.fn(async (_text: string) => {});
    setClipboard({ writeText });
    mount(sentenceResult, service(), {}, fakeDevMode(true));
    word(9).click();
    panel().open = true;
    await flush();
    document.querySelector<HTMLButtonElement>("button.debug-copy")!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    for (const text of [document.body.innerHTML, writeText.mock.calls[0][0]]) {
      expect(text).not.toContain("tok-SECRET-123");
      expect(text).not.toContain("X-Pilot-Token");
    }
    clearToken();
    setClipboard(undefined);
  });
});

describe("review fixes", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const panel = () => document.querySelector<HTMLDetailsElement>("details.debug")!;

  it("turning developer mode on during a lookup shows nothing until the next tap", async () => {
    let resolve!: (info: WordInfo) => void;
    const dev = fakeDevMode(false);
    mount(sentenceResult, service(() => new Promise((r) => (resolve = r))), {}, dev);
    word(9).click();
    dev.set(true);
    resolve(info("war"));
    await flush();
    expect(panel().hidden).toBe(true);
    expect(panel().querySelector(".debug-body")!.textContent).toBe("");
  });

  it("replaced result views unsubscribe: the subscriber count stays bounded", () => {
    const dev = fakeDevMode(false);
    let count = 0;
    const counted = {
      get: dev.get,
      subscribe: (fn: (on: boolean) => void) => {
        count++;
        const off = dev.subscribe(fn);
        return () => (count--, off());
      },
    };
    for (let i = 0; i < 20; i++) mount(sentenceResult, service(), {}, counted as never);
    expect(count).toBeLessThanOrEqual(3);
  });
});

describe("part highlights", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const hl = (style: string) =>
    [...document.querySelectorAll<HTMLElement>(`.word.hl-${style}`)].map((e) => Number(e.dataset.wordId));
  const hlBoxes = (style: string) =>
    [...document.querySelectorAll<HTMLElement>(`.box.hl-${style}`)]
      .map((e) => Number(e.dataset.boxId))
      .sort((a, b) => a - b);
  const panel = () => document.querySelector<HTMLDetailsElement>("details.debug")!;

  const verb = (wordIndexes: number[]) => ({
    infinitive: "vorstellen",
    wordIndexes,
    parts: wordIndexes.map(String),
  });
  const expr = (wordIndexes: number[]) => ({
    text: "zur Verfügung stellen",
    meaning: "to make available",
    type: "verb-pattern",
    wordIndexes,
    parts: wordIndexes.map(String),
  });
  const withGroups = (word: string, groups: Partial<WordInfo>): WordInfo => ({ ...info(word), ...groups });

  /** 150 one-word-per-box sentence; ids are 200+index so ids never equal indexes. */
  function longResult() {
    const texts = Array.from({ length: 150 }, (_, i) => `w${i}`);
    const words = texts.map((text, i) => ({ id: 200 + i, text, boxIds: [200 + i], lineIds: [1] }));
    return {
      version: 1 as const,
      engine: "fake",
      lines: [{ id: 1, text: texts.join(" "), box: { x: 0.1, y: 0.1, w: 0.8, h: 0.03 }, boxIds: words.map((w) => w.id) }],
      boxes: words.map((w, i) => ({
        id: w.id, raw: w.text, lineId: 1, conf: 0.99, wordId: w.id,
        box: { x: 0.1 + (i % 50) * 0.01, y: 0.1, w: 0.01, h: 0.03 },
      })),
      words,
      sentences: [{ id: 0, kind: "sentence" as const, wordIds: words.map((w) => w.id), text: texts.join(" ") }],
    };
  }

  it("highlights the separable verb's words in the text and the image", async () => {
    mount(gappedResult, service(async (req) => withGroups(req.word, { separableVerb: verb([0, 1]) })));
    word(2).click();
    await vi.waitFor(() => expect(hl("verb-part")).toEqual([2, 9]));
    expect(hlBoxes("verb-part")).toEqual([3, 7, 12]);
    expect(hl("collocation")).toEqual([]);
  });

  it("highlights an expression with the collocation style", async () => {
    mount(gappedResult, service(async (req) => withGroups(req.word, { expression: expr([0, 1]) })));
    word(2).click();
    await vi.waitFor(() => expect(hl("collocation")).toEqual([2, 9]));
    expect(hl("verb-part")).toEqual([]);
  });

  it("a response without groups sets no part highlight", async () => {
    mount();
    word(2).click();
    await vi.waitFor(() => expect(text(".translation")).toBe("Translated Vorstellungskraft"));
    expect(hl("verb-part")).toEqual([]);
    expect(hl("collocation")).toEqual([]);
  });

  it("the next tap clears both styles before its own lookup resolves", async () => {
    const pending: Array<(i: WordInfo) => void> = [];
    mount(gappedResult, service((req) => (req.word === "war" ? new Promise<WordInfo>((r) => pending.push(r)) : Promise.resolve(withGroups(req.word, { separableVerb: verb([0, 1]), expression: expr([0, 1]) })))));
    word(2).click();
    await vi.waitFor(() => expect(hl("collocation")).toEqual([2, 9]));
    word(9).click();
    expect(hl("verb-part")).toEqual([]);
    expect(hl("collocation")).toEqual([]);
    expect(hlBoxes("verb-part")).toEqual([]);
  });

  it("closing the sheet clears the part highlights", async () => {
    mount(gappedResult, service(async (req) => withGroups(req.word, { separableVerb: verb([0, 1]) })));
    word(2).click();
    await vi.waitFor(() => expect(hl("verb-part")).toEqual([2, 9]));
    document.querySelector<HTMLButtonElement>('.sheet button[aria-label="Close"]')!.click();
    expect(hl("verb-part")).toEqual([]);
    expect(hlBoxes("verb-part")).toEqual([]);
  });

  it("a stale response with groups sets nothing after another tap", async () => {
    const pending = new Map<string, (v: WordInfo) => void>();
    mount(gappedResult, service((req) => new Promise<WordInfo>((r) => pending.set(req.word, r))));
    word(2).click();
    word(9).click();
    pending.get("war")!(info("war"));
    await vi.waitFor(() => expect(text(".translation")).toBe("Translated war"));
    pending.get("Vorstellungskraft")!(withGroups("Vorstellungskraft", { separableVerb: verb([0, 1]), expression: expr([0, 1]) }));
    await flush();
    expect(hl("verb-part")).toEqual([]);
    expect(hl("collocation")).toEqual([]);
    expect(text(".sheet-word")).toBe("war");
  });

  it("a response arriving after the sheet was closed sets nothing", async () => {
    let resolve!: (v: WordInfo) => void;
    mount(gappedResult, service(() => new Promise<WordInfo>((r) => (resolve = r))));
    word(2).click();
    document.querySelector<HTMLButtonElement>('.sheet button[aria-label="Close"]')!.click();
    resolve(withGroups("Vorstellungskraft", { separableVerb: verb([0, 1]) }));
    await flush();
    expect(hl("verb-part")).toEqual([]);
  });

  it("maps indexes of a windowed lookup through the window's word ids", async () => {
    let sent!: WordInfoRequest;
    mount(longResult(), service(async (req) => {
      sent = req;
      return withGroups(req.word, { separableVerb: verb([0, 1]) });
    }));
    word(340).click();
    await vi.waitFor(() => expect(hl("verb-part")).toHaveLength(2));
    expect(sent.sentence.kind).toBe("incomplete");
    const idOf = (text: string) => 200 + Number(text.slice(1));
    expect(hl("verb-part")).toEqual([idOf(sent.sentence.words[0]), idOf(sent.sentence.words[1])]);
    expect(hl("verb-part")).not.toContain(200);
  });

  it("shows 'Daily lookup limit reached' for a limit failure and the generic message otherwise", async () => {
    mount(gappedResult, service(async () => { throw new WordLookupError("limit"); }));
    word(9).click();
    await vi.waitFor(() => expect(text(".translation")).toBe("Daily lookup limit reached"));
    mount(gappedResult, service(async () => { throw new WordLookupError("busy"); }));
    word(9).click();
    await vi.waitFor(() => expect(text(".translation")).toBe("Translation unavailable"));
    mount(gappedResult, service(async () => { throw new Error("x"); }));
    word(9).click();
    await vi.waitFor(() => expect(text(".translation")).toBe("Translation unavailable"));
  });

  it("records a lookup failure's kind in the debug panel", async () => {
    mount(sentenceResult, service(async () => { throw new WordLookupError("busy"); }), {}, fakeDevMode(true));
    word(9).click();
    await flush();
    expect(panel().querySelector('[data-debug="result"]')!.textContent).toContain("busy");
  });

  it("turning developer mode off keeps the part highlights", async () => {
    const dev = fakeDevMode(true);
    mount(sentenceResult, service(async (req) => withGroups(req.word, { separableVerb: verb([0, 1]) })), {}, dev);
    word(9).click();
    await vi.waitFor(() => expect(hl("verb-part")).toEqual([2, 9]));
    dev.set(false);
    expect(hl("verb-part")).toEqual([2, 9]);
    expect(hl("sentence")).toEqual([]);
  });

  it("a tap on a highlighted neighbour selects that neighbour", async () => {
    const { translation } = mount(sentenceResult, service(async (req) => withGroups(req.word, { separableVerb: verb([0, 1]) })));
    word(9).click();
    await vi.waitFor(() => expect(hl("verb-part")).toEqual([2, 9]));
    word(2).click();
    expect(word(2).classList.contains("selected")).toBe(true);
    expect(translation.lookup).toHaveBeenLastCalledWith(expect.objectContaining({ word: "Vorstellungskraft" }));
  });

  it("the real API service keeps the token out of the DOM and the copied JSON", async () => {
    const body = structuredClone(example.response) as Record<string, any>;
    body.separableVerb = { infinitive: "vorstellen", wordIndexes: [0, 1] };
    vi.stubEnv("VITE_API_URL", "http://api.test");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const writeText = vi.fn(async (_text: string) => {});
    setClipboard({ writeText });
    mount(sentenceResult, createApiTranslationService({ getToken: () => "tok-SECRET-123" }), {}, fakeDevMode(true));
    word(9).click();
    await vi.waitFor(() => expect(text(".translation")).toBe("to introduce"));
    expect(fetchMock.mock.calls[0][1].headers["X-Pilot-Token"]).toBe("tok-SECRET-123");
    panel().open = true;
    document.querySelector<HTMLButtonElement>("button.debug-copy")!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(JSON.parse(writeText.mock.calls[0][0]).format).toBe("readmate-debug/2");
    for (const content of [document.body.innerHTML, writeText.mock.calls[0][0]]) {
      expect(content).not.toContain("tok-SECRET-123");
      expect(content).not.toContain("X-Pilot-Token");
    }
  });
});
