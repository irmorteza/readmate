# ReadMate UI v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ReadMate screens with the designer's second concept (compact header + drawer, empty/scanning states, segmented reader with thumb-sized word buttons, richer word sheet, toast, bottom navigation), UI-only, with "Coming soon" for everything that needs a backend.

**Architecture:** Plain TypeScript render functions built with the existing `h()` helper, one small file per UI unit, composed in `main.ts`. The controller (`app.ts`) keeps its state machine and gains a "last result" so the Reader tab can return to it. Word data comes through the existing `TranslationService` boundary, whose stub now returns the designer's dummy dictionary. Icons are inline SVG from the `lucide` package; nothing is loaded at runtime from a CDN.

**Tech Stack:** TypeScript, Vite, Vitest + jsdom, `lucide` (icon data only), plain CSS (rem units).

**Spec:** `docs/superpowers/specs/2026-10-18-readmate-ui-v2-design.md` (§n below refers to it)

## Global Constraints

- UI language English; product name ReadMate. Backend, `contract/`, `api.ts`, `contract.ts`, the OCR flow, the CI/CD workflow and infrastructure are not touched.
- Colors: primary `#4F46E5` (hover `#4338CA`), page background `#F8FAFC`, selected word `#FEF08A` with border `#FACC15`. Radii: buttons 12 px, sheet top 32 px, desktop frame 48 px.
- Bottom sheet: `max-height: 85dvh`, internal scroll, handle `w-12 h-1.5` slate-300, enters from the bottom (`translate-y`, ease-out 300 ms), leaves ease-in 200 ms; tapping the backdrop, the handle or the close button closes it and clears the selection.
- Clean Text word buttons: `min-height: 44px` (2.75rem), font 18–20 px, `gap` 8–10 px, `overflow-wrap: anywhere` so a long German compound never causes horizontal scroll.
- Header `padding-top: max(8px, env(safe-area-inset-top))`, footer `padding-bottom: max(6px, env(safe-area-inset-bottom))`; vertical padding of header ≤ 8 px and footer ≤ 6 px; heights use `dvh`.
- Toast: floating at the top, auto-hides after 3000 ms, a new message replaces the old one and restarts the timer; message format for unimplemented features: `"<Name> is coming soon"`.
- Unimplemented items (Saved Words, Scan History, Preferences, Export Flashcards, Cards nav, Save to Flashcards, Add Note, Full Dictionary) are visible and only show that toast; no counters, no storage.
- Frame and touch rules, verbatim:
  - `@media (hover: hover) and (pointer: fine) and (min-width: 768px)` → `.app-viewport-container { max-width: 390px; height: 844px; border-radius: 48px; border: 8px solid #334155; box-shadow: 0 25px 50px -12px rgba(0,0,0,.25); margin: 2rem auto; }`
  - `@media (pointer: coarse), (hover: none)` → `.app-viewport-container { width: 100vw; height: 100dvh; max-width: 100%; border: none; border-radius: 0; margin: 0; }`
- All CSS sizes in `rem` except 1–2 px hairlines and media-query widths (`viewport.ts` scales the root font size on touch devices). Sheet, backdrop, drawer and toast are `position: absolute` inside `.app-viewport-container` (never `fixed`, so they stay inside the desktop frame).
- No runtime CDN: no `<script src>` or `@import url(https…)`; font stack `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`.
- New dependency allowed: `lucide` (devDependency, only used icons imported). Nothing else.
- Commit after each task; never push.

## Review Focus

1. **Reader tab with no result, and after "Scan":** Reader must be disabled before any result and, after New photo, must return to the previous result with the selection cleared (no crash, no stale sheet). — Task 1 and Task 10
2. **Closing the sheet while a lookup is pending:** a late lookup result must not reopen or refill the closed sheet. — Task 6
3. **Very long German compounds in Clean Text** (e.g. `Donaudampfschifffahrtsgesellschaft`): no horizontal scroll; `scrollWidth ≤ clientWidth`. — Task 7 (test + visual check)
4. **Speech synthesis unsupported, throwing, or tapped twice quickly:** a toast, never an uncaught error; a running utterance is cancelled first. — Task 3
5. **Offline:** the built bundle contains no external URL (no CDN/fonts/stock images), so icons and fonts work without network. — Task 12

