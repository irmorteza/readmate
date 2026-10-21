# Word-Info API — Frontend (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub lookup with the real `POST /v1/word-info` call. Show lemma, article/plural, sense in context and the separable-verb / expression cards, highlight those parts on the page, and show the response and `meta` in the debug panel. Fall back to "Translation unavailable" when the route is missing or fails.

**Architecture:**
- **New modules:** `word-info-contract.ts` (types and an honest guard, mirroring `contract/word-info.schema.json`) and `word-info-api.ts` (fetch with its own error type, so it never touches the OCR `ErrorKind`).
- `lookup-request.ts` builds the new request from the selection event and the OCR result, including the `wordIds` map and windowing.
- `translation.ts` gets an API-backed `TranslationService` with the new `lookup(request)` signature.
- `word-sheet.ts` renders the new fields with `textContent` only.
- `result-view.ts` wires lookup, highlights (`verb-part`, `collocation`) and debug snapshot v2.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom), plain CSS.

**Spec:** `docs/superpowers/specs/2026-10-21-readmate-word-info-design.md` (§10, §11, §13 frontend). Read it first.

**Prerequisite:** Plan A Task 9 is committed, so that `contract/word-info.schema.json` and `contract/word-info.example.json` exist. Plan B can ship before Plan A is *deployed* (old backend → fallback).

## Stop rules (mandatory)

- **Before Task 1:** run `git rev-parse HEAD` and write the hash down as `BASE`, the commit before this plan's first task. The work happens on `main`, so every later comparison uses `BASE`, never `main`.
- **Stop and report** if any file outside `frontend/src` would change. That includes the backend, `contract/`, CI, `vite.config.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `index.html` and docs. Every file this plan creates or modifies, test files included, is in `frontend/src`. `contract/word-info.*.json` is read, never written.
- **Stop and report** if an existing test that the plan does not name fails, or would need its assertions changed. The plan names these test changes, and they are allowed:
  - the stub tests in `translation.test.ts` (new `lookup(request)` call shape, same expectations);
  - the old builder's tests in `lookup-request.test.ts` (removed in Task 4);
  - the "passes the real text of the lines…" test in `result-view.test.ts` (becomes "sends the built request" in Task 4) and that file's fake-service helper.
  Updating a test *helper* for a new required dependency or signature is allowed; changing any other `expect` is not.
- **Local commits per task; never push.** Never `git push`, never open a PR.

## Global Constraints

- **Additive with old backends:**
  - Against a backend without the route (old backend: `400` after the token check, or 404 from the dev server), every lookup shows "Translation unavailable". OCR is untouched.
  - `api.ts`, `contract.ts`, `errors.ts` and `app.ts` do not change.
- **Request:** `POST ${VITE_API_URL without trailing /}/v1/word-info`, headers `Content-Type: application/json` and `X-Pilot-Token`, body exactly `{ word, wordIndex, sentence: { kind, words }, target: "en" }`, 18 000 ms client timeout.
- **Limits** (mirror the server): at most 120 words; each word at most 64 chars; words joined with single spaces at most 600 chars.
- **Messages:** "Translation unavailable" (any failure); "Daily lookup limit reached" (429 with `error.code === "DAILY_LIMIT"`).
- **Rendering:** every API string goes into the DOM through `textContent` only; no `innerHTML` anywhere in touched code.
- **Highlights:**
  - Styles `verb-part` and `collocation` are always on (not tied to developer mode). The `sentence` outline stays developer-only.
  - No `.hl-*` CSS rule may use `::before` / `::after`.
  - Tokens: `--violet-600: #7c3aed`, `--emerald-700: #047857`.
- **Debug:** snapshot `format: "readmate-debug/2"`. The token and headers never reach the snapshot, the panel or the DOM.
- **Checks:** run from `frontend/`: `npx vitest run`, `npx tsc --noEmit`. Local commits only; never push.

## Review Focus

