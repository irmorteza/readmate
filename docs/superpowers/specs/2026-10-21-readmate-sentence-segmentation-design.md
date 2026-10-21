# ReadMate — Sentence Segmentation Design Spec

- **Date:** 2026-10-21
- **Status:** Draft — awaiting owner review
- **Path in repo:** `docs/superpowers/specs/2026-10-21-readmate-sentence-segmentation-design.md`
- **Builds on:** `docs/superpowers/specs/2026-10-17-wort-tap-design.md` (OCR pipeline and contract)
- **Prerequisite for:** Phase 2 (word-info API)

## 1. Purpose

The upcoming word-info API needs, for a tapped word:

- the full sentence it belongs to (German separable-verb particles often sit at the sentence end, on another line);
- whether the word stands alone (heading, caption, page number) or sits in a sentence;
- word positions inside the sentence, so the frontend can later highlight the parts of a separable verb or a collocation.

This spec adds a last backend pipeline step, `segment_sentences`, that groups the page's words into sentence entries and returns them as a new top-level `sentences` array.

### Success criteria

1. Every word in `words[]` belongs to exactly one entry of `sentences[]`; each entry's `wordIds` are in reading order; concatenating all entries' `wordIds` gives `words[]` order exactly.
2. On the book fixture the result is the 15 entries pinned in §8.1.
3. Each rule in §4–§6 has at least one small synthetic test.
4. The output validates against the extended schema; the current frontend guard `isOcrResult` passes unchanged on the new golden example.
5. No existing field changes shape or meaning.

## 2. Scope

**In scope:** the `segment_sentences` step and its tests; the `OcrSentence` type; the optional `sentences` schema property; the regenerated golden `contract/example.json`.

**Out of scope:** any frontend change (listed in §10), the word-info API itself, language other than German, multi-column validation on real data.

## 3. Pipeline position and inputs

The real pipeline order is:

```
normalize → filter_noise → merge_hyphenated → segment_sentences
```

`segment_sentences` runs last in `process_image`, so it sees noise already removed and hyphenated words already merged. It reads, never modifies, `lines`, `boxes` and `words`; ids are not renumbered.

**Inputs it relies on:**