---

## File Structure

New in `frontend/src/`: `icons.ts`, `toast.ts`, `speech.ts`, `word-sheet.ts`, `empty-view.ts`, `scanning-view.ts`, `drawer.ts`, `bottom-nav.ts` (each with a `*.test.ts`). Changed: `app.ts`, `translation.ts`, `result-view.ts`, `capture.ts`, `header.ts`, `main.ts`, `styles.css` and their tests. Each task appends its own CSS section to `styles.css`; Task 11 removes the obsolete rules.

---

### Task 1: Controller keeps the last result

**Files:** Modify `frontend/src/app.ts`, `frontend/src/app.test.ts`.

**Interfaces:**
- Produces: `Controller.hasLastResult(): boolean` and `Controller.showLastResult(): void` (state becomes the stored `result` state with a fresh object; no-op without one). The last result is stored whenever a `result` state is produced and cleared by `resetToken()`. `newPhoto()` keeps it.

- [ ] **Step 1: Write failing tests** in `app.test.ts`: `test_has_no_last_result_initially`, `test_last_result_is_kept_after_new_photo` (`chooseFile` → result → `newPhoto()` → `hasLastResult()` true), `test_show_last_result_returns_to_result_state` (same `result` object and `imageUrl`), `test_show_last_result_without_result_is_a_noop` (state stays `idle`), `test_reset_token_forgets_last_result`, `test_new_result_replaces_last_result`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/app.test.ts` → FAIL (`hasLastResult` is not a function).
- [ ] **Step 3: Implement** both methods and the stored value in `createController`.
- [ ] **Step 4: Run** the file → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat: controller keeps the last result`.

---

### Task 2: Translation service returns the designer's dummy words

**Files:** Modify `frontend/src/translation.ts`, `frontend/src/translation.test.ts`, `frontend/src/result-view.ts` (field renames only), `frontend/src/result-view.test.ts` (fixture field names).

**Interfaces:**
- Produces: `WordInfo = { word: string; phonetic: string; pos: string; translation: string; exampleDe: string; exampleEn: string }`; `TranslationService.lookup(word: string, context: string): Promise<WordInfo>` (signature unchanged); `stubTranslationService`, `createTranslationService()`; exported `DUMMY_DICTIONARY: Readonly<Record<string, Omit<WordInfo, "word">>>` and `fallbackInfo(word: string): WordInfo`.

- [ ] **Step 1: Write failing tests** (rewrite `translation.test.ts`): `test_lookup_returns_dictionary_entry` for each of `Wortschatz` (`/ˈvɔʁtˌʃat͡s/`, `Noun (m.)`, `Vocabulary / Lexicon`, `Das Lesen von Büchern erweitert den Wortschatz.`, `Reading books expands vocabulary.`), `Lesen` (`/ˈleːzn̩/`, `Noun (n.)`, `Reading / To read`, `Tägliches Lesen stärkt das Gedächtnis.`, `Daily reading strengthens memory.`), `Büchern` (`/ˈbyːçɐn/`, `Noun (pl. dat.)`, `Books`, `Wir lernen viel aus guten Büchern.`, `We learn a lot from good books.`), `erweitert` (`/ɛɐ̯ˈvaɪ̯tɐt/`, `Verb (3rd pers.)`, `Expands / Broadens`, `Reisen erweitert den Horizont.`, `Travel expands one's horizon.`), `Sprachverständnis` (`/ˈʃpʁaːxvɛɐ̯ˌʃtɛntnɪs/`, `Noun (n.)`, `Language comprehension`, `Ein gutes Sprachverständnis ist wichtig.`, `Good language comprehension is important.`); `test_unknown_word_gets_fallback` (`lookup("Zeitlupe", "")` → `phonetic "/zeitlupe/"`, `pos "Word"`, `translation 'Meaning of "Zeitlupe"'`, `exampleDe "Hier ist ein Beispielsatz mit Zeitlupe."`, `exampleEn "Here is an example sentence with Zeitlupe."`); `test_dictionary_is_frozen_and_not_mutated_by_callers`; `test_create_translation_service_returns_the_stub`.
- [ ] **Step 2: Run** `npx vitest run src/translation.test.ts` → FAIL.
- [ ] **Step 3: Implement** `translation.ts` (frozen dictionary, `fallbackInfo`, stub echoing the tapped `word`); in `result-view.ts` map the old fields (`type`→`pos`, `ipa`→`phonetic`, `example`→`exampleDe`) so the current sheet keeps working; update `result-view.test.ts` fixtures to the new shape.
- [ ] **Step 4: Run** the full suite `npx vitest run` and `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat: dummy word dictionary behind the translation service`.

