# WortTap — Design Spec (Pilot)

- **Date:** 2026-10-17
- **Status:** Draft — awaiting owner review
- **Path in repo:** `docs/superpowers/specs/2026-10-17-wort-tap-design.md`
- **Revision:** v2 — backend changed from Node.js to Python (owner's primary language); shared contract moved to JSON Schema.

## 1. Purpose

A personal pilot of a "Google Lens–style" reader for German print. The owner photographs a page of a German book or newspaper with their phone; the app shows the photo with a tappable box over every word. Tapping a box selects that word.

What happens after a tap (e.g. an AI explanation of the word in its sentence) is **Phase 2** and out of scope here, but the selection event is designed so Phase 2 can plug in without changing Phase 1 code.

**Users:** the owner only. No accounts, no public access.

### Success criteria (Phase 1 is done when all hold)

1. On the reference photo (book page, see §9) and 10 further real photos of book/newspaper pages, manual inspection shows: every body-text word has a box covering it, boxes do not visibly drift from their words at any zoom level, and no boxes appear in empty margins.
2. A word hyphenated across a line break (e.g. `Vorstel-` / `lungskraft`) is selected as one word, `Vorstellungskraft`, from either half, and both halves highlight.
3. Photo → boxes visible in ≤ 5 s on a typical 4G connection.
4. The app installs and runs full-screen on Android (Chrome) and iPhone (Safari "Add to Home Screen").
5. Monthly AWS cost for personal use stays under $1, with an alert at $5.

## 2. Scope

**In scope:** take or choose a photo; client-side resize; OCR via Amazon Textract; word boxes over the image; zoom; tap to select (with Copy); hyphenation merge; noise filtering; error and offline states; installable PWA; deployment to AWS.

**Out of scope (Phase 1):** any action beyond selecting/copying a word; translation or AI; history/archive; accounts; live camera / real-time OCR; languages other than German; app-store publishing; multi-column reading order beyond what §6.3 needs.

## 3. Decisions

| Area | Decision | Why |
|---|---|---|
| Client | PWA (Vite + TypeScript, no UI framework, `vite-plugin-pwa`) | Installable on Android and iPhone from one codebase. Browser code must be JS/TS. Capacitor remains an escape hatch for stores/offline later. |
| Backend | One AWS Lambda in **Python** (latest Python runtime Lambda supports, python3.13 or newer), behind a **Function URL** | Owner's primary language, so they can review the pipeline logic confidently. Bursty, low-volume traffic; no servers to patch; HTTPS built in. |
| Shared contract | JSON Schema file `contract/ocr-result.schema.json` is the single source of truth; both sides test against it (§9) | Two languages means two type definitions; the schema and a golden example stop them drifting. |
| OCR | Amazon Textract `DetectDocumentText` (synchronous, image bytes) via `boto3` | Supports German print; owner prefers AWS; ~$1.50 / 1,000 pages. |
| OCR coupling | Engine behind an adapter returning our own format | Swap Textract for Google Cloud Vision (e.g. for non-Western-European languages) by adding one adapter module. |
| Host coupling | Core logic is a plain function; Lambda handler is a thin wrapper | Can move to EC2 (e.g. FastAPI) later without rewriting logic. |
| Region | `eu-central-1` (Frankfurt). If Textract is unavailable there, `eu-west-3` (Paris). | Close to owner (Germany). |
| Infra as code | AWS SAM (`infra/template.yaml`) | Small, declarative, one `sam deploy`; builds Python dependencies from `requirements.txt`. |
| Frontend hosting | AWS Amplify Hosting (any static HTTPS host works) | Stays in one ecosystem. |
| Auth | Shared secret token in an `X-Pilot-Token` header | Single-user pilot. Real auth (Cognito) only if others are ever invited. |

## 4. Architecture

```
Phone (PWA, TypeScript)              AWS
───────────────────────              ───────────────────────────────────────
capture → resize (≤2000px JPEG)
        → POST /ocr  ───────────►   Lambda Function URL (Python)
          X-Pilot-Token             handler.handler (auth, size checks, errors)
                                      └─ process_image(image_bytes, engine)
                                           ├─ engine.recognize(bytes) ──► Textract
                                           │    (adapter → RawPage)
                                           ├─ normalize
                                           ├─ filter_noise
                                           └─ merge_hyphenated   (runs after filter_noise, v3)
        ◄─────────────── JSON  ◄──── OcrResult (normalized 0–1 coords)
render <img> + % positioned boxes
tap → select word → onWordSelected (Phase 2 hook)
```

### Units and responsibilities

**Backend (`backend/src/worttap/`)** — Python package; type hints throughout; data shapes as `TypedDict`s in `pipeline/types.py`.

- `handler.py` — Lambda entry `handler(event, context)`. Decodes the base64 body, checks token (`hmac.compare_digest`) and size, picks engine from the `OCR_ENGINE` env var (`textract` | `fake`), calls `process_image`, maps errors to HTTP. No business logic.
- `core/process_image.py` — `process_image(image_bytes: bytes, engine: OcrEngine) -> OcrResult`. Runs engine then the pipeline. Pure apart from the engine call.
- `engines/base.py` — `class OcrEngine(Protocol): name: str; def recognize(self, image_bytes: bytes) -> RawPage: ...`
- `engines/textract.py` — `TextractEngine` calls `detect_document_text`; module-level `from_textract(response: dict) -> RawPage` is pure and tested on its own. The boto3 client is created once at module import (reused across warm invocations).
- `engines/fake.py` — `FakeEngine` returns `from_textract(<fixture JSON>)`. Used for local dev and tests.
- `pipeline/normalize.py`, `pipeline/hyphenation.py`, `pipeline/noise.py` — pure functions (§6).
- `backend/dev_server.py` — small `http.server`-based server wrapping `handler` for local development (port 3000, `OCR_ENGINE=fake` by default). Because the Function URL handles CORS in production, the dev server adds the same CORS headers itself for `http://localhost:5173`.

**Frontend (`frontend/src/`)**

- `capture.ts` — two buttons: "Take photo" (`<input type="file" accept="image/*" capture="environment">`) and "Choose photo" (same, without `capture`).
- `image.ts` — loads the file via `HTMLImageElement` (browsers apply EXIF orientation), draws to a canvas with long edge ≤ 2000 px, exports JPEG quality 0.85; if > 4 MB, retries at 0.7. Returns `{ blob, width, height }`. The **same resized blob** is displayed and sent to OCR, so coordinates always match.
- `contract.ts` — TypeScript types mirroring the JSON Schema, plus a runtime guard `isOcrResult(x)` used on every API response.
- `api.ts` — `postOcr(blob, token): Promise<OcrResult>`; `fetch` with 20 s `AbortController` timeout; validates with `isOcrResult`; maps HTTP/network failures to typed `AppError`s.
- `overlay.ts` — renders the image and one absolutely positioned element per box using percentages (§7).
- `selection.ts` — selection state; highlights all boxes of the selected word; emits `onWordSelected`.
- `settings.ts` — first-run token prompt; stores token in `localStorage`; "Reset token" in a settings menu.
- `main.ts` — state machine and screens (§8).

## 5. API contract

### `POST /ocr`

Request headers: `Content-Type: image/jpeg`, `X-Pilot-Token: <token>`. Body: raw JPEG bytes (the Function URL delivers them base64-encoded with `isBase64Encoded: true`).

Limits: decoded body ≤ 5 MB (client targets < 1 MB).

**200 response — `OcrResult`.** Canonical definition: `contract/ocr-result.schema.json`. Shown here in TypeScript notation for readability:

```ts
type Box = { x: number; y: number; w: number; h: number }; // 0–1, relative to image

interface OcrResult {
  version: 1;
  engine: string;               // "textract" | "fake"
  lines: { id: number; text: string; box: Box; boxIds: number[] }[];
  boxes: {                      // physical boxes drawn on screen
    id: number;
    raw: string;                // exactly as recognized, e.g. "hatte," or "Vorstel-"
    lineId: number;
    conf: number;               // 0–1
    box: Box;
    wordId: number;
  }[];
  words: {                      // logical words; what a tap selects
    id: number;
    text: string;               // cleaned, e.g. "hatte", "Vorstellungskraft"
    boxIds: number[];           // 1 box normally, 2 when hyphen-merged
    lineIds: number[];
  }[];
}
```

JSON keys are camelCase on the wire. The Python side uses snake_case internally only where it does not leak into JSON; the `TypedDict`s in `pipeline/types.py` use the wire names (`boxIds`, `lineId`, …) so serialization is a plain `json.dumps`.

`lines[].text` gives sentence context for Phase 2.

**Errors:** body `{ "error": { "code": string, "message": string } }`.

| HTTP | code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing/empty body, wrong content type, invalid base64 |
| 401 | `UNAUTHORIZED` | Missing or wrong token (constant-time compare) |
| 413 | `TOO_LARGE` | Decoded body > 5 MB, or Textract `DocumentTooLargeException` |
| 422 | `UNREADABLE_IMAGE` | Textract `UnsupportedDocumentException` / `BadDocumentException` / `InvalidParameterException` |
| 429 | `BUSY` | Textract `ThrottlingException` / `ProvisionedThroughputExceededException` |
| 502 | `OCR_FAILED` | Any other `botocore` `ClientError` or connection error |
| 500 | `INTERNAL` | Unexpected error |

Textract exceptions are identified via `ClientError.response["Error"]["Code"]`. `OPTIONS` preflight is answered by the Function URL CORS configuration, not by our code.

## 6. Processing pipeline

### 6.1 Adapter: `from_textract(response) -> RawPage`

```python
class RawWord(TypedDict):  text: str; conf: float; box: Box
class RawLine(TypedDict):  text: str; conf: float; box: Box; words: list[RawWord]
class RawPage(TypedDict):  lines: list[RawLine]
```

Use `LINE` blocks in the order returned; resolve each line's `WORD` children through its `CHILD` relationship ids (build an id → block dict first). Map `Geometry.BoundingBox {Left, Top, Width, Height}` to `{x, y, w, h}`; `Confidence / 100` to `conf`. Ignore all other block types.

### 6.2 `normalize(raw) -> OcrResult`

Assign ids; one `box` and one `word` per recognized word. `word.text` = `raw` with leading/trailing punctuation stripped (`, . ; : ! ? » « „ “ ” " ' ( ) [ ]` and typographic quotes) using `str.strip` with an explicit character set. Inner hyphens and apostrophes stay.

### 6.3 `merge_hyphenated(result) -> OcrResult`

*Stage order (v3, after backend review): the pipeline runs `normalize` → `filter_noise` → `merge_hyphenated`, so noise specks cannot become the continuation or block a merge. Added rules: no merge if the continuation (cleaned, lower-cased) is one of `und, oder, bis, sowie, bzw, wie, als` (suspended hyphen: "Vor- und Nachteile"); no merge if the continuation box starts further than one line height from its line's left edge (the line's real first box was filtered out). Textract box geometry is clamped to 0–1.*

