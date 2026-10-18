# ReadMate — UI v2 Design Spec

- **Date:** 2026-10-18
- **Status:** Draft — awaiting owner review
- **Path in repo:** `docs/superpowers/specs/2026-10-18-readmate-ui-v2-design.md`
- **Builds on:** `docs/superpowers/specs/2026-10-17-wort-tap-design.md` (Phase 1; the project was renamed to ReadMate on 2026-10-18) and the UI redesign committed in `053dbce`.
- **Inputs:** the designer's HTML mockup "ReadMate - Smart Reading & OCR Assistant", the designer's "UI/UX Implementation & Front-End Guidelines", and the designer's "UI/UX Alignment & Design System Spec".

## 1. Purpose

Replace the current ReadMate screens with the designer's second visual concept: a compact header with a side drawer, an empty-state hero, a scanning state, a segmented Smart Image / Clean Text reader with thumb-sized word buttons, a richer word bottom sheet, toast messages and a bottom navigation bar. The UI language stays English and the product name stays ReadMate.

This is a **UI-only** change. The OCR flow, the API contract (`contract/`), the backend and the pipeline are untouched. Everything the mockup shows that needs a backend or storage that does not exist yet is shown but answers with a "Coming soon" toast; the owner will define those backends later.

### Success criteria

1. The app visually follows the mockup and the guideline tables (colors, radii 12 px / 32 px, typography, compact header and footer) on a phone and, framed, on a desktop.
2. On every touch device the app fills the whole screen (`100vw` × `100dvh`), also when the browser reports a wide viewport ("Desktop site"); the decorative device frame appears only on a real desktop (mouse, wide window).
3. Every word in Clean Text is a button at least 44 px high, with `gap` that prevents hitting two words at once; the page has no horizontal scroll.
4. Real behavior stays real: camera and gallery capture, OCR through the existing API, shared word selection between both tabs, the word sheet (the Phase 1 "Copy" button is replaced by the sheet's actions), German pronunciation through the browser's speech synthesis.
5. Nothing is loaded from a CDN at runtime: icons are inline SVG, fonts are the system stack, CSS is local; the PWA works offline.
6. All existing flows and tests keep working; new behavior is covered by tests.

## 2. Scope

**In scope:** header, drawer, bottom navigation, empty state, scanning state, reader (segmented control, Smart Image pane, Clean Text pane with optional page indicator and optional sentence card), word bottom sheet (with backdrop), toast, pronunciation, "Coming soon" behavior, viewport/frame rules, inline icons, tests, visual verification.

**Out of scope:** any backend, storage or data model for saved words, flashcards, history, preferences, notes, dictionary lookup or Anki export; a bundled sample page; a real translation service (Phase 2); the Online/Offline badge of the previous header (the mockup has none; the existing offline error message stays).

## 3. Decisions

| Area | Decision | Why |
|---|---|---|
| Stack | Plain TypeScript + CSS, no Tailwind/Alpine/CDN | Offline PWA; keeps the "no UI framework" decision of Phase 1. The mockup's Alpine states map to small render functions. |
| Icons | npm package `lucide`, importing only the icons used, rendered as inline SVG | Correct paths without hand-copying; tree-shaken into the bundle; works offline. New build dependency, approved by the owner. |
| Scanning state | Shown during the real `resizing` and `uploading` states over the real photo preview | No fake scan; the animation reflects the actual OCR wait. |
| Rescan | The segmented-bar refresh button is "New photo" (returns to the empty state) | The app has no re-OCR of the same image; "New photo" is the existing equivalent. |
| Unimplemented items | Visible, answer with a toast "<Name> is coming soon", marked "Soon" where the mockup shows a badge | Matches the design, no fake data or counters, easy to replace when a backend exists. |
| Word data | `TranslationService` keeps its boundary; the stub returns the designer's dummy dictionary with a generic fallback | UI-only change; the real service is the owner's later decision. |
| Optional cards | Page indicator and "Full Sentence Translation" render only when a value is provided | Designer's conditional-element rule; no data exists today, so they stay hidden and the text gets the space. |
| Frame | Desktop frame only for `(hover: hover) and (pointer: fine) and (min-width: 768px)`; touch devices are full-screen | Designer's viewport fix; avoids the tiny floating column seen on a phone that reports a wide viewport. |
| Text size on wide-viewport phones | Keep the `viewport.ts` UI scaling (root font size from page width ÷ screen width on touch devices) and the diagnostics line | `100vw` alone fills the width but leaves text tiny when the page is laid out at ~980 px. |

## 4. Screens and states

State machine and controller (`app.ts`) are unchanged: `needsToken → idle → resizing → uploading → result | error`.

| App state | Screen | Content |
|---|---|---|
| `needsToken` | Token card | Header (no menu button), card with token input and Save. Restyled only. |
| `idle` | **Empty** | Hero: dashed indigo card with the scan icon and an "Instant OCR" tag; title "Snap, Read & Learn"; one-line description; primary button "Scan Page with Camera" (camera input), secondary "Upload from Gallery" (gallery input). iOS install hint below, as today. |
| `resizing`, `uploading` | **Scanning** | 256×320 card with the photo preview (placeholder while resizing), an animated laser line, a pill "Extracting German words…", caption "Analyzing Page Layout & OCR". |
| `result` (words) | **Interactive** | Segmented control "Smart Image" / "Clean Text" (default Clean Text) with a refresh icon button (New photo); the active pane; the word sheet. |
| `result` (no words) | Empty result | "No text found — try more light and hold the phone parallel to the page." + New photo. |
| `error` | Error card | Message, Try again, New photo, Enter token again, as today, restyled. |

**Layout:** header (fixed, compact), main (`flex: 1`, internal scroll), bottom navigation (fixed, compact), all inside `.app-viewport-container`. Header padding-top `max(8px, env(safe-area-inset-top))`; footer padding-bottom `max(6px, env(safe-area-inset-bottom))`; heights use `dvh`.

**Smart Image pane:** the existing overlay (percent-positioned boxes, shared selection) plus its toolbar (Fit, 2×, 3×, Outlines).

**Clean Text pane:** card with an info strip ("Tap word for translation & audio", badge "DE ➔ EN"), optional page indicator in the card header, the words as bordered buttons (`font-sans`, 18–20 px, `min-height: 44px`, `gap: 8–10px`), the selected word in `#FEF08A` with a `#FACC15` border, and the optional sentence card at the bottom. Words are the merged words of the OCR result in reading order, with their outer punctuation, exactly as in the current Clean Text.

## 5. Components

Each unit has one job and a small interface; DOM units are built with the existing `h()` helper.

| File | Responsibility | Interface |
|---|---|---|
| `icons.ts` | Inline SVG elements from the `lucide` icon data. | `icon(name: IconName, opts?: { size?: number; class?: string }): SVGElement` |
| `toast.ts` | One floating message, auto-hides after 3 s, close button. | `createToaster(): { element: HTMLElement; show(message: string): void }` |
| `drawer.ts` | Side drawer with overlay, horizontal animation, backdrop click closes. | `createDrawer(deps): { element; open(); close() }` — deps: navigation callbacks, `comingSoon(label)`, reset-token handler, version, diagnostics string |
| `bottom-nav.ts` | Scan / Reader / Cards / Profile. | `renderBottomNav({ active, readerAvailable, onScan, onReader, onCards, onProfile }): HTMLElement` |
| `header.ts` | Compact header: logo, "ReadMate", "PWA" badge, menu button. | `renderHeader({ onMenu }): HTMLElement` |
| `empty-view.ts` | Empty state. | `createEmptyView({ onFile }): HTMLElement` (uses `capture.ts`) |
| `scanning-view.ts` | Scanning state. | `createScanningView({ imageUrl? }): HTMLElement` |
| `word-sheet.ts` | Word bottom sheet (extracted from `result-view.ts`): handle, header with speaker button, phonetic and part-of-speech badges, translation card, example sentence with speaker, actions, backdrop; max height 85 `dvh`, internal scroll. | `createWordSheet({ speak, comingSoon, onClose }): { element; showLoading(word); show(info); showUnavailable(); hide() }` |
| `speech.ts` | German pronunciation. | `speak(text: string, lang = "de-DE"): boolean` (false when speech synthesis is unsupported; the caller shows a toast) |
| `result-view.ts` | Segmented reader, panes, selection wiring. | `createResultView(state, deps)` as today, plus optional `pageLabel?: string` and `sentenceTranslation?: string` |
| `translation.ts` | Word lookup boundary. | `WordInfo = { word; phonetic; pos; translation; exampleDe; exampleEn }`; `TranslationService.lookup(word, context): Promise<WordInfo>` (unchanged signature); stub with the designer's dictionary and a generic fallback |
| `viewport.ts` | UI scaling and diagnostics (exists). | unchanged |
| `main.ts` | Composition: container, header, drawer, toast, bottom nav, screen per state. | — |

**"Coming soon":** a single helper `comingSoon(label)` shows the toast `"<label> is coming soon"`. Used by: Saved Words, Scan History, Preferences, Export Flashcards, Cards (nav), Save to Flashcards, Add Note, Full Dictionary.

**Drawer content:** header (avatar "RM" and "German Learner"), close button; navigation: Scanner / Reader (real: goes to the empty state), Saved Words and Scan History and Preferences (Coming soon, "Soon" badge), Target Language: **German** (static); footer: the Anki card and "Export Flashcards (.apkg)" (Coming soon), then — below the mockup's content, because they exist today — "Reset token", "Version <sha>" and the viewport diagnostics line.

**Bottom navigation:** Scan → empty state; Reader → the last result when one exists, otherwise the button is disabled; Cards → Coming soon; Profile → opens the drawer.

**Bottom sheet:** header shows word, speaker button (real pronunciation), phonetic (monospace badge), part of speech (indigo badge) and a close button; body: "English Translation" card and "Example Sentence" (German with its own speaker button, English in italics); actions: "Save to Flashcards" (Coming soon), "Add Note" and "Full Dictionary" (Coming soon). Opens at once with the tapped word and placeholders, fills when the lookup resolves, shows "Translation unavailable" on failure, ignores stale lookups (as today). Tapping the backdrop, the handle or the close button closes it and clears the selection.

## 6. Responsive rules

```css
@media (hover: hover) and (pointer: fine) and (min-width: 768px) {
  .app-viewport-container { max-width: 390px; height: 844px; border-radius: 48px;
    border: 8px solid #334155; box-shadow: 0 25px 50px -12px rgba(0,0,0,.25); margin: 2rem auto; }
}
@media (pointer: coarse), (hover: none) {
  .app-viewport-container { width: 100vw; height: 100dvh; max-width: 100%;
    border: none; border-radius: 0; margin: 0; }
}
```

(The `!important` flags of the designer's snippet are used only if a specificity conflict requires them.) Touch devices always use `dvh`. `viewport.ts` keeps scaling the root font size on touch devices whose page width is much larger than their screen width. All sizes in CSS are `rem` except hairlines and media-query widths.

## 7. Offline and assets

No runtime CDN: icons from `lucide` bundled as inline SVG; font stack `Inter, system-ui, -apple-system, "Segoe UI", sans-serif` without downloading; all CSS local. The PWA precache picks up the new bundle automatically; the API stays `NetworkOnly`.

## 8. Error handling

- Speech synthesis unsupported or failing → toast "Audio pronunciation is not supported in this browser".
- Lookup failure → "Translation unavailable" in the sheet.
- Toast: a new message replaces the current one and restarts the 3 s timer.
- A sheet, drawer or toast never survives a screen change that removes its context (the controller re-renders on state change, as today).

## 9. Testing

Vitest with jsdom, in the existing style:

- `icons`: returns an `svg` with the Lucide paths for each used name; unknown name is a type error.
- `toast`: shows the message, hides after 3 s (fake timers), a second message resets the timer, close button hides.
- `drawer`: opens and closes, backdrop click closes, "Coming soon" items call the callback, real items call their handlers, shows version and diagnostics.
- `bottom-nav`: the four buttons call their handlers, Reader is disabled without a result, the active item is marked.
- `empty-view`, `scanning-view`: texts, the two capture inputs (camera has `capture`), preview shown when a URL is given.
- `word-sheet`: loading placeholders, filled state, unavailable state, backdrop/handle/close all close, `max-height` class present, speaker buttons call `speak` with the word and with the German example.
- `speech`: calls `speechSynthesis.speak` with `de-DE`, cancels a running utterance first, returns false without support.
- `translation`: dictionary hit, fallback generator for unknown words, defaults not mutated.
- `result-view`: segmented control default and switching, word buttons (`min-height` style class), optional page indicator and sentence card absent by default and present when provided, shared selection between the panes (existing tests adapted).
- `main` composition is verified visually, as in the previous UI work.

Visual verification with `.\run.cmd -Engine fake` at 390 px width and in the desktop frame (screenshots), plus the designer's checklist: no horizontal scroll (`scrollWidth ≤ clientWidth`), word buttons ≥ 44 px (measured), backdrop closes the sheet, safe-area CSS present. Real-device checks (notch, thumb tapping) stay with the owner.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Many new files for a UI change | One responsibility per file, small interfaces, tested in isolation. |
| `lucide` is a new dependency | Only icon data is imported (tree-shaken); version pinned by the lockfile; Dependabot is limited to GitHub Actions today, so bumps are manual. |
| Dummy dictionary words look like real translations | Documented in code and spec as UI mock data; the service boundary makes the later replacement local. |
| Wide-viewport phones | Touch full-screen rule plus the existing UI scaling and diagnostics line; the owner's diagnostics screenshot confirms the cause. |
| 187 word buttons per page make Clean Text long | Per the design; internal scroll in `main`. |