---

### Task 3: Speech

**Files:** Create `frontend/src/speech.ts`, `frontend/src/speech.test.ts`.

**Interfaces:**
- Produces: `speak(text: string, lang = "de-DE", win: Window = window): boolean` — cancels a running utterance, speaks, returns `true`; returns `false` when `speechSynthesis`/`SpeechSynthesisUtterance` is missing or when speaking throws. Constant `SPEECH_UNSUPPORTED_MESSAGE = "Audio pronunciation is not supported in this browser"`.

- [ ] **Step 1: Write failing tests** with a fake `window` (`speechSynthesis: { cancel, speak }`, `SpeechSynthesisUtterance` class): `test_speaks_german_text_with_rate_085`, `test_cancels_running_utterance_first` (call order `cancel` then `speak`), `test_tapped_twice_speaks_twice_without_error`, `test_returns_false_without_speech_synthesis`, `test_returns_false_when_speak_throws`, `test_does_not_throw_on_empty_text` (returns `false`, nothing spoken).
- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement** `speak` and the message constant.
- [ ] **Step 4: Run** `npx vitest run src/speech.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: German pronunciation through speech synthesis`.

---

### Task 4: Toast

**Files:** Create `frontend/src/toast.ts`, `frontend/src/toast.test.ts`; append toast CSS to `styles.css`.

**Interfaces:**
- Produces: `createToaster(): { element: HTMLElement; show(message: string): void }`; `comingSoonMessage(label: string): string` → `"<label> is coming soon"`. The element is `div.toast` (`role="status"`, hidden until shown) containing the message and a close button (`aria-label="Dismiss"`).