- **A tapped word longer than 64 characters** (OCR-merged garbage): no request is sent and the sheet shows "Translation unavailable". Any other over-long word in the sentence is clipped to 64 chars so the request stays valid. Tests in Task 2 and Task 4.
- **`sentence.text` pieces that do not match `wordIds`** (double spaces, an empty piece): fall back to `words[].text`, so indexes never shift. An empty piece is never sent. Test in Task 2.
- **A window around the tapped word** (sentence over the caps): response indexes refer to the window and must map to the right page words through `wordIds`, never to the start of the sentence. Test in Task 2 (builder) and Task 7 (highlight).
- **A response that arrives after another tap or after the sheet closed:** it must not set highlights or fill the sheet. Test in Task 7.
- **Response strings containing markup** (`<img src=x onerror=alert(1)>`) render as literal text, and no element is created. Test in Task 5.

---

### Task 1: Word-info contract types and guard

**Files:**
- Create: `frontend/src/word-info-contract.ts`
- Test: `frontend/src/word-info-contract.test.ts`

**Interfaces:**
- Produces:
  - `type SentenceKind` is re-exported from `./contract`.
  - `interface WordInfoRequest { word: string; wordIndex: number; sentence: { kind: SentenceKind; words: string[] }; target: "en" }`.
  - `type Pos = "noun" | "verb" | "adjective" | "adverb" | "pronoun" | "preposition" | "conjunction" | "article" | "numeral" | "particle" | "interjection" | "proper-noun" | "other"`.
  - `type ExpressionType = "collocation" | "idiom" | "verb-pattern" | "fixed-phrase"`.
  - `interface SeparableVerb { infinitive: string; wordIndexes: number[] }`.
  - `interface Expression { text: string; meaning: string; type: ExpressionType; wordIndexes: number[] }`.
  - `interface WordInfoMeta { cached: boolean; model: string; latencyMs: number; promptVersion: string; attempts: number; stopReasons: string[]; outputTokens: number[] }`.
  - `interface WordInfoResponse { version: 1; word; lemma; pos: Pos; phonetic; translation; senseInContext; article: "der" | "die" | "das" | null; plural: string | null; exampleDe; exampleEn; separableVerb: SeparableVerb | null; expression: Expression | null; meta: WordInfoMeta }`. Unlisted fields are `string`.
  - `isWordInfoResponse(x: unknown, wordCount: number): x is WordInfoResponse`.
    - Every required key is present with the right type and enum.
    - Each group's `wordIndexes` are integers `0 ≤ i < wordCount`, with 2–12 entries.
    - Unknown keys are ignored (an additive server must not break the client).

- [ ] **Step 1: Write failing tests**

```ts
import example from "../../contract/word-info.example.json";
import schema from "../../contract/word-info.schema.json";
const words = example.request.sentence.words.length;
const clone = () => structuredClone(example.response) as Record<string, any>;

it("accepts the golden response", () => expect(isWordInfoResponse(example.response, words)).toBe(true));
it("rejects a copy missing any required key", () => {
  for (const key of schema.$defs.response.required) { const c = clone(); delete c[key];
    expect(isWordInfoResponse(c, words), key).toBe(false); }
});
it.each<[string, (c: Record<string, any>) => void]>([
  ["bad pos", (c) => (c.pos = "Verb")],
  ["bad article", (c) => (c.article = "den")],
  ["index out of range", (c) => (c.separableVerb = { infinitive: "x", wordIndexes: [1, words] })],
  ["one index", (c) => (c.separableVerb = { infinitive: "x", wordIndexes: [1] })],
  ["non-integer index", (c) => (c.separableVerb = { infinitive: "x", wordIndexes: [1, 2.5] })],
  ["bad expression type", (c) => (c.expression = { text: "a", meaning: "b", type: "proverb", wordIndexes: [0, 1] })],
  ["meta missing", (c) => delete c.meta],
  ["translation not a string", (c) => (c.translation = 5)],
])("rejects %s", (_, breakIt) => { const c = clone(); breakIt(c); expect(isWordInfoResponse(c, words)).toBe(false); });
it("ignores unknown keys", () => expect(isWordInfoResponse({ ...clone(), future: 1 }, words)).toBe(true));
it("rejects non-objects", () => { for (const x of [null, [], "x", 1]) expect(isWordInfoResponse(x, words)).toBe(false); });
it("request keys match the schema", () =>
  expect(Object.keys(example.request).sort()).toEqual([...schema.$defs.request.required].sort()));
```