- `words[]` order is the reading order (it follows the engine's line order; see §7).
- `words[].text` has punctuation stripped by `clean_word`, so punctuation is read from box `raw` text:
  - **terminal punctuation** from the `raw` of the word's **last** box (the second-line box for a hyphen-merged word);
  - **opening punctuation** from the `raw` of the word's **first** box.
- A hyphen-merged word is one word.

## 4. Punctuation end

A word *ends a sentence by punctuation* when its last box `raw`, after removing trailing closing characters, ends in terminal punctuation and none of the exceptions apply.

**Closing characters** (removed from the right first): `“ ” " ' ’ ‘ » « ) ]` — both `»` and `«`, since German uses `»…«` and Swiss uses `«…»`.

**Opening characters** (removed from the left of a token when checking abbreviations, and kept in `text`): `„ ‚ » « “ ( [` plus `" '`.

**Rules, checked in this order:**

1. Ends in `...` or `…` → end.
2. Ends in `!` or `?` → end.
3. Does not end in `.` → not an end.
4. Let *token* be the text before the final `.`, with opening characters stripped.
   - *token* contains a `.` → abbreviation, not an end (`z.B.`, `d.h.`, `u.a.`, `3.10.`).
   - *token* is a single letter → not an end (`z.`, `B.`, `S.`, initials like `J.`).
   - *token* is in the abbreviation list → not an end.
   - *token* is 1–2 digits → ordinal or date, not an end (`am 3. Oktober`).
   - Otherwise (including 3+ digits such as `1989.`) → end.

**Abbreviation list** (case-sensitive, kept short on purpose):

```
usw bzw Dr Nr ca etc vgl ggf evtl Prof Mio Mrd Jh Str St
```

**Lowercase cancel rule:** a punctuation end is cancelled when the next word's `text` starts with a lowercase letter. German sentences always start uppercase, so this handles `„Kommst du?“ fragte er.`, unlisted abbreviations, mid-sentence ellipses, and `usw.` / ordinals followed by lowercase. It applies only to punctuation ends, never to paragraph boundaries (§5).

## 5. Paragraph boundaries (layout)

Boundary detection is separate from labelling. A *boundary after line L* closes the current entry after L's last word, whatever the punctuation.

### 5.1 Definitions

All measurements use kept boxes (after `filter_noise`), not the engine's line box, which may still span dropped glyphs.

- **Unit height `u`:** median height of all boxes on the page (as in `filter_noise`).
- **Line extent:** `left` = min `x` of the line's boxes, `right` = max `x + w`; `top` and `bottom` from the line box.
- **Column of a line:** the lines whose horizontal extent overlaps it by ≥ 50% of the narrower of the two (the same rule `merge_hyphenated` uses), in reading order.
- **Column right edge:** 90th percentile of `right` over the line's column.
- **Local left edge of a line:** median `left` of up to `WINDOW` lines before and `WINDOW` lines after it in its column, excluding the line itself. A page-wide median is not used: the book photo is skewed (left edges drift from 0.07 to 0.03 down the page), and a page-wide reference makes ordinary lines look indented and hides real indents.
- **Relative width:** `(right − localLeft) / (columnRight − localLeft)`, using the line's own local left edge.
- **Short line:** relative width < `SHORT_LINE_RATIO`.
- **Indented line:** `left − localLeft ≥ INDENT_IN_UNITS × u`.
- **Gap:** `next.top − line.bottom`.

### 5.2 Rule

There is a boundary after line L when L's last box `raw` does **not** end in `-` and either:

- (a) the gap to the next line in reading order is > `GAP_IN_UNITS × u`, or
- (b) L is short **and** the next line is indented.

A short line alone is not a boundary. The last line of the page always closes the current entry.

### 5.3 Constants (calibrated on the book fixture)

| Constant | Value | Book fixture: ordinary lines | Book fixture: boundaries |
|---|---|---|---|
| `GAP_IN_UNITS` | 1.0 | gap ≤ 0.53 u | 5.7 u, 3.4 u |
| `SHORT_LINE_RATIO` | 0.85 | width ≥ 0.97 | ≈ 0.16 – 0.52 |
| `INDENT_IN_UNITS` | 0.7 | ≤ 0.32 u | 1.43 u (line 18) |
| `WINDOW` | 3 | | |

**These thresholds are calibrated on a single page and may need re-tuning** when more fixtures (newspaper, other books, other cameras) are captured. They are named module constants so they can be adjusted with their tests.

An "opening quote or digit at the start of the next line" signal was considered and left out: it changes nothing on the book fixture and also occurs mid-sentence.

## 6. Labels

Segments are cut by punctuation ends (§4) and boundaries (§5), then labelled:

- **`sentence`:** the last word ends by punctuation (§4 rules 1–4; the lowercase cancel rule does not apply to the last word of an entry).
- **`incomplete`** (continued from the previous page): the first segment of the page that is not a leading fragment starts with a lowercase letter. Leading fragments are segments before it without punctuation end, such as a page header or page number. This label wins over `sentence` (`zufangen. Ich…` → the `zufangen.` entry is `incomplete`).
- **`incomplete`** (continued to the next page): a segment without punctuation end, after which no segment has a punctuation end, and whose last line is not short or ends in `-`.
- **`fragment`:** everything else — headings, captions, page numbers, list items, and OCR-truncated sentences such as book fixture line 17 `„Sind Sie die Mutter von`. The point for that line is that it must not merge with `Ich saß …`.

## 7. Multi-column pages

**Assumption:** `words[]` order (the engine's line order) is the correct reading order, column by column. Column statistics (§5.1) are computed per column, not per page, so a narrow column is not "short" against a wider neighbour.

**If the assumption is wrong** (the engine interleaves lines of two columns), entries mix words from both columns and the gap/indent tests compare lines of different columns. Nothing in this step can repair a wrong reading order.

This is tested with synthetic two-column data only. A real newspaper fixture would validate it; it is not needed for this spec and should be captured before the column rule is relied on.

## 8. Output and contract

### 8.1 Shape

```json
"sentences": [
  { "id": 0, "kind": "sentence", "wordIds": [0, 1, 2], "text": "Als Linn …" }
]
```

- `id`: integer from 0, consecutive in reading order.
- `kind`: `"sentence" | "fragment" | "incomplete"`.
- `wordIds`: ids into `words[]`, in reading order, non-empty.
- `text`: for each word, the leading opening characters of its first box `raw` + `word.text` + the trailing punctuation of its last box `raw`, joined by single spaces. Punctuation is kept so the Phase 2 model sees the real sentence.

**Expected result on the book fixture** (pinned in the test by first word id, last word id and kind):

| # | first | last | kind | starts with |
|---|---|---|---|---|
| 0 | 0 | 15 | sentence | Als Linn anderthalb |
| 1 | 16 | 35 | sentence | Sie zappelte |
| 2 | 36 | 61 | sentence | So viele Male |
| 3 | 62 | 69 | sentence | Jeden Moment |
| 4 | 71 | 79 | sentence | Ich sah |
| 5 | 81 | 95 | sentence | Bei dem Gedanken |
| 6 | 96 | 108 | sentence | Mit dem Kind |
| 7 | 109 | 119 | sentence | Es war Ende Mai |
| 8 | 120 | 137 | sentence | Sie hielt |
| 9 | 138 | 145 | sentence | Vor den Augen |
| 10 | 146 | 154 | sentence | Ich bekam |
| 11 | 155 | 159 | fragment | „Sind Sie die Mutter von |
| 12 | 161 | 171 | sentence | Ich saß |
| 13 | 172 | 190 | sentence | Die Luke |
| 14 | 191 | 191 | fragment | 7 |

The lowercase cancel rule does not change this result. Gaps in word ids (70, 80, 160) are the second halves of hyphen-merged words, which keep the first half's id.

### 8.2 Contract changes (additive)

- `contract/ocr-result.schema.json`: add an optional `sentences` property (not in `required`), items with `additionalProperties: false`, required `id`, `kind` (enum), `wordIds`, `text`.
- `backend/src/readmate/pipeline/types.py`: add `OcrSentence`; `OcrResult.sentences` is `NotRequired[list[OcrSentence]]`.
- `contract/example.json`: regenerated with `UPDATE_GOLDEN=1`; it gains one `sentence` entry for `Das Vorstellungskraft war groß.`.
- **`sentences` is optional in the schema, but the new backend always emits it** (an empty list for a page with no words). A missing field therefore means an older backend.
- The frontend guard and types are not changed; the guard ignores unknown keys, so `contract.test.ts` passes on the new golden example.

## 9. Known limitations

- A continuation from the previous page that starts with a capitalised word (a noun) is not detected as `incomplete`.
- A standalone `.` or `...` box is dropped by `filter_noise` (no letter or digit), so its sentence end is lost and the sentence merges with the next one. A synthetic test documents this behaviour.
- A listed abbreviation, single letter or 1–2 digit ordinal at a real sentence end followed by an uppercase word does not end the sentence (`Äpfel, Birnen usw. Dann …`, `Er wurde 3. Dann …`); the two sentences merge.
- An unlisted abbreviation followed by an uppercase word (`Abs. Drei`) ends the sentence wrongly. Followed by a lowercase word it is handled by the cancel rule.
- Direct speech ending in `?` / `!` followed by an uppercase word (`„Kommst du?“ Er lachte.`) is two entries; this is correct German segmentation, not a bug.
- Thresholds come from one page (§5.3).
- Multi-column reading order is assumed, not verified on real data (§7).

## 10. Frontend changes for the later plan (not in this work)

- `contract.ts`: add `OcrSentence` and an optional `sentences?: OcrSentence[]` on `OcrResult`.
- Guard: validate `sentences` when present; keep accepting results without it (older backend).
- `onWordSelected`: include the tapped word's sentence entry (id, kind, text, word ids).
- Highlight by word positions returned from the word-info API.

## 11. Testing

New file `backend/tests/test_sentences.py`, built with `tests/helpers.py` (`raw_page`, `bx`) and run through `normalize → filter_noise → merge_hyphenated → segment_sentences`.

- **Book fixture:** the 15 entries of §8.1 (first id, last id, kind each); invariants of success criterion 1; schema validation.
- **Punctuation (one test each):** `.`, `!`, `?`, `…`, `...`; closing `“ » « ) ]` after the mark; `z. B.`, `z.B.`, `d.h.`, `u.a.`; each sense of the single-letter rule; a listed abbreviation; `am 3. Oktober`; `3.10.`; `1989.` ends; `:` `;` `,` do not end.
- **Lowercase cancel:** `„Kommst du?“ fragte er.` is one entry; unlisted abbreviation + lowercase; `usw.` + lowercase.
- **Boundaries:** large gap; short line + indented next line; short line alone is not a boundary; line ending in `-` is never a boundary; skewed page (linearly drifting left edges) does not produce false indents.
- **Labels:** first segment lowercase → `incomplete`; leading page number then lowercase → page number `fragment`, next `incomplete`; last full-width line without punctuation → `incomplete`; trailing page number → `fragment`; heading mid-page → `fragment`.
- **Hyphenation:** a hyphen-merged word with the sentence end on its second box ends the entry and appears once.
- **Columns:** two synthetic columns in column-by-column order give separate, correct entries.
- **Limitation:** a standalone `.` box removed by `filter_noise` merges two sentences (documents §9).
- **Empty page:** `sentences` is `[]`.
- **Contract:** `test_contract.py` regenerates and checks the golden; `npx vitest run` passes without frontend changes.