- [ ] **Step 1: Write failing tests** (fake timers): `test_hidden_until_shown`, `test_show_displays_the_message`, `test_hides_after_3_seconds` (visible at 2999 ms, hidden at 3000 ms), `test_new_message_replaces_and_restarts_the_timer`, `test_close_button_hides_immediately`, `test_coming_soon_message_format` (`"Saved Words is coming soon"`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** CSS: absolute, `top: 4rem`, inset-x 1rem, `#0F172A` background, white text, radius 12 px, enter transition.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: toast with auto-hide`.

---

### Task 5: Inline icons

**Files:** Modify `frontend/package.json` (+ lockfile); create `frontend/src/icons.ts`, `frontend/src/icons.test.ts`.

**Interfaces:**
- Produces: `type IconName = "book-open-check" | "menu" | "x" | "camera" | "image" | "scan-text" | "sparkles" | "loader" | "refresh-cw" | "type" | "info" | "volume-2" | "volume-1" | "bookmark" | "check" | "pen-tool" | "book" | "layers" | "user" | "history" | "languages" | "sliders" | "download" | "book-open" | "check-circle" | "chevron-right"`; `icon(name: IconName, opts?: { size?: number; class?: string }): SVGElement` — `<svg>` with `width/height` = `size` (default 20), `aria-hidden="true"`, stroke `currentColor`.

- [ ] **Step 1: Install** `cd frontend && npm install -D lucide` and check the installed export names for the list above (Lucide renames icons between versions: `loader` may be `loader-circle`, `check-circle` may be `circle-check`, `sliders` may be `sliders-horizontal`). Keep `IconName` as written and map each to the real export; record any mapping in the commit message.
- [ ] **Step 2: Write failing tests**: `test_every_icon_name_renders_an_svg_with_paths` (loops over all names, expects `svg` with ≥ 1 child), `test_size_and_class_options`, `test_icons_are_hidden_from_assistive_tech`.
- [ ] **Step 3: Run** `npx vitest run src/icons.test.ts` → FAIL.
- [ ] **Step 4: Implement** `icons.ts` importing only these icons and building elements through lucide's `createElement`.
- [ ] **Step 5: Run** the test and `npx tsc --noEmit` → PASS.
- [ ] **Step 6: Commit** `feat: inline Lucide icons`.

---

### Task 6: Word bottom sheet

**Files:** Create `frontend/src/word-sheet.ts`, `frontend/src/word-sheet.test.ts`; modify `frontend/src/result-view.ts` and its test to use it; append sheet CSS.

**Interfaces:**
- Consumes: `WordInfo` (Task 2), `icon` (Task 5).
- Produces: `createWordSheet(deps: { speak(text: string): void; comingSoon(label: string): void; onClose(): void }): { element: HTMLElement; backdrop: HTMLElement; showLoading(word: string): void; show(info: WordInfo): void; showUnavailable(): void; hide(): void }`. DOM contract (tests rely on these selectors): `.sheet[role=dialog]` (hidden by default), `.sheet-backdrop`, `.handle`, `.sheet-word`, `.phonetic`, `.pos`, `.translation`, `.example-de`, `.example-en`, buttons with text `Save to Flashcards`, `Add Note`, `Full Dictionary`, header close button `aria-label="Close"`, speaker buttons `aria-label="Play pronunciation"` (word) and `aria-label="Play example"`.

- [ ] **Step 1: Write failing tests**: `test_hidden_by_default_with_backdrop_hidden`, `test_show_loading_opens_with_word_and_placeholders` (`…` in phonetic/translation/example), `test_show_fills_all_fields_from_word_info`, `test_show_unavailable_message` (`Translation unavailable`), `test_backdrop_handle_and_close_button_call_on_close` (three separate clicks), `test_hide_hides_sheet_and_backdrop`, `test_speaker_buttons_speak_the_word_and_the_german_example`, `test_save_add_note_and_full_dictionary_report_coming_soon` (labels `Save to Flashcards`, `Add Note`, `Full Dictionary`), `test_sheet_has_85dvh_max_height_class` (`.sheet` has class `sheet`; CSS asserted by `test_stylesheet_caps_sheet_height`: reads `styles.css` and expects `max-height: 85dvh` in the `.sheet` rule).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `word-sheet.ts` and CSS (`position: absolute; inset-inline: 0; bottom: 0; max-height: 85dvh; overflow-y: auto; border-radius: 2rem 2rem 0 0`; backdrop `absolute inset-0` rgba(15,23,42,.4)`; enter animation 300 ms ease-out, leave 200 ms ease-in).
- [ ] **Step 4: Rewire `result-view.ts`**: replace the inline sheet with `createWordSheet({ speak: deps.speak, comingSoon: deps.comingSoon, onClose: () => selection.clear() })`; append `sheet.element` and `sheet.backdrop` to the returned section; lookup logic unchanged (stale results ignored, `lookupId++` on clear). New `ResultViewDeps`: `{ translation; onNewPhoto(); speak(text: string): void; comingSoon(label: string): void }`. Add to `result-view.test.ts`: `test_closing_the_sheet_while_a_lookup_is_pending_does_not_reopen_it` (pending promise, click backdrop, resolve → sheet stays hidden), `test_backdrop_click_clears_the_selection`, and adapt the existing sheet tests to the new selectors.
- [ ] **Step 5: Run** `npx vitest run` and `npx tsc --noEmit` → PASS.
- [ ] **Step 6: Commit** `feat: word sheet with backdrop, pronunciation and coming-soon actions`.