- [ ] **Step 2: Run** `npx vitest run src/word-info-contract.test.ts` → fails (module missing).

- [ ] **Step 3: Implement** in the style of `contract.ts` (`isRecord`, `isId` helpers; a comment that the schema file is the source of truth).

- [ ] **Step 4: Run tests and `npx tsc --noEmit` → pass.**

- [ ] **Step 5: Commit** — `feat(frontend): word-info contract types and guard`.

---

### Task 2: Lookup request builder

**Files:**
- Modify: `frontend/src/lookup-request.ts`
- Test: `frontend/src/lookup-request.test.ts` (rewrite)

**Interfaces:**
- Consumes: `WordSelectedEvent` (`selection.ts`), `OcrResult`, `WordInfoRequest`.
- Produces:
  - `type ContextSource = "sentence" | "lines"` (unchanged).
  - `interface BuiltLookup { request: WordInfoRequest; wordIds: number[]; contextSource: ContextSource; windowed: boolean; context: string }`. `wordIds` is parallel to `request.sentence.words`, and `context` is `words.join(" ")`.
  - `buildLookup(event: WordSelectedEvent, result: OcrResult): BuiltLookup`.
  - `MAX_WORDS = 120`, `MAX_WORD_CHARS = 64`, `MAX_TEXT_CHARS = 600`.
  - The old `buildLookupRequest` / `LookupRequest` stay untouched in this task, so everything still compiles. Task 4 removes them.

**Rules (pinned):**
1. **With `event.sentence`:**
   - `pieces = sentence.text.split(" ")`. If `pieces.length === wordIds.length` and no piece is empty, use the pieces; otherwise use the `text` of each word in `sentence.wordIds` (looked up in `result.words` by id).
   - `kind = sentence.kind`, `wordIndex = sentence.wordIndex`, `contextSource "sentence"`.
2. **Without a sentence:**
   - Words are every word of `result.words` (in order) whose `lineIds` share at least one id with `event.word.lineIds`.
   - `kind "fragment"`, `contextSource "lines"`, `wordIndex` = position of `event.word.id`.
3. **Clip:** every word except the tapped one is clipped to 64 chars. The tapped word is never clipped; the service refuses it locally (Task 4).
4. **Window**, when there are more than 120 words or the joined length is over 600:
   - Start with `[wordIndex, wordIndex]`. Repeatedly try to add the next word to the right, then the next to the left, keeping each addition only if the total stays within both caps. Stop when neither side can grow.
   - `kind` becomes `"incomplete"`, `windowed: true`, `wordIndex` is re-based to the window, and `wordIds` is sliced to match.
5. `request.word = event.word.text`, `target "en"`.

