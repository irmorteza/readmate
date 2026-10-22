# ReadMate

A PWA that OCRs a photographed German page (Amazon Textract) and lets you tap any word. Phase 1 is deployed: Python Lambda behind a Function URL (`backend/`), Vite + TypeScript PWA on Amplify (`frontend/`), JSON-Schema contract in `contract/`.

## Run and test

- Backend tests: `cd backend && .venv/Scripts/python -m pytest -q` (lint: `ruff check .`)
- Frontend tests: `cd frontend && npx vitest run` and `npx tsc --noEmit`
- Run everything locally: `.\run.cmd` (real Textract) or `.\run.cmd -Engine fake`; the app needs the token printed by the script (default `dev`)
- Guard tests in `backend/tests/test_workflow.py` and `test_github_oidc_template.py` pin the pipeline's security properties; change them only deliberately.
- Translation languages: edit `contract/languages.json`, then run `backend/.venv/Scripts/python scripts/sync_languages.py` (writes the backend and frontend copies and the schema enum) and add a probe case.

## Deployment

Pushes to `main` deploy through GitHub Actions. See `docs/deploy.md` (pipeline, one-time setup, manual Windows fallback, rollback).

## Rules

- **API changes must be additive.** Every backend version must keep working with the previous frontend (installed PWAs cache old builds): add fields and routes; never remove or change the meaning of existing ones in the same release.
- Never store AWS access keys or the pilot token in the repository or in GitHub outside the `production` environment secret. The CI deploy role has no IAM write permissions; keep it that way.
- The Anthropic API key lives only in SSM Parameter Store as SecureString `/readmate/anthropic-api-key`; the Lambda reads it at runtime. Never put it in the repository, GitHub, CI, Lambda environment variables, logs or the frontend.
- Do not deploy the bootstrap stack (`infra/github-oidc.yaml`) from CI or from an agent; the owner does it from the laptop.