---

### Task 7: Reader view (segmented control, word buttons, optional cards)

**Files:** Modify `frontend/src/result-view.ts`, `frontend/src/result-view.test.ts`; append reader CSS.

**Interfaces:**
- Consumes: `createWordSheet` (Task 6), `icon` (Task 5).
- Produces: `createResultView(state: { result: OcrResult; imageUrl: string; pageLabel?: string; sentenceTranslation?: string }, deps: ResultViewDeps): HTMLElement`. DOM contract: segmented control `.segmented` with buttons `[data-tab="image"]` ("Smart Image") and `[data-tab="text"]` ("Clean Text"), default `text`, plus `button.rescan[aria-label="New photo"]` calling `deps.onNewPhoto`; panes `[data-pane="image"|"text"]`; info strip `.info-strip` containing "Tap word for translation & audio" and the badge `DE ➔ EN`; words are `button.word[data-word-id]`; optional `.page-label` (only when `pageLabel` is given) and `.sentence-card` (only when `sentenceTranslation` is given).

- [ ] **Step 1: Write failing tests** (adapt the existing file): `test_segmented_control_defaults_to_clean_text_and_switches`, `test_rescan_button_calls_on_new_photo`, `test_words_are_buttons_with_min_height_class_and_wrap_rule` (each `.word` is a `button`; `styles.css` rule for `.word` contains `min-height: 2.75rem` and `overflow-wrap: anywhere`), `test_page_label_and_sentence_card_are_absent_by_default`, `test_page_label_and_sentence_card_render_when_given`, `test_long_compound_word_is_rendered_whole` (a word `Donaudampfschifffahrtsgesellschaft` appears unbroken in the DOM text), `test_selection_is_shared_between_tabs` (existing), `test_empty_result_message_and_new_photo` (existing, uses the new button label "New photo" inside the card).
- [ ] **Step 2: Run** `npx vitest run src/result-view.test.ts` → FAIL.
- [ ] **Step 3: Implement** the new structure and CSS (word button: sans, 1.125–1.25rem, `min-height: 2.75rem`, `padding: .25rem .625rem`, border slate-200, radius 12 px, `gap` .5–.625rem on the container, selected: `#FEF08A` + `#FACC15` border; `.words` is `display: flex; flex-wrap: wrap`; segmented control and info strip per spec §4).
- [ ] **Step 4: Run** the full suite and `tsc` → PASS.
- [ ] **Step 5: Commit** `feat: segmented reader with thumb-sized word buttons`.

---

### Task 8: Empty and scanning views

**Files:** Create `frontend/src/empty-view.ts`, `frontend/src/scanning-view.ts` and their tests; modify `frontend/src/capture.ts`, `frontend/src/capture.test.ts`; append CSS.

**Interfaces:**
- Consumes: `createCapture` (changed here), `icon`.
- Produces: `createCapture(root, onFile)` now labels its buttons "Scan Page with Camera" (camera input, `capture="environment"`, primary) and "Upload from Gallery" (secondary) and puts an icon in each; `createEmptyView(deps: { onFile(file: File): void }): HTMLElement` (title "Snap, Read & Learn", the description, the "Instant OCR" tag, the capture buttons); `createScanningView(opts: { imageUrl?: string }): HTMLElement` (preview image only when `imageUrl` is given, animated `.laser` line, pill "Extracting German words…", caption "Analyzing Page Layout & OCR").

- [ ] **Step 1: Write failing tests**: `capture.test.ts` — new labels and unchanged input attributes (camera has `capture="environment"`, gallery has none), file from either input reaches `onFile`; `empty-view.test.ts` — title text, "Instant OCR", two buttons, `onFile` wiring; `scanning-view.test.ts` — pill and caption texts, `.laser` present, `img` present only with `imageUrl`.
- [ ] **Step 2: Run** the three files → FAIL.
- [ ] **Step 3: Implement** both views, update `capture.ts`, add CSS (dashed indigo hero card, laser keyframes `scanLine` 2 s infinite ease-in-out).
- [ ] **Step 4: Run** the full suite and `tsc` → PASS.
- [ ] **Step 5: Commit** `feat: empty and scanning states`.

