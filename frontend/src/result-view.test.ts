import { afterEach, describe, expect, it, vi } from "vitest";
import { createResultView } from "./result-view";
import { emptyResult, gappedResult } from "./test-fixtures";
import type { TranslationService, WordInfo } from "./translation";

const info = (word: string): WordInfo => ({
  word,
  pos: "Noun (der)",
  phonetic: "/ipa/",
  translation: "Translated " + word,
  exampleDe: "Example for " + word,
  exampleEn: "Translated example for " + word,
});

function service(lookup?: TranslationService["lookup"]): TranslationService & { lookup: ReturnType<typeof vi.fn> } {
  return { lookup: vi.fn(lookup ?? (async (word: string) => info(word))) };
}

function mount(result = gappedResult, translation: TranslationService = service()) {
  const onNewPhoto = vi.fn();
  const speak = vi.fn();
  const comingSoon = vi.fn();
  const view = createResultView(
    { result, imageUrl: "blob:img" },
    { translation, onNewPhoto, speak, comingSoon },
  );
  document.body.replaceChildren(view);
  return { view, onNewPhoto, translation, speak, comingSoon };
}

const pane = (name: string) => document.querySelector<HTMLElement>(`[data-pane="${name}"]`)!;
const tab = (name: string) => document.querySelector<HTMLElement>(`[data-tab="${name}"]`)!;
const word = (id: number) => document.querySelector<HTMLElement>(`.word[data-word-id="${id}"]`)!;
const sheet = () => document.querySelector<HTMLElement>(".sheet")!;
const text = (selector: string) => sheet().querySelector(selector)?.textContent;

afterEach(() => document.body.replaceChildren());

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
    expect(pane("text").textContent).toContain("Tap any word to see translation");
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

  it("passes the real text of the lines the word is on as context", async () => {
    const { translation } = mount();
    word(2).click();
    await vi.waitFor(() => expect(translation.lookup).toHaveBeenCalled());
    expect(translation.lookup).toHaveBeenCalledWith(
      "Vorstellungskraft",
      "Das Vorstel- war lungskraft groß",
    );
  });

  it("ignores a slow lookup that finishes after another word was tapped", async () => {
    const pending = new Map<string, (v: WordInfo) => void>();
    mount(
      gappedResult,
      service((w) => new Promise<WordInfo>((r) => pending.set(w, r))),
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

  it("calls onNewPhoto from the result screen", () => {
    const { onNewPhoto } = mount();
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
