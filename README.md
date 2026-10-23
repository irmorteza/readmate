# ReadMate

ReadMate is a progressive web app for reading German books and newspapers. You photograph a page, the app shows the photo with a tappable box over every word, and tapping a word shows its meaning **in its sentence**, including separable verbs and multi-word expressions. The meaning can be shown in 12 languages: English, Simple German, Persian, Arabic, Turkish, Ukrainian, Russian, Polish, Spanish, French, Italian and Simplified Chinese. The app UI is English.

**Status:** a personal, single-user pilot. It is deployed and used on a phone. There are no accounts; access is controlled by one shared token.

## Architecture

```
 Phone / browser
 PWA (Vite + TypeScript, hosted on AWS Amplify)
        |  HTTPS, header X-Pilot-Token
        v
 AWS Lambda (Python 3.13, arm64) behind a Function URL
        |-- POST /v1/word-info --> Anthropic API (Claude Haiku 5.5)
        |         |-- DynamoDB table: answer cache and daily call counter
        |         `-- SSM Parameter Store: Anthropic API key (SecureString)
        `-- every other path (OCR) --> Amazon Textract (DetectDocumentText)
```

OCR pipeline, in order:

1. `from_textract`: convert the Textract response to words with boxes and lines.
2. `normalize`: clean up the converted text.
3. `filter_noise`: drop boxes with no letter or digit, low confidence, or an implausible height.
4. `merge_hyphenated`: join words split by a line-end hyphen.
5. `segment_sentences`: group words into sentences, fragments and incomplete sentences, using punctuation and page layout.

Sentence segmentation is a safety-netted extra: if it fails, OCR still returns the words. Word lookups send the tapped word and its sentence to the Anthropic API; answers are validated against a JSON Schema and cached.

## Repository layout

| Folder | Contents |
|---|---|
| `backend/` | Python Lambda code (`src/readmate`: OCR pipeline, engines, word-info service), tests, local dev server |
| `frontend/` | The PWA (Vite + TypeScript) and its tests |
| `contract/` | JSON Schemas and examples for the API, and the translation language list |
| `infra/` | `template.yaml` (the app stack, AWS SAM) and `github-oidc.yaml` (bootstrap stack: OIDC provider, IAM roles, DynamoDB table) |
| `scripts/` | Smoke test, word-info quality probe, language sync, fixture tooling |
| `docs/` | Deployment guide, advisor brief, pilot results, and design specs and plans |
| `sample/` | A sample page photo |
| `.github/` | The CI/CD workflow |

## Run and test locally

Prerequisites: Python 3.13, Node.js, and on Windows PowerShell. Create the backend environment once:

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\pip install -r backend\requirements-dev.txt
```

Run the backend dev server and the frontend dev server together:

```powershell
.\run.cmd -Engine fake
```

`-Engine fake` uses a recorded OCR fixture and fake word info, so no AWS or Anthropic calls are made. Without it, `.\run.cmd` uses real Textract and the Anthropic API through your AWS credentials. The app opens at `http://localhost:5173`; enter the token the script prints (default `dev`, change it with `-Token`).

Tests:

```bash
cd backend && .venv/Scripts/python -m pytest -q
cd backend && .venv/Scripts/python -m ruff check .
cd frontend && npx vitest run
cd frontend && npx tsc --noEmit
```

Translation languages are defined in `contract/languages.json`. After editing it, run this from the repo root; it writes the backend and frontend copies and the `target` enum in the schema:

```bash
backend/.venv/Scripts/python scripts/sync_languages.py
```

Then add a case to the quality probe (`scripts/probe_word_info.py`).

## Deployment

Pushes to `main` deploy through GitHub Actions: tests, then the backend (SAM, through GitHub OIDC), then the frontend build, the Amplify upload and a smoke test. Other branches only run the tests. The bootstrap stack `infra/github-oidc.yaml` is deployed only by the owner from a laptop, never by CI or an agent. The one-time setup, the manual fallback, the word-info setup and rollback are in [docs/deploy.md](docs/deploy.md).

## Security model

- **Pilot token:** every request must carry the shared token in `X-Pilot-Token`. It is checked before the body is read, on every route.
- **Least privilege:** the Lambda execution role may call Textract, read one SSM parameter and use one DynamoDB table. The CI deploy role has no IAM write permissions and cannot change its own permissions.
- **No stored AWS keys:** CI assumes the deploy role with a short-lived GitHub OIDC token, available only to the `production` environment, which is limited to `main`. The trust policy pins the repository by immutable ids. The only GitHub secret is the pilot token. Frontend dependencies are installed and built in a job without secrets or an OIDC token. Third-party actions are pinned to commit SHAs.
- **Anthropic key:** stored only as an SSM SecureString and read by the Lambda at runtime. It is never in the repository, GitHub, CI, Lambda environment variables, logs or the frontend.
- **Cost caps:** a daily cap on model calls (default 500, answered with HTTP 429 when reached), a spend limit and prepaid credits on a dedicated Anthropic workspace, and an AWS Budgets alert at 80% of a monthly budget.
- **Privacy:** tapped words with their sentence are sent to the Anthropic API on a cache miss; no image, token or user identifier is sent. The cache stores hashes and generated answers, not sentence text. Logs contain no sentences, words, keys or tokens.

## Contracts and the additive-API rule

The API is described by JSON Schemas in [contract/](contract/): the OCR result and the word-info request and response, each with an example. Both the backend and the frontend test against them.

API changes must be additive. Installed PWAs cache old builds, so every backend version has to keep working with the previous frontend: add fields and routes, and never remove or change the meaning of existing ones in the same release.

## How the work is done

Each change goes through four stages: a design **spec**, an implementation **plan**, the **build**, and an independent **review** of the finished branch. Specs are amended rather than rewritten, and plans are kept as records. All of them are in [docs/superpowers](docs/superpowers):

- Specs: [docs/superpowers/specs](docs/superpowers/specs), for example [translation languages](docs/superpowers/specs/2026-10-22-readmate-translation-languages-design.md), [word-info API](docs/superpowers/specs/2026-10-21-readmate-word-info-design.md) and [sentence segmentation](docs/superpowers/specs/2026-10-21-readmate-sentence-segmentation-design.md).
- Plans: [docs/superpowers/plans](docs/superpowers/plans).

[docs/advisor-brief.md](docs/advisor-brief.md) summarizes the project's decisions and history.

## Note on test data

The reference page fixture `backend/tests/fixtures/book_page.textract.json` keeps the real OCR geometry of a photographed book page (boxes, lines, confidences, ids). Its text was replaced with original synthetic German text for copyright reasons; the structure (word counts per line, capitalization, sentence ends, hyphen splits, a punctuation-only noise box) is unchanged. The replacement is produced by `scripts/rewrite_book_fixture.py` from `scripts/book_fixture_text.json`.