---

### Task 9: Compact header and drawer

**Files:** Modify `frontend/src/header.ts`, `frontend/src/header.test.ts`; create `frontend/src/drawer.ts`, `frontend/src/drawer.test.ts`; append CSS.

**Interfaces:**
- Consumes: `icon`, `comingSoonMessage` indirectly through the `comingSoon` callback.
- Produces: `renderHeader(opts: { onMenu(): void; onHome(): void }): HTMLElement` — logo icon button (calls `onHome`), title "ReadMate", badge "PWA", menu button `aria-label="Open menu"` (calls `onMenu`); the old Online/Offline badge, settings `details` menu and `watchOnlineStatus` are removed. `createDrawer(deps: { version: string; diagnostics: string; onScanner(): void; onResetToken(): void; comingSoon(label: string): void }): { element: HTMLElement; open(): void; close(): void }` — `.drawer-overlay` (hidden by default) with the panel and a backdrop area; items: "Scanner / Reader" (calls `onScanner`, then closes), "Saved Words", "Scan History", "Preferences" (each with a `Soon` badge; call `comingSoon` with that exact label), "Target Language: German" (no handler), footer card "Anki Export Ready" and button "Export Flashcards (.apkg)" (`comingSoon("Export Flashcards")`), then "Reset token" (calls `onResetToken`, closes), `Version <version>` and the diagnostics line; header with avatar "RM", "German Learner" and a close button.

- [ ] **Step 1: Write failing tests**: `header.test.ts` rewritten — `test_shows_logo_title_and_pwa_badge`, `test_menu_button_calls_on_menu`, `test_logo_calls_on_home`, `test_header_has_no_online_badge_or_settings_menu` (`.status` and `.menu` absent); `drawer.test.ts` — `test_hidden_until_opened_and_close_hides`, `test_backdrop_click_closes`, `test_scanner_item_navigates_and_closes`, `test_each_soon_item_reports_coming_soon_with_its_label` (`Saved Words`, `Scan History`, `Preferences`, `Export Flashcards`) and shows a `Soon` badge, `test_reset_token_calls_handler_and_closes`, `test_shows_version_and_diagnostics`, `test_target_language_is_static_german`.
- [ ] **Step 2: Run** both files → FAIL.
- [ ] **Step 3: Implement** both units and CSS (header padding `0.5rem 1rem`, `padding-top: max(8px, env(safe-area-inset-top))`; drawer panel `w-4/5 max-w 300px`, slides in horizontally, overlay `rgba(15,23,42,.4)` with blur).
- [ ] **Step 4: Keep `main.ts` compiling:** change only its `renderHeader(...)` call and its `watchOnlineStatus` import/call to the new signature (menu and home handlers may be no-ops until Task 11), then run the full suite and `tsc` → PASS.
- [ ] **Step 5: Commit** `feat: compact header and side drawer`.

---

### Task 10: Bottom navigation

**Files:** Create `frontend/src/bottom-nav.ts`, `frontend/src/bottom-nav.test.ts`; append CSS.

**Interfaces:**
- Produces: `renderBottomNav(opts: { active: "scan" | "reader" | null; readerAvailable: boolean; onScan(): void; onReader(): void; onCards(): void; onProfile(): void }): HTMLElement` — four buttons labelled Scan, Reader, Cards, Profile with icons (`camera`, `book-open`, `layers`, `user`); the active one has class `active` and `aria-current="page"`; Reader is `disabled` unless `readerAvailable`; Cards carries a small dot.

