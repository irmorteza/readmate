# ReadMate — Sentences in the Frontend and Developer Debug Panel Design Spec

- **Date:** 2026-10-21
- **Status:** Approved (2026-10-21)
- **Path in repo:** `docs/superpowers/specs/2026-10-21-readmate-dev-debug-panel-design.md`
- **Builds on:** `2026-10-21-readmate-sentence-segmentation-design.md` (§8, §10), `2026-10-18-readmate-ui-v2-design.md` (§11 is authoritative for UI rules)
- **Supersedes:** segmentation spec §8.2, the sentence "The frontend guard and types are not changed" (see §3 below)

## 1. Purpose

The deployed backend emits `sentences` on every OCR result. The frontend ignores the field today. This work:

1. consumes `sentences`: types, a guard that can never break word display, the tapped word's sentence on the selection event, and the sentence as the lookup context;
2. adds a **developer mode** with a **Debug** section in the word sheet, so the owner can check segmentation and the lookup input on a real phone against the real backend, and paste the data to an advisor;
3. outlines the tapped word's sentence on the page in developer mode, through a **generic word highlighter** that the later word-info feature (separable-verb and collocation parts) reuses.

### Success criteria

- A result without `sentences` (older backend) and a result with a malformed `sentences` both display and select words exactly as today.
- Tapping a word looks it up with its sentence text as context when available, else the joined line texts.
- With developer mode on, the word sheet has a closed-by-default Debug section showing word, sentence, lines, the lookup request (with context length), and the lookup result; Copy JSON copies the same data.
- With developer mode on, the tapped word's sentence is outlined in Smart Image and underlined in Clean Text; the outline never changes what a tap hits.
- The pilot token and request headers never appear in the DOM or the copied JSON.
- `npx vitest run` and `npx tsc --noEmit` pass.

## 2. Scope

- **In:** `frontend/src` only.
- **Out:** backend, `contract/` (schema and example), the word-info API itself, persistent highlight styles for verb parts (only the mechanism is built).
- **Rule (CLAUDE.md):** the frontend must keep working with both the old backend (no `sentences`) and the new one.

## 3. Contract types and guard (`contract.ts`, `api.ts`)

```ts
export type SentenceKind = "sentence" | "fragment" | "incomplete";
export interface OcrSentence { id: number; kind: SentenceKind; wordIds: number[]; text: string; }
export interface OcrResult { /* existing fields */ sentences?: OcrSentence[]; }
```

- **`isOcrResult(x)`** stays an honest type guard. It accepts a missing `sentences`. When `sentences` is present (including `null`), it must be an array whose every entry has: `id` an integer ≥ 0, `kind` one of the enum, `wordIds` a non-empty list of integers ≥ 0 that all exist in `words[].id`, `text` a string. Unknown keys are ignored, as elsewhere in the guard. Otherwise `isOcrResult` returns `false`.
- **`parseOcrResult(x: unknown): OcrResult | null`** (new):
  - `isOcrResult(x)` → return `x` unchanged;
  - else, if `x` is a record with a `sentences` key and `isOcrResult` of a shallow copy without `sentences` is true → return that copy, add it to a module-level `WeakSet`, and `console.warn("readmate: ignoring malformed sentences")`;
  - else `null`.
- **`sentencesIgnored(result: OcrResult): boolean`** (new) reads the `WeakSet`.
- `api.ts` uses `parseOcrResult` instead of `isOcrResult`; `null` still throws `AppError("generic")`. A bug in `sentences` can therefore never reject an OCR result.

This replaces segmentation spec §8.2's "The frontend guard and types are not changed"; that line gets a one-line pointer to this spec, and the section is otherwise left as written.

## 4. Selection and lookup context

### 4.1 `selection.ts`

```ts
export interface SelectedSentence { id: number; kind: SentenceKind; text: string; wordIds: number[]; wordIndex: number; }
export interface WordSelectedEvent { word; boxes; lineTexts; sentence?: SelectedSentence; }
```