- [ ] **Step 1: Write failing tests.** Use the fixtures from `test-fixtures.ts` (`sentenceResult`, `gappedResult`) and small inline results.
  - **Sentence pieces with punctuation kept:** `wordIds` equal `sentence.wordIds`; `kind` copied; `windowed false`; `context` is the joined words.
  - **Piece-count mismatch** (`"Vorstellungskraft  war"` with a double space) → word texts are used, no empty word.
  - **No sentence** → the words of the shared lines; for the gapped fixture, tapping `war` gives words `["Vorstellungskraft", "war"]`, `wordIds [2, 9]`, `wordIndex 1`, `kind "fragment"`, `contextSource "lines"`.
  - **150-word sentence, tapping word 140** → 120 words or fewer, joined ≤ 600, `kind "incomplete"`, `windowed true`, `request.sentence.words[request.wordIndex] === pieces[140]`, `wordIds[request.wordIndex] === sentence.wordIds[140]`, and the window is contiguous.
  - **A 40-word sentence of 20-char words** (joined > 600) → windowed by characters, joined ≤ 600.
  - **Another word of 80 chars** → clipped to 64; **the tapped word of 80 chars** → kept at 80 (not clipped).
  - **Boundary:** exactly 120 words with joined exactly 600 → not windowed.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run → pass;** `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit** — `feat(frontend): build word-info requests with window and word-id map`.

---

### Task 3: Word-info API client

**Files:**
- Create: `frontend/src/word-info-api.ts`
- Test: `frontend/src/word-info-api.test.ts`

**Interfaces:**
- Consumes: `WordInfoRequest`, `WordInfoResponse`, `isWordInfoResponse` (Task 1).
- Produces:
  - `type LookupFailure = "unauthorized" | "limit" | "busy" | "offline" | "unavailable"`.
  - `class WordLookupError extends Error { readonly kind: LookupFailure }`.
  - `TIMEOUT_MS = 18_000`.
  - `postWordInfo(request: WordInfoRequest, token: string, signal?: AbortSignal): Promise<WordInfoResponse>`.

- [ ] **Step 1: Write failing tests** in the style of `api.test.ts` (`vi.stubEnv("VITE_API_URL", "http://api.test/")`, a mocked `fetch`):
  - Success → returns the golden response.
  - The URL is `http://api.test/v1/word-info`; the method is `POST`; the headers are exactly `Content-Type: application/json` and `X-Pilot-Token: tok`; `JSON.parse(body)` deep-equals the request.
  - Status mapping:
    - 401 → `unauthorized`
    - 429 with body `{error:{code:"DAILY_LIMIT"}}` → `limit`
    - 429 with `BUSY` → `busy`
    - 429 with a non-JSON body → `busy`
    - 400, 404, 405, 500, 502, 503 → `unavailable`
  - **Old-backend shapes:** a 400 with `{"error":{"code":"BAD_REQUEST"}}` → `unavailable`.
  - A 200 whose JSON fails the guard (an index ≥ word count) → `unavailable`; a 200 with a non-JSON body → `unavailable`.
  - `fetch` rejecting with a `TypeError` → `offline`.
  - Timeout with fake timers at 18 000 ms → `unavailable`; an external `signal` abort → `unavailable`.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement.** Reuse the `api.ts` pattern (AbortController + `setTimeout`, base URL trimming). It does not import `api.ts` or `errors.ts`.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit** — `feat(frontend): word-info API client`.

---

### Task 4: Translation service on the API, request switch and debug snapshot v2

