# ReadMate — Translation Languages Design Spec

- **Date:** 2026-10-22
- **Status:** Approved (2026-10-22), with the owner's change: the target's English name and mode are part of the cache key (§3.2, §4.4)
- **Path in repo:** `docs/superpowers/specs/2026-10-22-readmate-translation-languages-design.md`
- **Builds on:** `2026-10-21-readmate-word-info-design.md` (with its amendments and §15), `contract/word-info.schema.json`
- **Plans:** A — languages data, contract, backend, prompt `wi-3`, probe; B — frontend

## 1. Purpose

The word sheet can show a word's meaning in one of several **target languages**. Only the translation language changes; the app UI stays English and the book language stays German.

### Success criteria

1. The language list exists in one hand-edited file. Backend validation, the contract schema's `target` enum and the frontend picker all come from it. Adding a language later means one entry, one sync command, and probe cases.
2. `POST /v1/word-info` accepts every listed code as `target`. A request with `"target": "en"` gets the same fields with the same meanings as today, plus one new field. Old frontends keep working without changes.
3. The open word sheet has a language picker showing native names. Changing it re-runs the lookup for the current word. The choice persists in `localStorage`; the default is English.
4. Right-to-left targets (`fa`, `ar`) render right-to-left. German text and IPA stay left-to-right.
5. `PROMPT_VERSION` is `wi-3`. It adds the target language and fixes the two backlog issues: an expression that only repeats the separable verb, and a wrong lemma when the separable particle is tapped.
6. The probe covers every target and both backlog fixes, and prints output tokens per target.
7. `pytest`, `ruff`, `vitest` and `tsc` pass. No test calls the real API.

## 2. Scope

- **In:** `contract/languages.json` with a sync script and sync tests; request validation; response field `exampleTranslation`; prompt `wi-3`; two server-side normalizations; fake engine; golden example; probe; frontend picker, persistence, re-lookup, RTL rendering, labels; the drawer label; debug snapshot; a pointer amendment in the word-info spec.
- **Out:** a translated UI; other book languages; full-sentence translation; detecting the user's language from the browser (the default is always English); changing `max_tokens`, effort or timeouts (the probe decides whether that is needed, §9).

## 3. Languages data

### 3.1 The file

`contract/languages.json` is the only hand-edited copy:

```json
{
  "default": "en",
  "languages": [
    { "code": "en",      "english": "English",               "native": "English",           "dir": "ltr", "mode": "translate" },
    { "code": "de",      "english": "Simple German",         "native": "Einfaches Deutsch", "dir": "ltr", "mode": "explain" },
    { "code": "fa",      "english": "Persian",               "native": "فارسی",             "dir": "rtl", "mode": "translate" },
    { "code": "ar",      "english": "Arabic",                "native": "العربية",           "dir": "rtl", "mode": "translate" },
    { "code": "tr",      "english": "Turkish",               "native": "Türkçe",            "dir": "ltr", "mode": "translate" },
    { "code": "uk",      "english": "Ukrainian",             "native": "Українська",        "dir": "ltr", "mode": "translate" },
    { "code": "ru",      "english": "Russian",               "native": "Русский",           "dir": "ltr", "mode": "translate" },
    { "code": "pl",      "english": "Polish",                "native": "Polski",            "dir": "ltr", "mode": "translate" },
    { "code": "es",      "english": "Spanish",               "native": "Español",           "dir": "ltr", "mode": "translate" },
    { "code": "fr",      "english": "French",                "native": "Français",          "dir": "ltr", "mode": "translate" },
    { "code": "it",      "english": "Italian",               "native": "Italiano",          "dir": "ltr", "mode": "translate" },
    { "code": "zh-Hans", "english": "Chinese (Simplified)",  "native": "简体中文",           "dir": "ltr", "mode": "translate" }
  ]
}
```

- `code` is a BCP 47 tag. It is the API value and the HTML `lang` value.
- `english` is used in the prompt and in the sheet's labels. `native` is shown in the picker.
- `dir` is `ltr` or `rtl`.
- `mode` is `translate` or `explain`. `explain` (only `de`) means the "translation" is a short explanation in simple German (§5.3) and the sheet label says "explanation".
- The order of the list is the order in the picker. `default` must be one of the codes.

### 3.2 Generated copies and the sync script

The Lambda package contains only `backend/src`, and the Vite dev server does not serve files outside `frontend/`. Each side therefore gets a generated copy:

