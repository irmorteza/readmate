# Sentences in the Frontend and Developer Debug Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume the optional `sentences` field in the PWA (types, a guard that can never break word display, sentence as lookup context), and add a developer mode with a Debug section in the word sheet and a generic word highlighter that outlines the tapped word's sentence.

**Architecture:** Small focused modules in `frontend/src`: `contract.ts` gains types plus `parseOcrResult`; `selection.ts` attaches the sentence to the selection event; new `lookup-request.ts`, `dev-mode.ts`, `debug-snapshot.ts` (pure data), `debug-panel.ts` (DOM), `word-highlight.ts` (generic class-based highlighter). `result-view.ts` wires them; `main.ts` passes developer-mode functions and the build sha.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom, `css: true`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-21-readmate-dev-debug-panel-design.md` — read it first; "§n" below refers to it. UI rules: `docs/superpowers/specs/2026-10-18-readmate-ui-v2-design.md` §11. Project rules: `CLAUDE.md`.

## Stop rules (mandatory)

- **Stop and report** if any change outside `frontend/src` would be needed (backend, `contract/`, CI, `vite.config.ts`, `package.json`, `tsconfig.json`, any other config).
- **Stop and report** if an existing test fails and fixing it means changing what that test asserts. Updating a test *helper* to pass new required dependencies (Task 6, `mount` in `result-view.test.ts`) is allowed; changing an `expect` is not.
- **Local commits per task; never push.** Never `git push`, never open a PR.

## Commands

All from `frontend/`:

- One file: `npx vitest run src/<name>.test.ts`
- All tests: `npx vitest run` — baseline before this work: 24 files, 221 tests, all passing.
- Types: `npx tsc --noEmit` — must print nothing and exit 0.

## Global Constraints

- Works with an old backend (no `sentences`) and the new one. A malformed `sentences` field is dropped; the OCR result is still accepted (§3).
- `TranslationService.lookup(word: string, context: string): Promise<WordInfo>` keeps its signature.
- localStorage key `readmate.devMode`, value `"1"` when on, key removed when off; off by default; works in production builds (no `import.meta.env.DEV` checks).
- The token (`readmate.token`) and request headers never reach the DOM or the copied JSON. No new module imports `settings.ts` or `api.ts`.
- Units in rem. Touch targets of new controls ≥ 2.75rem high. Text contrast ≥ 4.5:1 (use slate-600 or darker for debug text; the existing `.label` is slate-400 — do not reuse it in the panel).
- No `.hl-*` CSS rule may target `::before`/`::after` (or `:before`/`:after`) (§8).
- Copy strings exactly: "Developer mode", "Debug", "Copy JSON", "Copied", "Copy failed — select the text below", "No sentence data (older backend)", "Sentence data was malformed and ignored", "Word not found in sentences", "Context: N characters (sentence)" / "(lines)", "none".
- Match the surrounding style: the `h()`/`button()` helpers from `dom.ts`, `icon()` from `icons.ts`, short doc comments only where the code is not obvious.

## Review Focus

- A `sentences` entry that references a word id missing from `words` (backend bug): the result must still display and the word must still be tappable, with the panel saying "Sentence data was malformed and ignored". Test in Task 1 (guard) and Task 6 (view with an ignored-sentences result).
- A word that is in `words` but in no sentence (backend omitted it): lookup falls back to the line context; panel says "Word not found in sentences". Tests in Task 2 and Task 5.
- Rapid taps where an earlier lookup resolves after a later tap: the panel must show the latest word's data, never the earlier one. Test in Task 6.
- Turning developer mode off while the sheet is open: outline and panel disappear at once; nothing reappears when the pending lookup resolves. Test in Task 6.
- `navigator.clipboard` missing entirely (plain http on a LAN IP): Copy JSON shows the fallback textarea instead of throwing. Test in Task 5.

---

### Task 1: Contract types, strict guard, `parseOcrResult`

**Files:**
- Modify: `frontend/src/contract.ts`, `frontend/src/api.ts`, `frontend/src/test-fixtures.ts`
- Test: `frontend/src/contract.test.ts`, `frontend/src/api.test.ts`

**Interfaces:**
- Produces (in `contract.ts`):
  - `export type SentenceKind = "sentence" | "fragment" | "incomplete";`
  - `export interface OcrSentence { id: number; kind: SentenceKind; wordIds: number[]; text: string; }`
  - `OcrResult.sentences?: OcrSentence[]`
  - `isOcrResult(x: unknown): x is OcrResult` — now also validates `sentences` when the key is present (§3).
  - `export function parseOcrResult(x: unknown): OcrResult | null`
  - `export function sentencesIgnored(result: OcrResult): boolean`
- Produces (in `test-fixtures.ts`): `export const sentenceResult: OcrResult` = `gappedResult` plus `sentences: [{ id: 0, kind: "sentence", wordIds: [2, 9], text: "Vorstellungskraft war" }]`.

- [ ] **Step 1: Write the failing tests** — add to `contract.test.ts` (import `parseOcrResult`, `sentencesIgnored`):

```ts
const malformed: Array<[string, (c: Record<string, any>) => void]> = [
  ["unknown kind", (c) => (c.sentences[0].kind = "paragraph")],
  ["unknown word id", (c) => c.sentences[0].wordIds.push(999)],
  ["empty wordIds", (c) => (c.sentences[0].wordIds = [])],
  ["null", (c) => (c.sentences = null)],
  ["not an array", (c) => (c.sentences = { 0: {} })],
  ["entry missing text", (c) => delete c.sentences[0].text],
  ["negative id", (c) => (c.sentences[0].id = -1)],
];