**Files:**
- Modify: `frontend/src/translation.ts`, `frontend/src/main.ts`, `frontend/src/result-view.ts`, `frontend/src/debug-snapshot.ts`, `frontend/src/lookup-request.ts` (delete `buildLookupRequest` and `LookupRequest`)
- Test: `frontend/src/translation.test.ts`, `frontend/src/debug-snapshot.test.ts`, `frontend/src/result-view.test.ts`, `frontend/src/lookup-request.test.ts` (drop the old builder's tests)

Everything that changes `TranslationService.lookup` lands in this one task, so the commit compiles.

**Interfaces:**
- Consumes: `postWordInfo`, `WordLookupError` (Task 3); `WordInfoRequest`, `WordInfoResponse` (Task 1); `buildLookup`, `BuiltLookup`, `MAX_WORD_CHARS` (Task 2).
- Produces:
  - `WordInfo` keeps its six fields and gains the optional fields:
    - `lemma?: string`, `senseInContext?: string`, `article?: string | null`, `plural?: string | null`
    - `separableVerb?: { infinitive: string; wordIndexes: number[]; parts: string[] } | null`
    - `expression?: { text: string; meaning: string; type: string; wordIndexes: number[]; parts: string[] } | null`
    - `meta?: Record<string, unknown>`
  - `interface TranslationService { readonly source?: string; lookup(request: WordInfoRequest): Promise<WordInfo> }`.
  - `stubTranslationService.lookup(request)` behaves as today for `request.word`.
  - `toWordInfo(response: WordInfoResponse, request: WordInfoRequest): WordInfo`:
    - `pos` becomes a display label: `"Noun (die)"` when there is an article, otherwise the capitalized pos with `-` → space (`"Proper noun"`).
    - `parts` = `wordIndexes.map(i => request.sentence.words[i])`.
    - `meta` is copied.
  - `createApiTranslationService(deps: { getToken: () => string | null; post?: typeof postWordInfo }): TranslationService` with `source: "api"`.
    - A tapped word longer than `MAX_WORD_CHARS`, or no token, rejects with `WordLookupError("unavailable")` and never calls `post`.
  - `createTranslationService(deps: { getToken: () => string | null }): TranslationService` returns the API service when `import.meta.env.VITE_API_URL` is non-empty, otherwise the stub.
  - `main.ts` passes `{ getToken }` from `settings.ts`.
  - `result-view.ts` calls `buildLookup(event, result)` and `deps.translation.lookup(lookup.request)`; the rest of its flow stays as today (highlights come in Task 7).
  - `buildDebugSnapshot({ build, result, event, lookup: BuiltLookup, source, outcome })` returns `format: "readmate-debug/2"`, with `lookup = { request: WordInfoRequest, contextSource, contextLength: lookup.context.length, windowed, status, source, response, meta, error }`. On an ok outcome `response` is the `WordInfo` without its `meta` key, and `meta = info.meta ?? null`.

- [ ] **Step 1: Write failing tests.**
  - Stub tests are updated to call `lookup({word, wordIndex: 0, sentence: {kind: "fragment", words: [word]}, target: "en"})` with the same expectations.
  - `toWordInfo(golden)` → `pos "Verb"`, `separableVerb.parts == ["stellte", "vor."]`, `article` null.
  - A noun response with `article "die"` → `pos "Noun (die)"`; `"proper-noun"` → `"Proper noun"`.
  - The API service calls `post(request, "tok")` and maps the result; it rejects without calling `post` when the token is null or the tapped word has 65 chars.
  - `createTranslationService` returns `source "api"` with `VITE_API_URL` stubbed, and `"stub"` with it empty.
  - **Snapshot:** `format "readmate-debug/2"`; `contextLength === lookup.context.length`; `windowed` copied; an ok outcome with `meta` puts it in `lookup.meta` and leaves no `meta` key in `lookup.response`. The existing `sentenceStatus` tests are kept.
  - **Result view:** the existing "passes the real text of the lines…" test becomes "sends the built request". `translation.lookup` is called with `{word: "war", wordIndex: 1, sentence: {kind: "fragment", words: ["Vorstellungskraft", "war"]}, target: "en"}` for the gapped fixture, and with the sentence pieces for `sentenceResult`. The test helper's fake service takes a request.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement;** update `main.ts`, `result-view.ts`, `debug-snapshot.ts`, and delete the old builder.

- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit` → green.

- [ ] **Step 5: Commit** — `feat(frontend): API-backed translation service and debug snapshot v2`.

---

### Task 5: Word sheet shows the new fields

**Files:**
- Modify: `frontend/src/word-sheet.ts`, `frontend/src/styles.css`
- Test: `frontend/src/word-sheet.test.ts`

**Interfaces:**
- Consumes: `WordInfo` (Task 4).
- Produces: `WordSheet.showUnavailable(message?: string)` (default `"Translation unavailable"`). `show(info)` additionally fills these elements:
  - `.sense` (paragraph under `.translation` inside the translation card);
  - `.lemma-line` (`Lemma: <lemma>`, shown when `lemma` differs from `word`);
  - `.noun-line` (`<article> <lemma> · Plural: <article-for-plural "die"> <plural>`, shown when `article` is set; the plural part only when `plural` is set; plural always takes `die`);
  - `.card-separable` (label `Separable verb`, strong `infinitive`, `.parts` = `parts.join(" … ")`, `.swatch.swatch-verb-part`);
  - `.card-expression` (label `Expression`, strong `text`, `.meaning`, `.chip` = `type`, `.parts`, `.swatch.swatch-collocation`).
  - Every one of them is `hidden` when its data is absent, and `showLoading` / `showUnavailable` hide them all.

- [ ] **Step 1: Write failing tests.**
  - `show(fullInfo)` shows all sections with exact texts. Fixture: lemma `vorstellen`, `separableVerb.parts ["stellte", "vor."]` → `.card-separable .parts` text `"stellte … vor."`.
  - `show(info)` with only the six base fields → every new section hidden (today's look is unchanged).
  - A noun: `"die Mutter · Plural: die Mütter"`.
  - `showLoading` after a full `show` → all new sections hidden.
  - `showUnavailable("Daily lookup limit reached")` → `.translation` has that text; no argument → "Translation unavailable".
  - **XSS:** with `translation`, `senseInContext`, `expression.meaning` and `parts` all set to `<img src=x onerror=alert(1)>`, the sheet contains no `img` element and `.translation` `textContent` equals the literal string.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement.**
  - **Elements:** build them with `h(...)` and `textContent` only. The cards use the existing `card-soft` look.
  - **New CSS:**
    - `.sense` (slate-600, 0.875rem);
    - `.lemma-line` and `.noun-line` (slate-600, 0.8125rem);
    - `.card-separable` and `.card-expression` (padding 0.75rem, border 1px slate-200, radius 0.75rem);
    - `.swatch` (inline-block, 0.75rem square, radius 0.1875rem, vertical-align middle);
    - `.swatch-verb-part` (outline 0.125rem solid `--violet-600`);
    - `.swatch-collocation` (outline 0.125rem dashed `--emerald-700`).
  - Add the two tokens to `:root`.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit** — `feat(frontend): word sheet shows lemma, sense, noun forms, verb and expression cards`.

---

### Task 6: Highlight styles

**Files:**
- Modify: `frontend/src/word-highlight.ts`, `frontend/src/styles.css`
- Test: `frontend/src/word-highlight.test.ts`

**Interfaces:**
- Produces: `type HighlightStyle = "sentence" | "verb-part" | "collocation"`. The behaviour is unchanged; styles are independent (setting one never clears another).

- [ ] **Step 1: Write failing tests.**
  - Set `verb-part` on ids `[1, 2]` and `collocation` on `[2, 3]`: both classes are present on word 2; `clear("verb-part")` leaves `collocation` on 2 and 3. `clear()` removes all three styles.
  - **CSS:**
    - the existing guard still passes (no `.hl-*` with `::before` / `::after`);
    - `declarations(".word.hl-verb-part")` contains `outline: 0.125rem solid var(--violet-600)`;
    - `declarations(".word.hl-collocation")` contains `outline: 0.125rem dashed var(--emerald-700)`;
    - `.box.hl-verb-part` has `border-style: solid` and `.box.hl-collocation` has `border-style: dotted`;
    - neither `.word.hl-*` rule contains `text-decoration`, `box-shadow` or `background` (so they never fight `hl-sentence` / `.selected`);
    - both `.box` rules come after `.box.hl-sentence` in the stylesheet (index check on `css`).

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement.** Widen the type, and add the four rules from spec §10.5 (`outline-offset: 0.0625rem` on the word rules) right after `.box.hl-sentence`.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit** — `feat(frontend): verb-part and collocation highlight styles`.

---

### Task 7: Result view highlights, failure messages and debug panel

**Files:**
- Modify: `frontend/src/result-view.ts`, `frontend/src/debug-panel.ts`
- Test: `frontend/src/result-view.test.ts`, `frontend/src/debug-panel.test.ts`

**Interfaces:**
- Consumes: `buildLookup` / `BuiltLookup` (Task 2); `TranslationService.lookup(request)`, `WordInfo`, `buildDebugSnapshot` v2 (Task 4); `WordLookupError` (Task 3); `showUnavailable(message)` (Task 5); the new highlight styles (Task 6).

**Result-view flow per tap (pinned):**
1. `const lookup = buildLookup(event, result)` (as wired in Task 4), `sheet.showLoading(...)`, `highlighter.clear("verb-part")`, `highlighter.clear("collocation")`. Developer-mode outline and panel as today.
2. Call `deps.translation.lookup(lookup.request)`.
3. **On success, if the lookup is still current:**
   - `sheet.show(info)`;
   - for each group present, `highlighter.set(style, group.wordIndexes.map(i => lookup.wordIds[i]).filter(id => id !== undefined))` (`separableVerb` → `"verb-part"`, `expression` → `"collocation"`);
   - in developer mode, render the snapshot (built as in Task 4).
4. **On failure, if current:** `sheet.showUnavailable(e instanceof WordLookupError && e.kind === "limit" ? "Daily lookup limit reached" : undefined)`; debug error = `e.kind` for a `WordLookupError`, else the message.
5. **On selection cleared and on developer-mode off:** clear `verb-part` and `collocation` on selection clear; developer-mode off clears only `sentence` (the part highlights are not developer-only).

**Debug panel:** the request section shows `JSON.stringify(lookup.request, null, 2)`, then `Context: N characters (sentence|lines)`, with `· windowed` appended when `windowed`.

- [ ] **Step 1: Update and add failing tests.**
  - **Result view:**
    - The fake service resolves `separableVerb {wordIndexes: [0, 1], parts}` → words 2 and 9 and all their boxes get `hl-verb-part`. An `expression` → `hl-collocation`.
    - The next tap clears both before its own lookup resolves. Closing the sheet clears them.
    - **Stale response:** tap A (slow), tap B (fast, no groups), then A resolves with groups → no `hl-verb-part` anywhere.
    - **Windowed lookup:** a 150-word sentence fixture, tapping word 140, the service returns `[0, 1]` of the window → the highlighted ids are `lookup.wordIds[0..1]`, not the sentence's first words.
    - A `WordLookupError("limit")` rejection → `.translation` "Daily lookup limit reached"; any other rejection → "Translation unavailable".
    - Turning developer mode off keeps `hl-verb-part`.
    - A tap on a `hl-verb-part` neighbour selects that neighbour.
  - **Panel:** the windowed text is present when `windowed`.
  - **Token safety:**
    - Use the real `createApiTranslationService({ getToken: () => "tok-SECRET-123" })` with a mocked `fetch` returning the golden response, developer mode on, a tap, the panel opened and Copy JSON run.
    - Neither `document.body.innerHTML` nor the copied text contains `tok-SECRET-123` or `X-Pilot-Token`.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** both modules.

- [ ] **Step 4: Run** `npx vitest run` (the whole suite) and `npx tsc --noEmit` → all green.

- [ ] **Step 5: Commit** — `feat(frontend): real word lookups with part highlights and debug snapshot v2`.

---

### Task 8: Final verification

- [ ] **Step 1:** From `frontend/`: `npx vitest run` and `npx tsc --noEmit` → pass. From `backend/`: `.venv/Scripts/python -m pytest -q` → pass (the contract files are shared).
- [ ] **Step 2:** `git diff BASE --stat` lists only files under `frontend/src` (the stop rule). `git diff BASE -- frontend/src ':!frontend/src/*.test.ts' | grep '^+.*innerHTML'` → no output (no new `innerHTML`).
- [ ] **Step 3: Manual check with the fake engine** (needs Plan A implemented locally): `.\run.cmd -Engine fake`.
  - Open the app with token `dev`, take or choose a page, and tap `stellte` in a sentence that contains `vor` → the sheet shows "Separable verb · vorstellen" and both words carry the violet outline in Clean Text and Smart Image.
  - Tap another word → the outlines move or disappear.
  - Turn on developer mode → the Debug panel shows the request, the context length and `meta` (`cached` true on a repeat tap).
- [ ] **Step 4: Old-backend behaviour.** No manual old-backend run. The Task 3 tests cover the old backend's shapes: a 400 `BAD_REQUEST` from the deployed Lambda before Plan A, and a 404 from the old dev server. Both map to `unavailable`, which shows "Translation unavailable". The report states that this check rests on those tests.
- [ ] **Step 5:** `git status` clean except `docs/advisor-brief.md`; **no push**. Report to the owner: the frontend can merge before or after the backend deploy; after a deploy, installed PWAs may need the cache-clear step in `docs/deploy.md` §3.