- `backend/src/readmate/wordinfo/languages.json`, loaded by `readmate/wordinfo/languages.py` at import (stdlib `json` only, so the OCR import path stays clean);
- `frontend/src/languages.json`, imported by `frontend/src/languages.ts`;
- the `target` enum in `contract/word-info.schema.json` (`$defs.request.properties.target.enum`).

`scripts/sync_languages.py` (stdlib only) checks the file and then writes the three targets. It checks that codes are unique and non-empty, `dir` and `mode` are allowed values, there are no extra keys, and `default` is listed. It changes nothing else in the schema file. It writes the JSON copies byte-identically and the schema with 2-space indentation and a trailing newline, the format the schema file uses today.

**Sync tests** fail with the message "run `python scripts/sync_languages.py`" when a copy is out of date:

- backend: the package copy equals `contract/languages.json`; the schema enum equals the codes in order; the script's checks reject each kind of bad entry;
- frontend: `src/languages.json` deep-equals `../../contract/languages.json`.

Adding a language is: one entry in `contract/languages.json`, run the script, add a probe case (§8), commit. No code changes.

**Changing an existing entry's `english` name or `mode` changes what the model is told.** These fields are not part of the prompt fingerprint (§5.5), because adding a language must not invalidate the whole cache. They are part of the cache key instead (§4.4). Changing one entry therefore invalidates only that language's cached answers, and adding an entry invalidates nothing. No manual version bump is needed.

## 4. API contract (additive)

### 4.1 Request

`target` accepts every code in the list. Unknown codes are still `400 BAD_REQUEST` ("unsupported target"), the same as today. Nothing else in the request changes.

### 4.2 Response

One new required field in the backend response:

| Field | Meaning |
|---|---|
| `exampleTranslation` | `exampleDe` in the target language (for `explain`, a simple-German paraphrase, §5.3). 1–200 characters. For `target: "en"` the server sets it equal to `exampleEn`. |

The meaning of the existing fields, written into the schema as `description`s:

- `translation`, `senseInContext` and `expression.meaning` are **in the target language**. For `en` this is the same as today.
- `exampleEn` stays an **English** translation of `exampleDe` for every target. It is never in another language.
- `lemma`, `phonetic`, `article`, `plural`, `exampleDe`, `separableVerb.infinitive` and `expression.text` stay German (or IPA), as today.

`additionalProperties: false` stays on the response object; `exampleTranslation` is added to `properties` and `required`. Old frontends ignore unknown keys (their guard says so), so they are unaffected.

### 4.3 Compatibility

- **Old frontend, new backend:** sends `en`, gets today's fields plus `exampleTranslation`, which it ignores.
- **New frontend, new backend:** works for every target.
- **New frontend, old backend:** `en` works, and the sheet falls back to `exampleEn` because `exampleTranslation` is missing. Any other target gets `400` and shows "Translation unavailable"; switching back to English works. This is why Plan A deploys first (§10).

### 4.4 Cache

The cache key material (word-info spec §6.1) gains the target entry's English name and mode, right after the code:

```
key = sha256( PROMPT_VERSION | model | target | target_english | target_mode | kind | wordIndex | normalized words ).hexdigest()
```

`target_english` and `target_mode` come from the languages data for the request's code, never from the request. Because `PROMPT_VERSION` is bumped, no `wi-2` answer is ever served. Each target is cached separately. Editing one entry's `english` or `mode` changes only that target's keys (§3.2). Changing the language in the sheet is a cache miss the first time, so it costs one model call and one unit of the daily cap.

## 5. Prompt `wi-3`

### 5.1 Where the target goes

The **system prompt stays fixed text** and explains the rules for every target. The **user message** carries the target in a new first line, from the languages data:

```
<target_language code="fa" mode="translate">Persian</target_language>
<kind>sentence</kind>
<tapped_index>1</tapped_index>
...
```

The name and code come from our own data, never from the request text, so this line cannot carry injected content. The fake engine reads the code from this line.

### 5.2 Model-output schema

One schema for all targets: today's eleven properties plus `exampleTranslation` (string, required). That makes 12 required properties and still 2 `anyOf`, well inside the structured-output limits (word-info spec §5.1). For `en` the model also writes `exampleTranslation`. This costs about 20 output tokens (≈ $0.00001), and the server then overwrites it with `exampleEn`. A single schema is simpler than a second schema for English.

### 5.3 New system-prompt rules