- [ ] **Step 1: Write failing tests**: `test_four_buttons_in_order`, `test_each_button_calls_its_handler`, `test_reader_is_disabled_without_a_result_and_does_not_call_its_handler`, `test_reader_enabled_when_a_result_exists`, `test_active_item_is_marked`, `test_no_item_is_marked_when_active_is_null`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** + CSS (padding `0.375rem 1.5rem` with `padding-bottom: max(6px, env(safe-area-inset-bottom))`, labels 9–10 px, active indigo, `flex-shrink: 0`).
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: bottom navigation`.

---

### Task 11: Composition, container rules, cleanup

**Files:** Modify `frontend/src/main.ts`, `frontend/src/styles.css`, `frontend/index.html` (no change expected unless a CDN reference exists); delete obsolete CSS (`.status`, `.menu`, `.menu-panel`, old `.app-header` rules, old `.sheet` rules from Phase 1, old `.tabs/.tab`, `.chip` where unused).

**Interfaces:**
- Consumes: everything above. `main.ts` produces the final DOM: `div.app-viewport-container` (`position: relative`, flex column) containing header, `main.content` (`flex: 1; overflow-y: auto`), bottom nav (hidden while `needsToken`), drawer, toaster; the result view's sheet/backdrop are positioned against the container.

- [ ] **Step 1: Compose `main.ts`:** state → screen (`needsToken` token card; `idle` → `createEmptyView({ onFile })` + iOS hint; `resizing`/`uploading` → `createScanningView`; `result` → `createResultView` with `speak` wired to `speak()` (toast `SPEECH_UNSUPPORTED_MESSAGE` when it returns `false`) and `comingSoon` wired to `toaster.show(comingSoonMessage(label))`; `error` card). Header `onMenu` opens the drawer; `onHome` → `controller.newPhoto()`. Bottom nav: Scan → `controller.newPhoto()`; Reader → `controller.showLastResult()` (enabled by `controller.hasLastResult()`); Cards → coming soon; Profile → open drawer; `active` is `scan` for `idle`/`resizing`/`uploading`, `reader` for `result`. Drawer deps from `BUILD_SHA`, `describeViewport()`, `controller.resetToken`. `applyUiScale()` and its resize listener stay. Remove the `watchOnlineStatus()` call.
- [ ] **Step 2: Write the container CSS** exactly as in Global Constraints (frame and touch rules), `position: relative; display: flex; flex-direction: column; background: #F8FAFC;` for `.app-viewport-container`, body background `#0F172A`, dark dotted background only for the desktop frame; delete the obsolete rules listed above.
- [ ] **Step 3: Verify:** `cd frontend && npx tsc --noEmit && npx vitest run` → all PASS; `npm run build` succeeds.
- [ ] **Step 4: Commit** `feat: compose UI v2 (container, drawer, toast, bottom nav)`.

---

### Task 12: Visual and offline verification (no code unless a defect is found)

- [ ] **Step 1: Run locally** with the fake engine: `powershell -NoProfile -ExecutionPolicy Bypass -File run.ps1 -Engine fake -NoBrowser` (background), open `http://localhost:5173` in the Browser pane, set token `dev`, upload a generated canvas JPEG.
- [ ] **Step 2: Check at 390×844** (screenshots): empty state, scanning state (take the shot during upload by delaying with a slow `fetch` stub), Clean Text, Smart Image, word sheet, drawer, toast ("Saved Words is coming soon"), bottom nav. Compare with the mockup's structure.
- [ ] **Step 3: Measure** with the page's JS: `document.documentElement.scrollWidth <= clientWidth` on the Clean Text pane; every `.word` `getBoundingClientRect().height >= 44` at root font 16 px; `.sheet` computed `max-height` equals 85 % of the viewport height; clicking `.sheet-backdrop` hides the sheet; the sheet and the toast lie inside `.app-viewport-container`'s rectangle in the desktop frame (resize to 1200×900 and measure).
- [ ] **Step 4: Offline check:** `npm run build`, then `grep -rE "https?://" dist --include=*.js --include=*.css --include=*.html -h` lists only namespace URLs (`www.w3.org`) and nothing from a CDN, font host or stock-image host; run `rm -rf dist` afterwards.
- [ ] **Step 5: Stop the servers**, reset the viewport, and report the results; any defect found becomes a failing test plus a fix in the owning task's file before closing.