For each line L whose **last** box raw text matches `re.compile(r"[^\W\d_]-$")` (a Unicode letter followed by ASCII hyphen; en/em dashes and a lone `-` never qualify):

1. **Find the next line N**: among lines whose top is below L's top, choose the nearest one that (a) overlaps L horizontally by ≥ 50 % of the narrower line's width and (b) has a vertical gap to L of < 1.5 × L's height. This keeps newspaper columns separate. If none, stop.
2. Take N's **first** box F.
3. Join: if F's raw text starts with a lowercase letter (`F[0].islower()`) → stem without hyphen + F (`Vorstel-` + `lungskraft` → `Vorstellungskraft`). If it starts with an uppercase letter → keep the hyphen (`Max-` + `Planck` → `Max-Planck`).
4. Replace the two words with one word whose `boxIds` = both boxes and `lineIds` = both lines; point both boxes' `wordId` at it; clean its text per §6.2.

Functions return new structures; they do not mutate their input.

### 6.4 `filter_noise(result) -> OcrResult`

Drop a box (and its word, if the word has no remaining boxes) when **any** holds:

- `raw` contains no letter or digit (`not any(c.isalnum() for c in raw)`): `©`, `|`, `;`, `“`.
- `conf < MIN_CONF` (start `0.40`).
- Box height is < 0.4 × or > 2.5 × the median box height of the page (`statistics.median`) — margin specks, shadows.