- **Target language:** write `translation`, `senseInContext`, `expression.meaning` and `exampleTranslation` in the target language from `<target_language>`. `exampleEn` is always English. `lemma`, `phonetic`, `exampleDe`, `infinitive` and `expression.text` stay German or IPA. German words quoted inside target-language text keep their German spelling.
- **Mode `explain` (simple German):** `translation` is a short explanation in simple German (A2 level, at most 10 words), not the word itself and not a word of the same family. `senseInContext` is one simple-German sentence. `expression.meaning` is a simple-German explanation. `exampleTranslation` rewrites `exampleDe` in simpler German words; **repeat `exampleDe` only if it is already as simple as it can be**.
- **Backlog fix 1, no duplicate expression:** the separable verb belongs in `separableVerb` only. Do not return an expression that consists only of the separable verb's parts, or of those parts plus the verb's objects or other arguments (for example, `jemanden jemandem vorstellen` is not an expression). Return an expression only for a fixed multi-word unit such as a collocation, idiom or prepositional pattern that has its own meaning.
- **Backlog fix 2, the particle tapped:** when the tapped word is the separable particle (for example `an.` in *Er rief … seine Schwester an.*), describe the separable verb. `lemma` is the infinitive with the particle (`anrufen`), `pos` is `verb`, `separableVerb` is filled, and `phonetic` is still the tapped word as written.
- The existing rules (untrusted data, describe exactly the tapped word, kinds, compounds, index rules, field limits) are unchanged. "English gloss" and "English sentence" in the field rules become "in the target language".

### 5.4 Server-side normalizations (`validate.py`)

Two cheap, deterministic guards back up fixes 1 and 2 when the model ignores them. Output that triggers them is still valid:

1. When both groups are present and every index of `expression.wordIndexes` is also in `separableVerb.wordIndexes`, `expression` becomes `null`. This is logged as `group_dropped group=expression reason=separable`.
2. When `separableVerb` is present, `lemma` is set to `separableVerb.infinitive`.

The prompt rule in §5.3 also covers expressions that add the verb's objects. The guard catches only the pure subset case, because a wider guard would remove real expressions such as *zur Verfügung stellen*.

Validation additionally checks `exampleTranslation` as a required string with a 200-character cap. The other caps are unchanged (characters, not tokens: a Persian or Russian `senseInContext` fits in 300 characters for one sentence). For `target: "en"` the validated `exampleTranslation` is replaced by `exampleEn`.

### 5.5 Version pin

`PROMPT_VERSION = "wi-3"`. The fingerprint material is unchanged in form (system prompt + output schema + user template), so the existing pin test catches the change. The test's expected hash is updated together with the version, which is the intended way to change it.

## 6. Backend changes

| File | Change |
|---|---|
| `wordinfo/languages.py` (new) + `languages.json` (generated) | `LANGUAGES` (tuple of frozen dataclasses), `CODES`, `DEFAULT`, `by_code(code)` |
| `wordinfo/request.py` | `TARGETS = languages.CODES`; `cache_key` adds the target's `english` and `mode` (§4.4) |
| `wordinfo/prompt.py` | `wi-3`, new rules, `exampleTranslation` in the schema, the `<target_language>` line in `USER_TEMPLATE` and `build_user_message` |
| `wordinfo/validate.py` | `exampleTranslation`, the `en` override, the two normalizations |
| `engines/fake_word_info.py` | reads the target; returns `exampleTranslation`. For `fa` and `ar` it returns short real right-to-left sample strings, and for other non-`en` targets `"[<code>] fake translation"`, so RTL can be checked locally with `run.cmd -Engine fake` |
| `contract/word-info.schema.json` | `target` enum (generated), `exampleTranslation`, descriptions |
| `contract/word-info.example.json` | regenerated with `UPDATE_GOLDEN=1` (the request stays `en`) |
| `scripts/sync_languages.py` (new), `scripts/probe_word_info.py` | §3.2, §8 |
| `docs/superpowers/specs/2026-10-21-readmate-word-info-design.md` | a short amendment at §2, §4.1 check 3 and §5.5 pointing to this spec |

No change to the handler, service, store, secrets, infrastructure, the OCR route or its contract. `service.py` already passes the request to the prompt builder and validator.

## 7. Frontend

### 7.1 Data and persistence

- `languages.ts` exports `LANGUAGES`, `DEFAULT_TARGET`, `languageFor(code)` (unknown → default) and the `TargetCode` type (`string`, checked at runtime, because JSON imports lose literal types).
- `target-language.ts` follows the `dev-mode.ts` pattern: `localStorage` key `readmate.targetLanguage`, an in-memory fallback when storage throws, and an unknown or missing value reads as `en`.
- `WordInfoRequest.target` becomes `string`. `buildLookup(event, result, target)` puts the chosen code into the request; it is `"en"` when not given.

### 7.2 Contract guard and mapping