describe("sentences", () => {
  it("accepts the example with sentences", () => {
    expect(example.sentences).toHaveLength(1);
    expect(isOcrResult(example)).toBe(true);
  });

  it.each(malformed)("isOcrResult rejects sentences with %s", (_, breakIt) => {
    const copy = clone();
    breakIt(copy);
    expect(isOcrResult(copy)).toBe(false);
  });

  it.each(malformed)("parseOcrResult drops sentences with %s and keeps the words", (_, breakIt) => {
    const copy = clone();
    breakIt(copy);
    const parsed = parseOcrResult(copy)!;
    expect(parsed).not.toBeNull();
    expect(parsed.words).toEqual(example.words);
    expect("sentences" in parsed).toBe(false);
    expect(sentencesIgnored(parsed)).toBe(true);
  });

  it("parseOcrResult returns a valid result unchanged and not ignored", () => {
    const copy = clone();
    expect(parseOcrResult(copy)).toBe(copy);
    expect(sentencesIgnored(copy as never)).toBe(false);
  });

  it("parseOcrResult accepts a result without sentences, not marked ignored", () => {
    const copy = clone();
    delete copy.sentences;
    expect(sentencesIgnored(parseOcrResult(copy)!)).toBe(false);
  });

  it("parseOcrResult returns null when the core is broken, even with bad sentences", () => {
    const copy = clone();
    delete copy.words;
    copy.sentences = null;
    expect(parseOcrResult(copy)).toBeNull();
  });
});
```

Silence the warning in these tests with `vi.spyOn(console, "warn").mockImplementation(() => {})` in a `beforeEach` of this `describe` (and `vi.restoreAllMocks()` in `afterEach`); add one assertion in the "drops" test: `expect(console.warn).toHaveBeenCalledWith("readmate: ignoring malformed sentences")`.

Add to `api.test.ts`:

```ts
it("accepts a response whose sentences are malformed, keeping the words", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const body = structuredClone(example) as Record<string, any>;
  body.sentences[0].kind = "bogus";
  vi.stubGlobal("fetch", respond(200, body));
  const result = await postOcr(blob, "tok");
  expect(result.words).toEqual(example.words);
  expect(result.sentences).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/contract.test.ts src/api.test.ts`
Expected: FAIL (`parseOcrResult` is not exported; malformed variants accepted).

- [ ] **Step 3: Implement in `contract.ts`**

Add the types; `isSentence(x, wordIds: Set<number>)` checks §3 (id `isId`, kind in the enum, `wordIds` non-empty `isIdList` with every id in the set, `text` string). In `isOcrResult`, after the existing checks: `(!("sentences" in x) || (Array.isArray(x.sentences) && x.sentences.every((s) => isSentence(s, ids))))` where `ids` is built from `x.words` only after `words` passed. `parseOcrResult`: as §3 — shallow copy via `const { sentences: _, ...rest } = x`; a module-level `const ignored = new WeakSet<OcrResult>()`; `console.warn("readmate: ignoring malformed sentences")`. Update the file's header comment to note the deliberate difference: the frontend drops malformed `sentences` instead of rejecting.

In `api.ts` replace the `isOcrResult` check with `const result = parseOcrResult(data); if (!result) throw new AppError("generic"); return result;`. Add `sentenceResult` to `test-fixtures.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/contract.test.ts src/api.test.ts` → PASS. Then `npx vitest run` and `npx tsc --noEmit` → all pass, no output from tsc.

- [ ] **Step 5: Commit**

```bash
git add src/contract.ts src/contract.test.ts src/api.ts src/api.test.ts src/test-fixtures.ts
git commit -m "feat(frontend): sentence types; drop malformed sentences instead of rejecting the result"
```

---

### Task 2: Sentence on the selection event, lookup request, translation source

**Files:**
- Modify: `frontend/src/selection.ts`, `frontend/src/translation.ts`
- Create: `frontend/src/lookup-request.ts`
- Test: `frontend/src/selection.test.ts`, `frontend/src/lookup-request.test.ts` (new), `frontend/src/translation.test.ts`

**Interfaces:**
- Consumes: `OcrSentence`, `SentenceKind`, `sentenceResult` (Task 1).
- Produces:
  - `selection.ts`: `export interface SelectedSentence { id: number; kind: SentenceKind; text: string; wordIds: number[]; wordIndex: number; }`; `WordSelectedEvent.sentence?: SelectedSentence`.
  - `lookup-request.ts`: `export interface LookupRequest { word: string; context: string; }`, `export type ContextSource = "sentence" | "lines";`, `export function buildLookupRequest(event: WordSelectedEvent): { request: LookupRequest; contextSource: ContextSource }`.
  - `translation.ts`: `TranslationService` gains `readonly source?: string`; `stubTranslationService.source === "stub"`.

- [ ] **Step 1: Write the failing tests**

`selection.test.ts`:

```ts
it("adds the tapped word's sentence with its position", () => {
  const onWordSelected = vi.fn();
  createSelection(sentenceResult, onWordSelected).select(9);
  expect(onWordSelected.mock.calls[0][0].sentence).toEqual({
    id: 0, kind: "sentence", text: "Vorstellungskraft war", wordIds: [2, 9], wordIndex: 1,
  });
});

it("has no sentence for a result without sentences, keeping the other fields", () => {
  const onWordSelected = vi.fn();
  createSelection(gappedResult, onWordSelected).select(2);
  const event = onWordSelected.mock.calls[0][0];
  expect(event.sentence).toBeUndefined();
  expect(event.lineTexts).toEqual(["Das Vorstel- war", "lungskraft groß"]);
});

it("has no sentence for a word that no sentence contains", () => {
  const result = { ...sentenceResult, sentences: [{ id: 0, kind: "fragment" as const, wordIds: [2], text: "Vorstellungskraft" }] };
  const onWordSelected = vi.fn();
  createSelection(result, onWordSelected).select(9);
  expect(onWordSelected.mock.calls[0][0].sentence).toBeUndefined();
});

it("uses the first sentence when a word appears in two", () => {
  const result = { ...sentenceResult, sentences: [
    { id: 0, kind: "fragment" as const, wordIds: [2], text: "A" },
    { id: 1, kind: "sentence" as const, wordIds: [9, 2], text: "B" },
  ] };
  const onWordSelected = vi.fn();
  createSelection(result, onWordSelected).select(2);
  expect(onWordSelected.mock.calls[0][0].sentence).toMatchObject({ id: 0, wordIndex: 0 });
});
```

`lookup-request.test.ts`:

```ts
const event = (sentence?: SelectedSentence): WordSelectedEvent => ({
  word: gappedResult.words[0], boxes: [], lineTexts: ["Das Vorstel- war", "lungskraft groß"], sentence,
});

it("uses the sentence text as context when there is a sentence", () => {
  expect(buildLookupRequest(event({ id: 0, kind: "sentence", text: "Vorstellungskraft war", wordIds: [2, 9], wordIndex: 0 })))
    .toEqual({ request: { word: "Vorstellungskraft", context: "Vorstellungskraft war" }, contextSource: "sentence" });
});

it("falls back to the joined line texts without a sentence", () => {
  expect(buildLookupRequest(event()))
    .toEqual({ request: { word: "Vorstellungskraft", context: "Das Vorstel- war lungskraft groß" }, contextSource: "lines" });
});
```

`translation.test.ts`: `it("names its source 'stub'", () => expect(stubTranslationService.source).toBe("stub"));`

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/selection.test.ts src/lookup-request.test.ts src/translation.test.ts` → FAIL.

- [ ] **Step 3: Implement**

In `createSelection`, build `const sentenceOf = new Map<number, { sentence: OcrSentence; index: number }>()` once, before `return`, iterating `result.sentences ?? []` and each `wordIds` with `if (!sentenceOf.has(id)) sentenceOf.set(id, …)`. In `select`, add `sentence` to the event only when found (`...(found ? { sentence: { id, kind, text, wordIds, wordIndex: found.index } } : {})`). `buildLookupRequest`: `word: event.word.text`, context per §4.2. Add `source: "stub"` to `stubTranslationService` and `readonly source?: string` to the interface.

- [ ] **Step 4: Run to verify pass**

Run the three files → PASS; `npx vitest run`; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/selection.ts src/selection.test.ts src/lookup-request.ts src/lookup-request.test.ts src/translation.ts src/translation.test.ts
git commit -m "feat(frontend): sentence on the selection event; sentence text as lookup context"
```

---

### Task 3: Developer mode store and drawer switch

**Files:**
- Create: `frontend/src/dev-mode.ts`, `frontend/src/dev-mode.test.ts`
- Modify: `frontend/src/drawer.ts`, `frontend/src/drawer.test.ts`, `frontend/src/styles.css`, `frontend/src/main.ts`

**Interfaces:**
- Produces (`dev-mode.ts`): `getDevMode(): boolean`, `setDevMode(on: boolean): void`, `subscribeDevMode(fn: (on: boolean) => void): () => void`.
- Produces (`drawer.ts`): `DrawerDeps.devMode: boolean`, `DrawerDeps.onDevModeChange: (on: boolean) => void`.

- [ ] **Step 1: Write the failing tests**

`dev-mode.test.ts` (`afterEach`: `vi.restoreAllMocks(); setDevMode(false); localStorage.clear();`):

```ts
it("is off by default", () => expect(getDevMode()).toBe(false));

it("persists '1' when on and removes the key when off", () => {
  setDevMode(true);
  expect(localStorage.getItem("readmate.devMode")).toBe("1");
  expect(getDevMode()).toBe(true);
  setDevMode(false);
  expect(localStorage.getItem("readmate.devMode")).toBeNull();
});

it("reads a stored value", () => {
  localStorage.setItem("readmate.devMode", "1");
  expect(getDevMode()).toBe(true);
});

it("keeps the value in memory when localStorage throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  setDevMode(true);
  expect(getDevMode()).toBe(true);
});

