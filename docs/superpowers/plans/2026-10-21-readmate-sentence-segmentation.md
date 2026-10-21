# Sentence Segmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a last backend pipeline step that groups the page's words into `sentences[]` entries (`sentence` / `fragment` / `incomplete`) and returns them as an optional, additive contract field.

**Architecture:** Three focused modules under `backend/src/readmate/pipeline/`: `punctuation.py` (does a box's raw text end a sentence; display text of a word), `layout.py` (which lines end a paragraph, which lines are short), `sentences.py` (cut words into entries, label them, plus the per-line fallback). `process_image` calls `segment_sentences` last, inside a safety net.

**Tech Stack:** Python 3.13, pytest, jsonschema, ruff; frontend Vitest + tsc only to prove nothing changed there.

**Spec:** `docs/superpowers/specs/2026-10-21-readmate-sentence-segmentation-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- Pipeline order: `normalize → filter_noise → merge_hyphenated → segment_sentences`; the new step reads `lines`, `boxes`, `words` and never modifies or renumbers them.
- Additive API only: `sentences` is optional in the schema, not in `required`; the new backend always emits it (possibly `[]`). No existing field changes.
- No frontend file changes. `frontend/src/contract.ts` and its guard stay as they are.
- Constants (module-level, named exactly): `GAP_IN_UNITS = 1.0`, `SHORT_LINE_RATIO = 0.85`, `INDENT_IN_UNITS = 0.7`, `WINDOW = 3`.
- Closing characters: `“ ” " ' ’ ‘ » « ) ]`. Opening characters: `„ ‚ » « “ ( [ " '`.
- Abbreviations (case-sensitive): `usw bzw Dr Nr ca etc vgl ggf evtl Prof Mio Mrd Jh Str St`.
- 90th percentile = `sorted(xs)[int(0.9 * (len(xs) - 1))]`; median = `statistics.median`.
- Run backend commands from `backend/`: tests `.venv/Scripts/python -m pytest -q`, lint `.venv/Scripts/ruff check .` (or `ruff check .` if on PATH).
- Local commits only; never push.

## Review Focus

- A page that is a list of short, non-indented lines without punctuation (menu, table of contents): no exception; every word exactly once (entries may merge — acceptable for the pilot). Test in Task 3.
- A box with zero width (`w = 0`): column overlap and relative width must not divide by zero. Test in Task 2.
- Lines whose reading order is not top-to-bottom (engine returns a lower line first, negative gaps): no exception, no boundary from a negative gap. Test in Task 2.
- The page's last line ends in an unmerged hyphen (`Vorstel-` with no continuation): last entry is `incomplete`. Test in Task 3.
- A word whose `text` is empty or starts with a digit/quote after cleaning: the lowercase checks (`text[:1].islower()`) must be safe. Test in Task 3.

---

### Task 1: Punctuation rules

**Files:**
- Create: `backend/src/readmate/pipeline/punctuation.py`
- Test: `backend/tests/test_punctuation.py`

**Interfaces:**
- Consumes: `readmate.pipeline.normalize._STRIP` (the characters `clean_word` strips) — import it rather than redefine it.
- Produces:
  - `CLOSING: str`, `OPENING: str`, `ABBREVIATIONS: frozenset[str]`
  - `ends_by_punctuation(raw: str) -> bool` — spec §4 rules 1–4 (no lowercase cancel; that needs the next word and lives in Task 3).
  - `display_text(word: OcrWord, boxes: dict[int, OcrBox]) -> str` — leading characters that `clean_word` stripped from the first box's `raw` + `word["text"]` + trailing characters stripped from the last box's `raw`.

- [ ] **Step 1: Write the failing tests** — a parametrized `test_ends_by_punctuation(raw, expected)`:

```python
@pytest.mark.parametrize("raw, expected", [
    ("Haus.", True), ("Haus!", True), ("Haus?", True), ("Haus…", True), ("Haus...", True),
    ("Haus.“", True), ("Haus.«", True), ("Haus.»", True), ("Haus.)", True), ("Haus.]", True),
    ("Haus?«", True), ("1989.", True),
    ("Haus", False), ("Haus,", False), ("Haus:", False), ("Haus;", False),
    ("z.", False), ("B.", False), ("S.", False), ("J.", False),
    ("z.B.", False), ("d.h.", False), ("u.a.", False), ("3.10.", False),
    ("usw.", False), ("Dr.", False), ("Mio.", False), ("St.", False), ("(vgl.", False),
    ("3.", False), ("31.", False),
    ("ab...", True),  # ellipsis is checked before the dotted-abbreviation rule
])
```

  Plus `test_display_text_keeps_punctuation`: a single-box word with raw `»Sind` → `»Sind`; raw `Arbeit.` → `Arbeit.`; a hyphen-merged word (boxes raw `Vorstel-`, `lungskraft.“`, text `Vorstellungskraft`) → `Vorstellungskraft.“`.

- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest tests/test_punctuation.py -q` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `ends_by_punctuation` and `display_text` in `punctuation.py`, rules in the spec's §4 order: strip `CLOSING` from the right; `...`/`…` → True; `!`/`?` → True; no `.` → False; token = text before final `.` with `OPENING` stripped from the left; token contains `.` → False; single letter → False; in `ABBREVIATIONS` → False; 1–2 digits → False; else True.

- [ ] **Step 4: Run** the test file — Expected: PASS. Run `ruff check .` — clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/readmate/pipeline/punctuation.py backend/tests/test_punctuation.py
git commit -m "feat(pipeline): sentence-end punctuation rules"
```

---

### Task 2: Layout boundaries

**Files:**
- Create: `backend/src/readmate/pipeline/layout.py`
- Modify: `backend/tests/helpers.py` (add `text_line`)
- Test: `backend/tests/test_layout.py`

**Interfaces:**
- Consumes: `OcrResult` after `merge_hyphenated`.
- Produces:
  - `GAP_IN_UNITS`, `SHORT_LINE_RATIO`, `INDENT_IN_UNITS`, `WINDOW` constants.
  - `class Layout(NamedTuple): boundary_after: set[int]; short: set[int]` — line ids.
  - `analyze_layout(result: OcrResult) -> Layout`
  - test helper `text_line(text: str, y: float, x: float = 0.1, right: float = 0.9, h: float = 0.03) -> list[tuple[str, Box]]` in `tests/helpers.py`: splits `text` on spaces and spreads the words evenly between `x` and `right` (small gap between words), for use with `raw_page`.

Definitions are spec §5.1–§5.2; decisions not stated there:
- Line extent uses the line's kept boxes; `top`/`bottom` from the line box.
- Column of a line = lines in `result["lines"]` order whose extents overlap it by ≥ 50% of the narrower width (includes itself). A zero-width line overlaps nothing but itself.
- "Next line" = next entry in `result["lines"]`. A negative gap is never a gap boundary.
- Relative width: when `columnRight - localLeft <= 0`, the line is not short.
- A line whose last box `raw` ends in `-` is never in `boundary_after`. The last line of the page is not in `boundary_after` (Task 3 closes the final entry itself).
- Test-data gotcha: with the percentile definition above, a column of two lines takes the *lower* right edge as the column edge. Synthetic pages that rely on `short` therefore need at least three full-width lines in the column.

- [ ] **Step 1: Write the failing tests** (pipeline helper in the test file: `def prepared(page): return merge_hyphenated(filter_noise(normalize(page)))`):
  - `test_large_gap_is_boundary` — two full lines at y 0.10 and 0.25 → `boundary_after == {0}`.
  - `test_short_line_then_indented_line_is_boundary` — 4 full lines at step 0.04, line 1 with `right=0.4`, line 2 with `x=0.14` → `1 in boundary_after`.
  - `test_short_line_alone_is_not_boundary` — same, line 2 not indented → `boundary_after == set()`, `1 in short`.
  - `test_hyphen_line_is_never_boundary` — short line ending `Vor-` followed by large gap and `stellung` → `boundary_after == set()`.
  - `test_skewed_page_has_no_false_indents` — 12 full lines, left edges drifting linearly 0.07 → 0.03, right 0.9 → `boundary_after == set()` and `short == set()`.
  - `test_book_fixture_layout` — book fixture via `from_textract`: `boundary_after == {11, 17, 21}` and `{11, 17, 21, 22} <= short`.
  - `test_single_line_column_uses_own_left_edge` — one line page → no exception, `short == set()`.
  - `test_zero_width_box_does_not_divide_by_zero` (Review Focus) — a line made of one box with `w=0` among full lines → no exception.
  - `test_lines_out_of_vertical_order` (Review Focus) — lines listed bottom-first → no exception, `boundary_after == set()`.

- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest tests/test_layout.py -q` — Expected: FAIL.

- [ ] **Step 3: Implement** `analyze_layout` and `text_line`.

- [ ] **Step 4: Run** the test file — PASS; `ruff check .` clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/readmate/pipeline/layout.py backend/tests/helpers.py backend/tests/test_layout.py
git commit -m "feat(pipeline): paragraph boundaries and short lines from layout"
```

---

### Task 3: Segment and label

**Files:**
- Create: `backend/src/readmate/pipeline/sentences.py`
- Modify: `backend/src/readmate/pipeline/types.py` (add `OcrSentence`, `OcrResult.sentences: NotRequired[list[OcrSentence]]`)
- Test: `backend/tests/test_sentences.py`

**Interfaces:**
- Consumes: `ends_by_punctuation`, `display_text` (Task 1); `analyze_layout`, `Layout` (Task 2).
- Produces:
  - `class OcrSentence(TypedDict): id: int; kind: Literal["sentence", "fragment", "incomplete"]; wordIds: list[int]; text: str`
  - `segment_sentences(result: OcrResult) -> list[OcrSentence]` — returns the list; does not modify `result`.
  - `fallback_sentences(result: OcrResult) -> list[OcrSentence]` — spec §8.3: one `fragment` per line that has words, each word in the line of its first box, `text` via `display_text`.

**Cutting** (walk `result["words"]` in order; this is the algorithm the spec leaves to the plan):
1. Append the word to the current entry.
2. `end = ends_by_punctuation(raw of the word's last box)`; if `end` and the next word's `text[:1].islower()`, `end = False`.
3. If the word's last box is the last box of its line and that line is in `layout.boundary_after`, `end = True` (applied after step 2, so the cancel rule never removes a boundary).
4. If `end`, close the entry. After the loop, close any open entry.

**Labelling** (spec §6), per entry, with `punct = ends_by_punctuation(raw of the entry's last word's last box)`:
- Start-incomplete: the first entry whose first word's `text[:1].islower()`, provided no earlier entry has `punct`, is `incomplete` (earlier entries without `punct` are leading fragments such as a page number).
- End-incomplete: an entry with `punct == False`, followed only by entries with `punct == False`, whose last word's last box's line is not in `layout.short` or whose last box `raw` ends in `-`.
- Else `sentence` if `punct`, else `fragment`. Ids are 0.. in order.

- [ ] **Step 1: Write the failing tests:**
  - `test_book_fixture_entries` — pins exactly (first word id, last word id, kind):

```python
EXPECTED = [
    (0, 15, "sentence"), (16, 35, "sentence"), (36, 61, "sentence"), (62, 69, "sentence"),
    (71, 79, "sentence"), (81, 95, "sentence"), (96, 108, "sentence"), (109, 119, "sentence"),
    (120, 137, "sentence"), (138, 145, "sentence"), (146, 154, "sentence"),
    (155, 159, "fragment"), (161, 171, "sentence"), (172, 190, "sentence"), (191, 191, "fragment"),
]
```

    plus: concatenated `wordIds` == `[w["id"] for w in words]`; ids are `0..14`; entry 11 `text == "»Sind Sie die Mutter von"`.
  - `test_kommst_du_fragte_er_is_one_entry` — `„Kommst du?“ fragte er. Dann ging er.` → 2 entries.
  - `test_unlisted_abbreviation_before_lowercase` — `Siehe Abs. drei hier. Ende.` → 2 entries.
  - `test_usw_before_lowercase` — `Äpfel usw. und Birnen. Ende.` → 2 entries.
  - `test_cancel_never_removes_boundary` — full lines `Es war ein langer Tag und` / `der Abend kam sehr spät`, short line `Er kam nach Hause.` (`right=0.5`), indented full line `und dann schlief er ein.` (`x=0.14`) → 2 entries; same page with a large gap instead of the indent → 2 entries.
  - `test_colon_semicolon_comma_do_not_end` — `Er sagte: ja; nein, gut.` → 1 `sentence`.
  - `test_ordinal_date_does_not_end` — `Am 3. Oktober kam er.` → 1 entry.
  - `test_hyphen_merged_word_ends_sentence` — `Das ist die Vorstel-` / `lungskraft. Neu hier.` → first entry ends with the merged word, which appears once.
  - `test_first_lowercase_is_incomplete` — `zufangen. Ich sah es.` → kinds `["incomplete", "sentence"]`.
  - `test_page_number_then_lowercase` — line `7` (short, large gap) then `weiter ging es. Ende.` → kinds `["fragment", "incomplete", "sentence"]`.
  - `test_last_full_line_without_punctuation_is_incomplete` — `Er ging. Dann kam der` (full width, last line) → `["sentence", "incomplete"]`.
  - `test_trailing_page_number_is_fragment` — full lines `Er ging.` / `Sie kam.` / `Es regnete.`, large gap, short line `7` (`x=0.45, right=0.48`) → `["sentence", "sentence", "sentence", "fragment"]`.
  - `test_heading_mid_page_is_fragment` — short `Kapitel Zwei`, large gap, `Er ging. Sie kam.` → `["fragment", "sentence", "sentence"]`.
  - `test_page_ends_in_unmerged_hyphen` (Review Focus) — last line `Er sah die Vorstel-` → last kind `incomplete`.
  - `test_two_columns_in_reading_order` — left column x 0.05–0.45 lines `Links eins.` / `Links zwei`, right column x 0.55–0.95 `Rechts drei.`, listed column by column → entries `Links eins.` | `Links zwei Rechts drei.` (documents §7: flow across columns follows reading order).
  - `test_dropped_standalone_period_merges_sentences` — words `Er ging` then a box `.` (dropped by `filter_noise`) then `Sie kam.` on the same line → 1 entry (documents §9).
  - `test_small_inputs` — parametrized over: empty page, `Hallo`, one line `Er kam heute.`, three one-word lines, numbers only (`7 12 2024`), a one-line column beside a normal column → no exception, concatenated `wordIds` equals word order, every `kind` in the enum.
  - `test_all_short_list_page` (Review Focus) — 6 short, non-indented lines `Brot`, `Milch`, … → no exception, every word once.
  - `test_empty_or_quote_text_word` (Review Focus) — a word whose cleaned `text` is `""` (construct the `OcrResult` directly) → no exception.
  - `test_fallback_one_fragment_per_line` — book fixture: `fallback_sentences` gives one `fragment` per line with words (23 entries; line 11 `lungskraft da.` keeps only `da`, because `lungskraft` belongs to line 10's word), concatenated `wordIds` equals word order.

- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest tests/test_sentences.py -q` — Expected: FAIL.

- [ ] **Step 3: Implement** `OcrSentence`, `segment_sentences`, `fallback_sentences`.

- [ ] **Step 4: Run** the test file — PASS; full suite `.venv/Scripts/python -m pytest -q` — PASS; `ruff check .` clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/readmate/pipeline/sentences.py backend/src/readmate/pipeline/types.py backend/tests/test_sentences.py
git commit -m "feat(pipeline): segment words into sentences, fragments and incomplete entries"
```

---

### Task 4: Wire into the pipeline, safety net, contract

**Files:**
- Modify: `backend/src/readmate/core/process_image.py`
- Modify: `contract/ocr-result.schema.json`
- Regenerate: `contract/example.json`
- Test: `backend/tests/test_process_image.py`, `backend/tests/test_contract.py` (existing golden test, unchanged)

**Interfaces:**
- Consumes: `segment_sentences`, `fallback_sentences` (Task 3).
- Produces: every `process_image` result has `sentences`.

- [ ] **Step 1: Write the failing tests** in `test_process_image.py`:
  - `test_result_always_has_sentences` — golden fixture → `out["sentences"] == [{"id": 0, "kind": "sentence", "wordIds": [1, 2, 4, 5], "text": "Das Vorstellungskraft war groß."}]`.
  - extend `test_blank_page_returns_empty_valid_result`: `out["sentences"] == []`.
  - `test_segmentation_failure_falls_back(monkeypatch, caplog)` — monkeypatch `readmate.core.process_image.segment_sentences` to raise `RuntimeError("boom")`; golden fixture → no exception; `sentences` equals `fallback_sentences` of the same result (3 fragments: words `[1, 2]`, `[4]`, `[5]`); a `readmate` log record at ERROR level with exception info; output validates against the schema.

- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest tests/test_process_image.py -q` — Expected: FAIL.

- [ ] **Step 3: Implement** in `process_image`: after the existing steps, `result["sentences"] = segment_sentences(result)` inside `try`; `except Exception:` `logger.exception("sentence segmentation failed")` with `logger = logging.getLogger("readmate")`, then `result["sentences"] = fallback_sentences(result)`. In the schema add property `sentences` (not required): array of objects, `additionalProperties: false`, required `id`, `kind`, `wordIds`, `text`; `id` integer ≥ 0; `kind` enum `["sentence", "fragment", "incomplete"]`; `wordIds` array of integers ≥ 0 with `minItems: 1`; `text` string.

- [ ] **Step 4: Regenerate the golden** — `UPDATE_GOLDEN=1 .venv/Scripts/python -m pytest tests/test_contract.py -q` (PowerShell: `$env:UPDATE_GOLDEN=1; ...; Remove-Item Env:UPDATE_GOLDEN`). Check with `git diff contract/example.json` that the only change is the added `sentences` array from Step 1.

- [ ] **Step 5: Verify everything**
  - `.venv/Scripts/python -m pytest -q` — all pass (including `test_contract.py` without `UPDATE_GOLDEN`, `test_workflow.py`, `test_github_oidc_template.py`).
  - `ruff check .` — clean.
  - `cd ../frontend; npx vitest run` — all pass (proves the guard accepts the new golden unchanged); `npx tsc --noEmit` — clean.
  - `git status` shows no file under `frontend/` changed.

- [ ] **Step 6: Commit**

```bash
git add backend/src/readmate/core/process_image.py backend/tests/test_process_image.py contract/ocr-result.schema.json contract/example.json
git commit -m "feat: add optional sentences to the OCR result, with a per-line fallback"
```