- `isWordInfoResponse` accepts an optional `exampleTranslation`. If present it must be a string; old backends omit it.
- `WordInfo` gains `target: string` and `exampleTranslation: string`. `toWordInfo` sets `exampleTranslation = response.exampleTranslation ?? response.exampleEn`, and `target = request.target`. When it falls back to `exampleEn`, the target used for rendering that line is `en`, so the `lang` attribute stays true.
- The stub service returns `target: "en"`.

### 7.3 Word sheet

- **Picker:** a row at the top of the sheet, below the handle and above the title: the label "Translate to" and a `<select aria-label="Translation language">`. Its options show `native`, and each has `lang` and `dir` from the data. It meets the existing touch-target rule (at least 44 px high). It is set from the store whenever the sheet opens.
- **Change:** `onTargetChange(code)` saves the code and asks the result view to repeat the lookup for the current word (§7.4). The sheet shows the loading state, and focus stays on the select.
- **Labels:** the translation card label is `"<english> translation"` for `translate` (so English shows "English translation", the same text as today) and `"<english> explanation"` for `explain` ("Simple German explanation").
- **Direction and language** (attributes only, no layout change):
  - `lang` and `dir` of the target on `translation`, `senseInContext`, `expression.meaning` and the example translation line;
  - `lang="de" dir="ltr"` on the title, `exampleDe`, the lemma and noun lines, `separableVerb.infinitive`, the parts lists and `expression.text`;
  - `dir="ltr"` on the phonetic badge.
  - Wherever the CSS for those elements sets `text-align: left`, it becomes `start`, so RTL text aligns right inside an LTR card.
- **Example box:** `exampleDe`, then `exampleTranslation`. `exampleEn` is no longer shown when the target is not English.
- Everything stays `textContent` only.

### 7.4 Re-lookup

`result-view.ts` moves the per-tap body into `runLookup(event)` and keeps the last event. `onTargetChange` calls `runLookup(lastEvent)` while the sheet is open, and nothing happens when no word is selected. The existing `lookupId` guard drops an answer for the old language that arrives late. Highlights are cleared and set again as on a tap.

### 7.5 Drawer and debug snapshot

- The drawer's static row reads **"Book language: German"** (was "Target Language: German").
- The debug snapshot gains `lookup.target` (the code). The request in the snapshot already carries `target`. The format stays `readmate-debug/2`, because the change is additive. The panel shows "Target: fa (Persian)".

## 8. Probe

`scripts/probe_word_info.py`:

- Each case gains `target` (default `en`) and an optional `expect` mapping. A field set to `None` must be `null`, and a string must match exactly (for example `{"lemma": "anrufen"}`). Rows print `expect OK` or `expect FAIL field=…`, and the summary counts failures.
- **New cases:**
  - one per non-English target (11), spread over the hard sentence types: separable verb, *Angst haben*, *zur Verfügung stellen*, *sich freuen auf*, a noun with plural, and the adjective case;
  - backlog fix 1: *Sie stellte ihn ihrer Mutter vor.* tapping `stellte`, expecting `expression: None` (the existing first case gains this `expect`);
  - backlog fix 2: tapping `an.` (existing case, expecting `lemma: "anrufen"`), *Sie stellte ihn ihrer Mutter vor.* tapping `vor.` (expecting `vorstellen`), and *Der Zug kommt um acht Uhr an.* tapping `an.` (expecting `ankommen`).
  - The quality of the `de` explanation is judged by reading the row; it has no automatic check.
- **Per-target summary:** for each target, the number of calls and the median and maximum output tokens, plus the existing overall block. A row prints `translation` with `!r`, so the output is safe in any console; `main()` reconfigures stdout to UTF-8 so Persian and Chinese print on Windows PowerShell.
- About 28 cases ≈ **$0.01–0.015** per run.
- The probe tests extend `test_probe_word_info.py`: target in the payload, the expect checks, per-target grouping with cached rows excluded.

## 9. Cost estimate (Haiku 5.5, verified on platform.claude.com 2026-10-22)

Prices for prompts up to 100,000 tokens: **input $0.10 / MTok, output $0.50 / MTok** (over 100K: $0.50 / $2.50, which does not apply here). The docs give no per-language token counts. The multipliers below are estimates and **the probe's per-target token output replaces them**.

- **Input:** the `wi-3` system prompt grows by about 250 tokens, to ≈ 1,750 input tokens per call → ≈ $0.000175, the same for every target (the target line is about 15 tokens).
- **Output:** the measured `en` median is 342 tokens (wi-2). The target-language fields (translation, sense, meaning, example translation) are ≈ 70 tokens in English. For other targets they cost ≈ 70 × the script multiplier, plus ≈ 20 tokens for `exampleEn`, which is still written.