Constants live at the top of `pipeline/noise.py` and are tuned against fixtures (§9). Remove emptied lines.

## 7. Overlay and interaction

- Container `position: relative`; image `width: 100%`. Each box is an absolutely positioned element with `left/top/width/height` = `x/y/w/h × 100%`. Boxes therefore track the image at any size with no JS recalculation.
- Each box's tappable area is padded by 2 px on every side (via a transparent border) for easier hits; visible highlight uses the exact box.
- **Zoom:** body text is small on a phone, so the image area has a zoom control (Fit / 2× / 3×). Zoom changes the container width; the wrapper scrolls in both directions. No pinch-zoom library in Phase 1.
- Default state: boxes invisible (faint outline toggle in the toolbar for debugging). Selected word: all its boxes get a solid translucent highlight.
- Tap → `selection.select(wordId)` → bottom sheet shows the word text and a **Copy** button (`navigator.clipboard.writeText`). Tapping elsewhere clears.
- **Phase 2 hook:** `onWordSelected({ word, boxes, lineTexts })` — Phase 1 subscriber only opens the bottom sheet.

## 8. Screens, states and errors (frontend)

State machine: `needsToken → idle → resizing → uploading → result | error`.

- **needsToken:** paste token, Save. Stored in `localStorage` under `worttap.token`.
- **idle:** "Take photo" / "Choose photo". On iOS Safari when not installed (`!navigator.standalone`), show a dismissible hint: Share → "Add to Home Screen".
- **resizing / uploading:** image preview + spinner "Reading text…".
- **result:** overlay screen (§7) + "New photo" button. If `words` is empty: "No text found — try more light and hold the phone parallel to the page."
- **error:** message per cause, with "Try again" (re-sends the same blob) and "New photo":
  - offline (`navigator.onLine === false` before sending, or `fetch` network failure) → "No internet connection. Scanning needs internet."
  - 401 → "Token rejected" + button to re-enter token.
  - 413 / 422 → "Couldn't read this image. Try another photo."
  - 429 → "Service busy, try again in a moment."
  - timeout / 5xx / response failing `isOcrResult` → "Something went wrong. Try again."