- `createSelection` builds a `Map<wordId, { sentence: OcrSentence; index: number }>` **once**, when it is created for a result (one selection per result view), not on each tap. If a word id appears in more than one sentence, the first occurrence wins.
- `sentence` is present only when the result has `sentences` and the word is in one. `wordIndex` is the position of the tapped word in `wordIds`. Existing fields are unchanged.

### 4.2 `lookup-request.ts` (new)

```ts
export interface LookupRequest { word: string; context: string; }
export function buildLookupRequest(event: WordSelectedEvent):
  { request: LookupRequest; contextSource: "sentence" | "lines" };
```

- `context` is `event.sentence.text` when a sentence is present, else `event.lineTexts.join(" ")` (today's behaviour).
- `result-view.ts` calls `deps.translation.lookup(request.word, request.context)`. `TranslationService.lookup` keeps its signature.
- `TranslationService` gets an optional `readonly source?: string`; `stubTranslationService.source = "stub"`. The debug panel shows `source ?? "unknown"`.

## 5. Developer mode

### 5.1 `dev-mode.ts` (new)

- `getDevMode(): boolean`, `setDevMode(on: boolean): void`, `subscribeDevMode(fn: (on: boolean) => void): () => void`.
- Stored in localStorage key `readmate.devMode` as `"1"` (on) or removed (off); off by default. A memory fallback keeps the value for the session when localStorage throws (same pattern as `settings.ts`).
- Not tied to the build mode: it works in the deployed build.

### 5.2 Drawer switch

- In the drawer footer, above the version lines: a full-width `<label class="dev-switch">` containing the text "Developer mode" and `<input type="checkbox" role="switch">`. The whole row is the touch target, at least 2.75rem high (UI v2 §11.5). The checkbox is styled as a switch (track and knob) with `appearance: none`; the checked track is indigo-600, the unchecked track slate-300 with a slate-500 border (non-text contrast ≥ 3:1 against white). Visible focus ring as for other controls.
- `DrawerDeps` gets `devMode: boolean` (initial state) and `onDevModeChange(on: boolean): void`. `main.ts` passes `getDevMode()` and `setDevMode`. Toggling does not close the drawer.

### 5.3 When a change takes effect

- **On:** from the next tap (the panel and outline appear on the next word selected).
- **Off:** at once. `result-view` subscribes with `subscribeDevMode`; on `false` it clears the sentence highlight and empties and hides the debug panel. The subscriber unsubscribes itself when the result view is no longer connected to the document (the screen is rebuilt on state changes).

## 6. Debug data (`debug-snapshot.ts`, new, pure)

`buildDebugSnapshot(...)` returns exactly what Copy JSON copies:

```ts
interface DebugSnapshot {
  format: "readmate-debug/1";
  build: string;                     // BUILD_SHA
  engine: string;                    // result.engine
  word: { id: number; text: string };
  sentenceStatus: "ok" | "absent" | "ignored" | "not-found";
  sentence: SelectedSentence | null;
  lineTexts: string[];
  lookup: {
    request: LookupRequest;
    contextSource: "sentence" | "lines";
    contextLength: number;           // request.context.length (UTF-16 code units, as JS counts)
    status: "pending" | "ok" | "error";
    source: string;
    response: Record<string, unknown> | null;
    meta: Record<string, unknown> | null;
    error: string | null;
  };
}
```

- `sentenceStatus`: `ok` when the event has a sentence; `ignored` when `sentencesIgnored(result)`; `absent` when the result has no `sentences`; `not-found` when it has `sentences` but none contains the word.
- `response` holds the lookup result (`WordInfo` today). `meta` is `null` today; the word-info API will fill it (`cached`, `model`, `latencyMs`, `promptVersion`). Both are rendered generically (§7), so new fields need no layout change.
- Inputs are only the OCR result, the selection event, the lookup request, the lookup outcome, the translation source and `BUILD_SHA`. The snapshot code never imports `settings.ts` or `api.ts`; the token and headers cannot reach it.

## 7. Debug panel (`debug-panel.ts`, new)

- `createDebugPanel(deps?: { writeText?: (text: string) => Promise<void> })` returns `{ element, render(snapshot), clear() }`. Default `writeText` is `navigator.clipboard?.writeText` bound to the clipboard; missing clipboard counts as failure.
- `element` is `<details class="debug">` with `<summary>` "Debug" and a `chevron-right` icon that rotates 90° when open. Native disclosure behaviour; the default marker is hidden. Summary is at least 2.75rem high. Closed by default.
- `render` replaces only the body; the `<details>` element persists, so its open state survives taps on the same page and resets when the screen is rebuilt. `render` also sets `hidden = false`. `clear()` empties the body and sets `hidden = true`.
- **Sections** (each with a small `.label` heading, values in `overflow-wrap: anywhere`, monospace for JSON):
  1. **Word:** text and id.
  2. **Sentence:** id, kind, wordIndex, and the text with the tapped word wrapped in `<mark>`: the text is split on single spaces; if the piece count equals `wordIds.length`, piece `wordIndex` is marked, else the text is shown unmarked. Without a sentence, one line by status: `absent` → "No sentence data (older backend)"; `ignored` → "Sentence data was malformed and ignored"; `not-found` → "Word not found in sentences".
  3. **Lines:** each of `lineTexts` on its own line.
  4. **Lookup request:** `JSON.stringify(request, null, 2)` in a `<pre>`, then "Context: N characters (sentence|lines)".
  5. **Lookup result:** source and status; `response` and `meta` as key/value rows (`meta` shows "none" when `null`); `error` when present.
  6. **Copy JSON** button (secondary, full width, ≥ 2.75rem): copies `JSON.stringify(snapshot, null, 2)`. Success → button text "Copied" for 2 s. Failure → button text "Copy failed — select the text below", and a readonly `<textarea>` with the same JSON is shown and selected.
- Mounted at the end of the word sheet body: `WordSheetDeps` gets optional `debug?: HTMLElement`, appended as the last child of `.sheet-body`. The sheet body already scrolls inside the sheet's `85dvh` cap.
- Colours and sizes in rem; body text slate-800 on white, secondary text slate-600 (≥ 4.5:1).

## 8. Generic word highlighter (`word-highlight.ts`, new)

```ts
export type HighlightStyle = "sentence";   // later: "verb-part", "collocation", …
export interface WordHighlighter {
  set(style: HighlightStyle, wordIds: Iterable<number>): void;  // replaces that style's previous words
  clear(style?: HighlightStyle): void;                          // one style, or all
}
export function createWordHighlighter(targetsFor: (wordId: number) => Element[]): WordHighlighter;
```

- Adds and removes the class `hl-<style>` on the elements returned by `targetsFor`. It keeps, per style, the set of elements it marked, so `clear` removes exactly those.
- `result-view` passes `targetsFor = (id) => [wordButton(id), ...overlay.elementsForWord(id)]`. `Overlay` gets `elementsForWord(wordId): HTMLElement[]` (the box elements of the word's `boxIds`).
- **CSS:**
  - `.word.hl-sentence`: `text-decoration: underline dotted var(--indigo-600) 0.125rem; text-underline-offset: 0.25rem;`
  - `.box.hl-sentence`: `border-color: var(--indigo-600); border-style: dashed;` (uses the box's existing 2px transparent border; no size change).
  - Indigo-600 on white is about 6.3:1.
- **Never intercepts taps:** a highlight is a class on the existing word button or box; it adds no element and no layer. No `.hl-*` rule may target `::before` or `::after` at all — `.word::before` is the word's invisible hit area (`styles.css`, `.word::before`) and a highlight must never alter it. A CSS guard test enforces this, and a behaviour test checks that tapping a highlighted neighbour selects that neighbour.
- **Sentence outline lifecycle** (developer mode only): `set("sentence", sentence.wordIds)` on each tap with a sentence (replacing the previous one); `clear("sentence")` on a tap without a sentence, when the selection is cleared (sheet closed by close button, backdrop, handle, Escape, or tapping empty space), and when developer mode is turned off.

## 9. Result view wiring (`result-view.ts`, `main.ts`)

- `ResultViewDeps` gets `devMode: { get(): boolean; subscribe(fn: (on: boolean) => void): () => void }` and `build: string`. `main.ts` passes the `dev-mode.ts` functions and `BUILD_SHA`.
- On word selected:
  1. `buildLookupRequest(event)`; show loading as today.
  2. If `devMode.get()`: highlight the sentence (§8), `panel.render(snapshot with status "pending")`. Else `panel.clear()` and `highlighter.clear("sentence")`.
  3. Call `translation.lookup(request.word, request.context)`. On success or failure, if the lookup is still current (existing `lookupId` check) and developer mode is on, `panel.render` the snapshot with `ok` + `response` or `error` + message.
- On selection cleared: `highlighter.clear("sentence")` and `panel.clear()`.

## 10. Security

- The panel, snapshot and highlighter never read the token or any header. No new module imports `settings.ts` or `api.ts`.
- Test: with a saved token `tok-SECRET-123` and developer mode on, tap a word, open the Debug section, resolve the lookup; neither `document.body.innerHTML` nor the copied JSON contains `tok-SECRET-123` or `X-Pilot-Token`.

## 11. Testing (Vitest; `npx tsc --noEmit` clean)

- **Guard (`contract.test.ts`):** example with sentences accepted; without sentences accepted; `isOcrResult` false for each malformed variant (unknown kind, unknown word id, empty `wordIds`, `null`, non-array, entry missing `text`); `parseOcrResult` of each malformed variant returns the words unchanged, no `sentences`, `sentencesIgnored` true; a broken core returns `null`; a valid result returns the same object with `sentencesIgnored` false. `api.test.ts`: a response with malformed `sentences` resolves with the words.
- **Selection:** event with sentence (`id`, `kind`, `text`, `wordIds`, `wordIndex`); without `sentences`; word not in any sentence; first occurrence wins.
- **Lookup request:** context is the sentence text; fallback to joined lines; `contextSource`.
- **Snapshot:** each `sentenceStatus`; `contextLength`; pending/ok/error.
- **Panel:** not rendered (hidden, empty) when developer mode is off; present and closed (`open === false`) when on; Sentence section marks the tapped word, and falls back to unmarked text on a count mismatch; the three no-sentence messages; Lookup request shows the context length; Copy JSON writes text that parses to the snapshot; failure shows the selected textarea; token check (§10).
- **Highlighter:** set adds classes to all targets; set again replaces; clear one style and all.
- **Result view:** outline set on tap in developer mode and absent when off; replaced on another tap; cleared when the sheet closes; cleared when developer mode is turned off; tapping a highlighted neighbour selects it; the lookup is called with the sentence text as context.
- **CSS guard:** no selector containing `.hl-` also contains `::before` or `::after` (or `:before` / `:after`); `.word.hl-sentence` and `.box.hl-sentence` exist.
- **Drawer:** switch checked state follows `devMode`; toggling calls `onDevModeChange` and keeps the drawer open; `role="switch"`.
- **dev-mode.ts:** off by default; persists `"1"`; off removes the key; memory fallback when localStorage throws; subscribers notified.

## 12. Risks and limits

- The `<mark>` placement assumes `text` pieces map 1:1 to `wordIds` when the counts match (true for the backend's §8.1 construction); otherwise the text is shown unmarked rather than marked wrongly.
- Turning developer mode on while a sheet is open shows nothing until the next tap (accepted).
- `console.warn` on ignored sentences is visible only with remote debugging; the panel status covers the phone case.