| Target group | Assumed multiplier | Output tokens / call (median est.) | Cost / call |
|---|---|---|---|
| `en` | 1× | ≈ 360 | ≈ $0.00035 |
| `de`, `es`, `fr`, `it`, `pl`, `tr` (Latin script) | 1.2–1.6× | ≈ 400–420 | ≈ $0.00038 |
| `zh-Hans` | 1.2–1.8× | ≈ 400–440 | ≈ $0.00039 |
| `ru`, `uk` (Cyrillic) | 2–3× | ≈ 450–520 | ≈ $0.00042 |
| `fa`, `ar` (Arabic script) | 2–3.5× | ≈ 450–550 | ≈ $0.00040–0.00045 |
| Worst case, any target (`max_tokens` 1500) | — | 1500 | ≈ $0.00093 |

- Pilot (≈ 900 calls/month): **≈ $0.30–0.45/month**, whichever target is used.
- At the daily cap (500/day, 15,000/month): **≈ $5.30–6.80/month** typical, worst case ≈ $14. The $10/month workspace limit still stops the worst case.
- Switching the language in the sheet costs one extra call per word and target until it is cached.
- If the probe shows any `max_tokens` stop or calls above 1,200 tokens for a non-Latin target, raising `max_tokens` (for example to 2000) is a follow-up spec amendment, not part of this work.

## 10. Rollout

1. Plan A lands and the owner pushes; CI deploys the backend. Old PWAs are unaffected. The owner runs the probe (`wi-3` means every row is a miss).
2. Plan B lands and the owner pushes. If B reaches a phone before A is deployed, English still works (§4.3).

No AWS, IAM, SSM or bootstrap change. No owner command is needed beyond the push and the probe.

## 11. Testing

**Backend (pytest, no network):**

- Languages: the loader, `by_code`, the sync tests and the script's rejection cases (§3.2).
- Request: every listed code accepted; an unknown code, a wrong-case code (`FA`) and a non-string rejected.
- Prompt: the `<target_language>` line for `en`, `fa` and `de` (name, code and mode from the data); the version and hash pin; the schema has `exampleTranslation` and still exactly 2 `anyOf`.
- Validate: `exampleTranslation` is required, non-empty and capped; for `en` it equals `exampleEn`; for `fa` it is kept; expression dropped when it is a subset of the separable verb and kept when it has an extra word; lemma set to the infinitive when `separableVerb` is present.
- Fake engine: `exampleTranslation` for each target kind; RTL samples for `fa` and `ar`.
- Cache key: it differs by target (extended with `fa`). Changing one language's `english` name, or its `mode`, changes the key for that target and leaves the keys of every other target unchanged. Adding an entry changes no existing key.
- Contract: the golden example passes the schema; a response without `exampleTranslation` fails it; the request schema accepts each code and rejects `xx`.
- Probe: §8.
- All existing tests pass. A test needs a changed assertion only where this spec changes behaviour: the prompt version and hash pin, the `target` checks in request tests, the golden example, and the fake engine's output shape.

**Frontend (Vitest + tsc):**

- Languages: the sync test; `languageFor` with an unknown code.
- Store: default `en`; save and read back; storage that throws falls back to memory; an unknown stored value reads as `en`.
- Request builder: the target passes through, default `en`.
- Guard: with and without `exampleTranslation`; a non-string `exampleTranslation` fails.
- Mapping: the fallback to `exampleEn`, which sets that line to `en`.
- Sheet: the picker lists native names in data order, with `lang` and `dir` on each option; `lang` and `dir` on the translated elements for `fa` (`rtl`) and `en`; German elements are `de` / `ltr`; the label text for `translate` and `explain`; `textContent` only.
- Result view: changing the picker re-runs the lookup with the new target and saves it; a late answer for the old target is ignored; no lookup runs without a selected word.
- Drawer: "Book language: German". Debug snapshot: `lookup.target`. Touch-target test covers the select.

## 12. Risks and limits

- Quality in each target language is unmeasured until the probe runs, and is likely weaker for low-resource pairs. Simple-German explanations may still use hard words.
- Persian and Arabic sentences that quote German words mix directions. The browser's bidi algorithm usually places them correctly; punctuation next to a quoted German word can look wrong. This is accepted for the pilot.
- The token multipliers in §9 are estimates until the probe runs.
- A new frontend against an old backend fails for non-English targets until Plan A is deployed (§4.3).