All UI text is English.

## 9. Testing

**Reference fixture:** `scripts/capture_fixture.py <image> <name>` sends a photo to Textract once (using the developer's local AWS credentials) and saves the raw response to `backend/tests/fixtures/<name>.textract.json`. First fixture: the book-page photo used during brainstorming (German literary text, justified, hyphenated line ends: `an-/gehaltenem`, `auf-/zufangen`, `De-/tails`, `Vorstel-/lungskraft`; uneven lighting on the left). Add one newspaper fixture (multi-column) once photographed.

**Backend unit tests (pytest):**
- `from_textract`: line/word mapping, ordering, coordinate conversion — against the fixture.
- `merge_hyphenated`: lowercase continuation merges; uppercase continuation keeps hyphen; last line has no next line; en dash and lone `-` are ignored; two side-by-side columns don't merge across columns; both boxes point at the merged word; input is not mutated. Build small synthetic results for edge cases.
- `filter_noise`: punctuation-only, low-confidence and outlier-height boxes removed; digits kept; emptied lines removed.
- `process_image` with `FakeEngine` against the fixture: all four reference hyphen pairs merge to full words. (If Textract misreads one half in the fixture, record it in the test as a known engine error rather than weakening the merge rule.)
- `handler`: missing/wrong token → 401; empty body → 400; > 5 MB → 413; each Textract error code maps per §5 (use `botocore.stub.Stubber` on the module's client); success returns `version: 1`.

**Contract tests (both sides):**
- Backend: `process_image(FakeEngine)` output validates against `contract/ocr-result.schema.json` (`jsonschema` dev dependency), and is compared with the committed golden file `contract/example.json`; the test fails on any difference, so contract changes are deliberate. Running with `UPDATE_GOLDEN=1` rewrites the golden file instead of comparing.
- Frontend: a Vitest test loads `contract/example.json` and asserts `isOcrResult` accepts it, and that `isOcrResult` rejects copies with a missing field or wrong type.

**Frontend unit tests (Vitest):** resize dimension math; box → CSS percentage mapping; error mapping in `api.ts`; selection highlights every box of a merged word.

**Manual device checklist** (record results in `docs/pilot-results.md`):
1. Android Chrome: install prompt, launches standalone.
2. iPhone Safari: Add to Home Screen, launches standalone.
3. Camera and gallery both work on both phones.
4. A photo taken in portrait and one in landscape both display upright with aligned boxes.
5. Airplane mode → offline message; wrong token → token prompt.
6. Success criteria 1–3 (§1) on the reference page + 10 real pages.

For capture testing from the phone before deployment, run the Vite dev server with `--host` and open it over the LAN; file-input capture works over plain HTTP. Installing as a PWA needs HTTPS and is tested on the deployed site.

## 10. Infrastructure (`infra/template.yaml`, AWS SAM)

- **Function:** Python runtime (python3.13 or newer), arm64, 512 MB, timeout 15 s, `Handler: worttap.handler.handler`, `CodeUri: ../backend/src`, dependencies from `backend/requirements.txt` (pin `boto3` explicitly rather than relying on the runtime's bundled copy).
- **Function URL:** `AuthType: NONE`; CORS `AllowOrigins` = `[FrontendOrigin, "http://localhost:5173"]`, `AllowMethods: [POST]`, `AllowHeaders: [content-type, x-pilot-token]`, `MaxAge: 600`.
- **IAM:** execution role with only `textract:DetectDocumentText` plus basic logging.
- **Concurrency:** `ReservedConcurrentExecutions: 2`. *Caveat:* new accounts can have an account-wide concurrency limit too low to reserve any; if `sam deploy` fails on this, remove the setting and rely on the token + budget alarm.
- **Logs:** explicit log group, 14-day retention. Log (with the standard `logging` module) request id, duration, box/word counts and error codes; **never** log image bytes or the token.
- **Budget:** `AWS::Budgets::Budget`, monthly $5 cost limit, email alert at 80 % and 100 %.
- **Parameters:** `PilotToken` (`NoEcho`), `FrontendOrigin`, `AlertEmail`, `OcrEngine` (default `textract`).
- **Outputs:** Function URL.

### Deployment order

1. `sam build && sam deploy --guided` with a temporary `FrontendOrigin` (e.g. `http://localhost:5173`); note the Function URL.
2. Deploy the frontend to Amplify Hosting with `VITE_API_URL` = Function URL; note the site URL.
3. Re-deploy SAM with `FrontendOrigin` = site URL.
4. Open the site on the phone, enter the token, install.

Token generation: `python -c "import secrets; print(secrets.token_hex(32))"`.

## 11. PWA details

- `vite-plugin-pwa` with `registerType: "autoUpdate"`.
- Manifest: `name: "WortTap"`, `short_name: "WortTap"`, `display: "standalone"`, `start_url: "/"`, `theme_color`/`background_color` set, icons 192 and 512 px plus a 512 maskable icon. `apple-touch-icon` 180 px and `apple-mobile-web-app-capable` meta for iOS.
- Service worker precaches the app shell only. Requests to the API URL are **never** cached (`NetworkOnly`).

## 12. Repository layout

```
wort-tap/
  docs/superpowers/specs/2026-10-17-wort-tap-design.md
  docs/pilot-results.md
  contract/
    ocr-result.schema.json      # single source of truth for the API shape
    example.json                # golden file generated by backend tests
  backend/
    requirements.txt            # boto3 (pinned)
    requirements-dev.txt        # pytest, jsonschema, ruff
    dev_server.py
    src/worttap/
      __init__.py
      handler.py
      core/process_image.py
      engines/{base,textract,fake}.py
      pipeline/{types,normalize,hyphenation,noise}.py
    tests/
      fixtures/*.textract.json
      test_*.py
  frontend/
    index.html
    src/{main,capture,image,contract,api,overlay,selection,settings}.ts
    src/styles.css
    public/icons/*
  infra/template.yaml
  scripts/capture_fixture.py
```

Local setup: a virtual environment in `backend/.venv` (`python -m venv .venv`, then install both requirements files); `ruff` for lint/format; `pytest` from `backend/`.

## 13. Phase 2 readiness (not built now)

- The selection event already carries the word and its line texts.
- A future `POST /explain` (same Function URL with path routing, or a second function) can call Amazon Bedrock through `boto3` with `{ word, context }`. Nothing in Phase 1 needs to change except subscribing to `onWordSelected` and extending the contract schema.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Textract quality on curved, unevenly lit book photos is unverified | First task after AWS setup: run the reference photo through `capture_fixture.py` and inspect before building UI. If poor, the adapter lets us try Cloud Vision. |
| Hyphen heuristic mis-merges in multi-column layouts | Column-overlap rule (§6.3) + newspaper fixture test. |
| Frontend and backend contract drift (two languages) | JSON Schema + golden `example.json` tested on both sides (§9). |
| Words too small to tap | Zoom levels + padded hit area (§7). |
| Public Function URL abused | Token, reserved concurrency, $5 budget alert. |
| Token visible to anyone with the phone | Acceptable for a personal pilot; Cognito if users are added. |