it("notifies subscribers until they unsubscribe", () => {
  const seen: boolean[] = [];
  const off = subscribeDevMode((on) => seen.push(on));
  setDevMode(true);
  off();
  setDevMode(false);
  expect(seen).toEqual([true]);
});
```

`drawer.test.ts`: extend `make(devMode = false)` deps with `devMode` and `onDevModeChange: vi.fn()` (helper change only). Add:

```ts
const devSwitch = (root: HTMLElement) => root.querySelector<HTMLInputElement>('input[role="switch"]')!;

it("shows a Developer mode switch reflecting the stored state", () => {
  expect(devSwitch(make(false).drawer.element).checked).toBe(false);
  const { drawer } = make(true);
  expect(devSwitch(drawer.element).checked).toBe(true);
  expect(devSwitch(drawer.element).closest("label")!.textContent).toContain("Developer mode");
});

it("toggling the switch reports the new state and keeps the drawer open", () => {
  const { drawer, deps } = make(false);
  drawer.open();
  devSwitch(drawer.element).click();
  expect(deps.onDevModeChange).toHaveBeenCalledWith(true);
  expect(drawer.element.hidden).toBe(false);
});

it("the switch row is at least 2.75rem high", () => {
  expect(declarations(".dev-switch")).toContain("min-height: 2.75rem");
});
```

(import `declarations` from `./test-css`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/dev-mode.test.ts src/drawer.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`dev-mode.ts`: same pattern as `settings.ts` (module `let memory = false`; `getDevMode` = `try { return localStorage.getItem(KEY) === "1" } catch { return memory }`; `setDevMode` sets memory, then `setItem(KEY, "1")` / `removeItem(KEY)` in try/catch, then notifies a `Set` of subscribers).

`drawer.ts`: build `const devInput = h("input", { type: "checkbox", checked: deps.devMode, attrs: { role: "switch" }, onchange: () => deps.onDevModeChange(devInput.checked) })` inside `h("label", { class: "dev-switch" }, h("span", { textContent: "Developer mode" }), devInput)`; insert it in `.drawer-foot` directly before the `Version` paragraph.

`styles.css` (near the drawer rules): `.dev-switch` — flex, `justify-content: space-between`, `align-items: center`, `min-height: 2.75rem`, `padding: 0 0.875rem`, font 0.875rem slate-600, `cursor: pointer`. `.dev-switch input` — `appearance: none`, `width: 2.5rem`, `height: 1.5rem`, `border-radius: 999px`, `border: 1px solid var(--slate-500)`, `background: var(--slate-300)`, `position: relative`, `margin: 0`; knob via `.dev-switch input::after` (white circle 1.125rem, `left: 0.125rem`, transition); `.dev-switch input:checked` background and border `var(--indigo-600)`; `:checked::after` moves to the right; `.dev-switch input:focus-visible` `outline: 2px solid var(--indigo-600); outline-offset: 2px`.

`main.ts`: import from `./dev-mode`; pass `devMode: getDevMode(), onDevModeChange: setDevMode` to `createDrawer`.

- [ ] **Step 4: Run to verify pass**

Run the two files, then `npx vitest run`, `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/dev-mode.ts src/dev-mode.test.ts src/drawer.ts src/drawer.test.ts src/styles.css src/main.ts
git commit -m "feat(frontend): developer mode switch in the drawer, stored in localStorage"
```

---

### Task 4: Generic word highlighter and `Overlay.elementsForWord`

**Files:**
- Create: `frontend/src/word-highlight.ts`, `frontend/src/word-highlight.test.ts`
- Modify: `frontend/src/overlay.ts`, `frontend/src/overlay.test.ts`, `frontend/src/styles.css`

**Interfaces:**
- Produces (`word-highlight.ts`):
  - `export type HighlightStyle = "sentence";`
  - `export interface WordHighlighter { set(style: HighlightStyle, wordIds: Iterable<number>): void; clear(style?: HighlightStyle): void; }`
  - `export function createWordHighlighter(targetsFor: (wordId: number) => Element[]): WordHighlighter`
- Produces (`overlay.ts`): `Overlay.elementsForWord(wordId: number): HTMLElement[]`.

- [ ] **Step 1: Write the failing tests**

`word-highlight.test.ts`:

```ts
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
```

(imports: `css from "./styles.css?raw"`, `declarations` from `./test-css`.)

`overlay.test.ts`:

```ts
it("elementsForWord returns the box elements of a word, by id", () => {
  const { overlay } = mount();
  expect(overlay.elementsForWord(2).map((e) => e.dataset.boxId)).toEqual(["3", "12"]);
  expect(overlay.elementsForWord(1)).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/word-highlight.test.ts src/overlay.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`createWordHighlighter`: `Map<HighlightStyle, Element[]>` of currently marked elements; `set` = `clear(style)` then add `hl-${style}` to `targetsFor(id)` of each id and remember them; `clear()` with no argument clears every style in the map. `elementsForWord`: `words.get(wordId)?.boxIds.flatMap((id) => elements.get(id) ?? []) ?? []`.

`styles.css`, after `.word.selected::after`: `.word.hl-sentence { text-decoration: underline dotted var(--indigo-600) 0.125rem; text-underline-offset: 0.25rem; }`; after `.box.selected`: `.box.hl-sentence { border-color: var(--indigo-600); border-style: dashed; }` with a one-line comment that highlight rules must never use pseudo-elements because `.word::before` is the hit area.

- [ ] **Step 4: Run to verify pass**

Run the two files, `npx vitest run`, `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/word-highlight.ts src/word-highlight.test.ts src/overlay.ts src/overlay.test.ts src/styles.css
git commit -m "feat(frontend): generic word highlighter; overlay exposes a word's box elements"
```

---

### Task 5: Debug snapshot, debug panel, word sheet slot

**Files:**
- Create: `frontend/src/debug-snapshot.ts`, `frontend/src/debug-snapshot.test.ts`, `frontend/src/debug-panel.ts`, `frontend/src/debug-panel.test.ts`, `frontend/src/debug-test-helpers.ts` (test-only helpers: `snap` below and `setClipboard`)
- Modify: `frontend/src/word-sheet.ts`, `frontend/src/word-sheet.test.ts`, `frontend/src/styles.css`

**Interfaces:**
- Consumes: `OcrResult`, `sentencesIgnored` (Task 1); `WordSelectedEvent`, `SelectedSentence`, `LookupRequest`, `ContextSource` (Task 2).
- Produces (`debug-snapshot.ts`):
  - `export type SentenceStatus = "ok" | "absent" | "ignored" | "not-found";`
  - `export type LookupOutcome = { status: "pending" } | { status: "ok"; response: Record<string, unknown>; meta?: Record<string, unknown> | null } | { status: "error"; error: string };`
  - `export interface DebugSnapshot` exactly as §6.
  - `export function buildDebugSnapshot(input: { build: string; result: OcrResult; event: WordSelectedEvent; request: LookupRequest; contextSource: ContextSource; source: string; outcome: LookupOutcome }): DebugSnapshot`
- Produces (`debug-panel.ts`):
  - `export interface DebugPanel { element: HTMLDetailsElement; render(snapshot: DebugSnapshot): void; clear(): void; }`
  - `export function createDebugPanel(deps?: { writeText?: (text: string) => Promise<void> }): DebugPanel`
  - DOM hooks used by tests: `details.debug`, `summary`, `.debug-body`, sections `[data-debug="word" | "sentence" | "lines" | "request" | "result"]`, `mark`, `.debug-context-length`, `button.debug-copy`, `textarea.debug-fallback`.
- Produces (`word-sheet.ts`): `WordSheetDeps.debug?: HTMLElement` — appended as last child of `.sheet-body`.

- [ ] **Step 1: Write the failing tests**

`debug-test-helpers.ts` (imported by `debug-snapshot.test.ts`, `debug-panel.test.ts` and, in Task 6, `result-view.test.ts`) — build events with `createSelection(<fixture>, fn).select(id)` and `buildLookupRequest`:

```ts
function snap(result: OcrResult, wordId: number, outcome: LookupOutcome = { status: "pending" }) {
  let event!: WordSelectedEvent;
  createSelection(result, (e) => (event = e)).select(wordId);
  const { request, contextSource } = buildLookupRequest(event);
  return buildDebugSnapshot({ build: "abc1234", result, event, request, contextSource, source: "stub", outcome });
}

/** jsdom has no clipboard; define or remove one on the real navigator object. */
export function setClipboard(value: { writeText(text: string): Promise<void> } | undefined) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}
```

`snap` is exported as `export function snap(...)`. `debug-snapshot.test.ts`:

```ts

it("describes a word with a sentence", () => {
  expect(snap(sentenceResult, 9)).toEqual({
    format: "readmate-debug/1", build: "abc1234", engine: "fake",
    word: { id: 9, text: "war" },
    sentenceStatus: "ok",
    sentence: { id: 0, kind: "sentence", text: "Vorstellungskraft war", wordIds: [2, 9], wordIndex: 1 },
    lineTexts: ["Das Vorstel- war"],
    lookup: { request: { word: "war", context: "Vorstellungskraft war" }, contextSource: "sentence",
      contextLength: 21, status: "pending", source: "stub", response: null, meta: null, error: null },
  });
});

it("reports absent, not-found and ignored sentence data", () => {
  expect(snap(gappedResult, 2).sentenceStatus).toBe("absent");
  const partial = { ...sentenceResult, sentences: [{ id: 0, kind: "fragment" as const, wordIds: [2], text: "X" }] };
  expect(snap(partial, 9).sentenceStatus).toBe("not-found");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const ignored = parseOcrResult({ ...structuredClone(gappedResult), sentences: null })!;
  expect(snap(ignored, 2).sentenceStatus).toBe("ignored");
  expect(snap(ignored, 2).sentence).toBeNull();
});

it("counts the context length of the line fallback", () => {
  expect(snap(gappedResult, 2).lookup.contextLength).toBe("Das Vorstel- war lungskraft groß".length);
});

it("carries an ok response with optional meta, or an error", () => {
  const ok = snap(sentenceResult, 2, { status: "ok", response: { translation: "x" }, meta: { cached: true } });
  expect(ok.lookup).toMatchObject({ status: "ok", response: { translation: "x" }, meta: { cached: true }, error: null });
  const err = snap(sentenceResult, 2, { status: "error", error: "boom" });
  expect(err.lookup).toMatchObject({ status: "error", response: null, meta: null, error: "boom" });
});
```

`debug-panel.test.ts` — imports `snap`, `setClipboard` from `./debug-test-helpers`; mounts `panel.element` in `document.body`:

```ts
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
    JSON.stringify({ word: "war", context: "Vorstellungskraft war" }, null, 2));
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
```

`word-sheet.test.ts`:

```ts
it("mounts an optional debug element as the last child of the sheet body", () => {
  const debug = document.createElement("details");
  const sheet = createWordSheet({ speak: vi.fn(), comingSoon: vi.fn(), onClose: vi.fn(), debug });
  expect(sheet.element.querySelector(".sheet-body")!.lastElementChild).toBe(debug);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/debug-snapshot.test.ts src/debug-panel.test.ts src/word-sheet.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`buildDebugSnapshot`: `sentenceStatus` per §6 in this order: `event.sentence` → `ok`; `sentencesIgnored(result)` → `ignored`; `result.sentences === undefined` → `absent`; else `not-found`. `contextLength: request.context.length`. Pending → `response: null, meta: null, error: null`; ok → `meta: outcome.meta ?? null`.

`createDebugPanel`: `element = h("details", { class: "debug", hidden: true }, summary, body)`; `summary` contains `"Debug"` text and `icon("chevron-right", { size: 16, class: "debug-chevron" })`. `render` rebuilds `body` children only (never touches `open`). Sections as §7 with a `h("h4", { class: "debug-label" })` heading each. Sentence marking: `text.split(" ")`; mark only when `pieces.length === wordIds.length`, rebuilding as text nodes joined by `" "` with `h("mark", …)` at `wordIndex`. Key/value rows for `response`/`meta`: `<dl class="debug-kv">` with `<dt>` key and `<dd>` value (`typeof v === "string" ? v : JSON.stringify(v)`); `meta === null` → `<p>none</p>`. Copy: `const write = deps?.writeText ?? ((t) => navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject(new Error("no clipboard")))` — resolve `navigator.clipboard` at click time, not at creation. Success → text "Copied", restore "Copy JSON" after 2000 ms via `setTimeout`. Failure → button text "Copy failed — select the text below"; `textarea.debug-fallback` (`readOnly: true`, rows 8) gets the JSON, `hidden = false`, `focus({ preventScroll: true })`, `select()`. Use the same `JSON.stringify(snapshot, null, 2)` string for both. Wrap the call in `Promise.resolve().then(() => write(json))` so a synchronous throw also lands in the failure path.

`word-sheet.ts`: `debug?: HTMLElement` in deps; append to the `.sheet-body` element after the example block when present.

`styles.css` (after the word sheet rules): `.debug` (border-top 1px slate-200, `padding-top: 0.5rem`); `.debug summary` (`display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; list-style: none; cursor: pointer; font-weight: 600; color: var(--slate-600)`); `.debug summary::-webkit-details-marker { display: none; }`; `.debug-chevron` `transition: transform 0.15s`; `.debug[open] .debug-chevron { transform: rotate(90deg); }`; `.debug-body` (flex column, `gap: 0.75rem`, font 0.8125rem, color slate-800, `overflow-wrap: anywhere`); `.debug-label` (0.75rem, 600, uppercase, slate-600, `margin: 0 0 0.25rem`); `.debug pre`, `.debug-fallback` (monospace, 0.75rem, `white-space: pre-wrap`, slate-50 background, 0.5rem padding, 0.5rem radius, `width: 100%`, `box-sizing: border-box`); `.debug mark` (`background: #fef08a; color: var(--slate-900)`); `.debug-kv` grid `auto 1fr`, `column-gap: 0.75rem`; `dt` slate-600; `.debug-copy` `min-height: 2.75rem`.

- [ ] **Step 4: Run to verify pass**

Run the three files, `npx vitest run`, `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/debug-snapshot.ts src/debug-snapshot.test.ts src/debug-panel.ts src/debug-panel.test.ts src/word-sheet.ts src/word-sheet.test.ts src/styles.css
git commit -m "feat(frontend): debug snapshot and collapsible debug panel with Copy JSON"
```

---

### Task 6: Wire result view and main

**Files:**
- Modify: `frontend/src/result-view.ts`, `frontend/src/result-view.test.ts`, `frontend/src/main.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `ResultViewDeps.devMode: { get(): boolean; subscribe(fn: (on: boolean) => void): () => void }`, `ResultViewDeps.build: string`.

- [ ] **Step 1: Update the test helper and write the failing tests**

Helper (allowed change, no assertion changes): add

```ts
function fakeDevMode(initial = false) {
  let on = initial;
  const subs = new Set<(on: boolean) => void>();
  return {
    get: () => on,
    subscribe: (fn: (on: boolean) => void) => (subs.add(fn), () => subs.delete(fn)),
    set(next: boolean) { on = next; subs.forEach((fn) => fn(next)); },
  };
}
```

and give `mount` a fourth parameter `devMode = fakeDevMode()`, passing `devMode` and `build: "abc1234"` in the deps and returning `devMode`.

New tests (`describe("sentences and developer mode")`; `afterEach` also `localStorage.clear()`):

```ts
const outlined = () => [...document.querySelectorAll<HTMLElement>(".word.hl-sentence")].map((e) => Number(e.dataset.wordId));
const outlinedBoxes = () => [...document.querySelectorAll<HTMLElement>(".box.hl-sentence")].map((e) => Number(e.dataset.boxId));
const panel = () => document.querySelector<HTMLDetailsElement>("details.debug")!;
const flush = () => new Promise((r) => setTimeout(r, 0));

it("looks up with the sentence text as context", () => {
  const { translation } = mount(sentenceResult);
  word(9).click();
  expect(translation.lookup).toHaveBeenCalledWith("war", "Vorstellungskraft war");
});

it("looks up with the joined lines when there are no sentences", () => {
  const { translation } = mount(gappedResult);
  word(2).click();
  expect(translation.lookup).toHaveBeenCalledWith("Vorstellungskraft", "Das Vorstel- war lungskraft groß");
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
  expect(translation.lookup).toHaveBeenLastCalledWith("Vorstellungskraft", "Vorstellungskraft war");
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
```

(imports: `sentenceResult` from `./test-fixtures`, `parseOcrResult` from `./contract`, `setClipboard` from `./debug-test-helpers`, `saveToken`, `clearToken` from `./settings` — test file only.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/result-view.test.ts` → the new tests FAIL; existing tests still pass (if an existing test fails for any reason other than the new required deps, apply the stop rule).

- [ ] **Step 3: Implement**

`result-view.ts` per §9:
- Create `const panel = createDebugPanel()`; pass `debug: panel.element` to `createWordSheet`.
- Create the highlighter after the overlay exists: `createWordHighlighter((id) => [...(wordSpans.has(id) ? [wordSpans.get(id)!] : []), ...overlay.elementsForWord(id)])`. The selection callback only runs on taps, after construction, so referencing `highlighter` from it is safe; declare it with `let`/`const` above the callback's first use or create the selection callback to read it lazily.
- `const source = deps.translation.source ?? "unknown"`.
- In the selection callback: `const { request, contextSource } = buildLookupRequest(event)`; snapshot builder closure `snapshot(outcome)`; if `deps.devMode.get()`: `event.sentence ? highlighter.set("sentence", event.sentence.wordIds) : highlighter.clear("sentence")`, `panel.render(snapshot({ status: "pending" }))`; else `highlighter.clear("sentence"); panel.clear()`. Lookup with `request.word, request.context`; on success, if `mine === lookupId`: `sheet.show(info)` and, if `deps.devMode.get()`, `panel.render(snapshot({ status: "ok", response: { ...info } }))`; on failure the same with `{ status: "error", error: e instanceof Error ? e.message : String(e) }` after `sheet.showUnavailable()`.
- In the existing `selection.subscribe` `id === null` branch: also `highlighter.clear("sentence"); panel.clear();`.
- Developer mode off: keep the returned `<section>` in a `const screen`. Subscribe once: `const off = deps.devMode.subscribe((on) => { if (!screen.isConnected) return off(); if (!on) { highlighter.clear("sentence"); panel.clear(); } })`. The view is always mounted before the user can reach the drawer switch, so a disconnected screen means it was replaced by a re-render and the subscriber removes itself on the next toggle.
- The empty-result branch is unchanged (no panel, no subscription).

`main.ts`: pass `devMode: { get: getDevMode, subscribe: subscribeDevMode }` and `build: BUILD_SHA` to `createResultView`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/result-view.test.ts`, then `npx vitest run` (expect 24 + 5 new test files = 29 files, all passing) and `npx tsc --noEmit` (no output).

- [ ] **Step 5: Commit**

```bash
git add src/result-view.ts src/result-view.test.ts src/main.ts
git commit -m "feat(frontend): sentence context, developer outline and debug panel in the result view"
```

---

### Task 7: Final verification

- [ ] **Step 1:** From `frontend/`: `npx vitest run` → all files pass; `npx tsc --noEmit` → no output; `npm run build` → succeeds (it runs `tsc --noEmit && vite build`). Do not commit `dist/`.
- [ ] **Step 2:** `git status --short` shows no changes outside `frontend/src` from this work (an untracked `docs/advisor-brief.md` predates it — leave it alone). `git log --oneline -7` shows the six task commits. Do not push.
- [ ] **Step 3:** Report: test counts, the commits, and anything the stop rules made you skip.
