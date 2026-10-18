# ReadMate CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual Windows deploy with a GitHub Actions pipeline: every push runs all tests; every green push to `main` deploys backend, then frontend, then smoke-tests both, using GitHub OIDC and no stored AWS keys.

**Architecture:** One workflow with four sequential jobs (`test → deploy-backend → deploy-frontend → smoke-test`). A one-time CloudFormation bootstrap stack creates the GitHub OIDC provider and a least-privilege role trusted only by the `production` environment (which is restricted to `main`). Pipeline safety properties (trust subject, no wildcards, pinned actions, token handling) are pinned by pytest guard tests that parse the YAML; the smoke checks are a stdlib-only Python script with its own tests.

**Tech Stack:** GitHub Actions, AWS SAM / CloudFormation, AWS CLI v2, Python 3.13 (pytest, PyYAML), Node 24 / Vitest, cfn-lint, actionlint.

**Spec:** `docs/superpowers/specs/2026-10-18-readmate-cicd-design.md` (§n below refers to it)

## Global Constraints

- Python **3.13**, Node **24** in CI. Region `eu-central-1`; stack `readmate`; bootstrap stack `readmate-github-oidc`; role name `github-deploy-readmate` (deliberately outside the `readmate-` prefix, see correction 3); `MaxSessionDuration` 3600.
- GitHub environment `production` (branch rule `main` only). **Only secret: `PILOT_TOKEN`** (environment secret). Environment variables: `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, `STACK_NAME`, `AMPLIFY_APP_ID`, `AMPLIFY_BRANCH`, `FRONTEND_ORIGIN` (no trailing slash), `ALERT_EMAIL`, `OCR_EXECUTION_ROLE_ARN` (the `OcrExecutionRoleArn` bootstrap output). No repository-level secrets; no AWS access keys anywhere in GitHub.
- Role trust: `token.actions.githubusercontent.com:aud = sts.amazonaws.com` and `token.actions.githubusercontent.com:sub = repo:<owner>/<repo>:environment:production` (both `StringEquals`).
- CI has **no IAM write actions**: the only IAM permission is `iam:PassRole` on the bootstrap-created `OcrExecutionRole` (condition `iam:PassedToService = lambda.amazonaws.com`). The Lambda execution role is created by the bootstrap stack and passed to the app stack as parameter `ExecutionRoleArn`.
- Never `"Action": "*"`, never `AdministratorAccess`; `"Resource": "*"` only for `cloudformation:ValidateTemplate` and `logs:DescribeLogGroups`.
- Workflow: triggers `push` (all branches) + `workflow_dispatch`; top-level `permissions: contents: read`; only deploy jobs add `id-token: write`; `test` concurrency `test-${{ github.ref }}` with `cancel-in-progress: true`; deploy jobs concurrency group `deploy-production` with `cancel-in-progress: false`; `SAM_CLI_TELEMETRY: 0` on all jobs; every third-party action pinned to a full 40-hex commit SHA with the version in a trailing comment; `.github/dependabot.yml` updates `github-actions` weekly.
- `sam deploy` arguments, all explicit: `--stack-name $STACK_NAME --region $AWS_REGION --resolve-s3 --capabilities CAPABILITY_IAM --no-confirm-changeset --no-fail-on-empty-changeset --parameter-overrides PilotToken=… FrontendOrigin=… AlertEmail=… OcrEngine=textract ExecutionRoleArn=…` (`ExecutionRoleArn` comes from `vars.OCR_EXECUTION_ROLE_ARN`). The token reaches the step only through `env:`, never inside a `run:` string, never echoed, no `set -x`.
- Frontend zip is built on Linux with `cd dist && zip -r ../site.zip .`; Amplify polling every 10 s for up to 5 min; smoke token is `smoke-test-invalid` and must get HTTP 401.
- **Spec corrections decided here (the plan wins over the spec on these):**
  1. §6.2 says install `backend/requirements.txt`; that file moved to `backend/src/requirements.txt`. CI installs `backend/requirements-dev.txt`, which includes it via `-r src/requirements.txt`.
  2. §6.5 says `smoke-test` has no AWS credentials but reads `FRONTEND_ORIGIN`; environment variables are only visible to jobs that name the environment. `smoke-test` therefore declares `environment: production` but gets **no** `id-token` permission and no credentials step.
  3. Security review of Task 5 (Opus 5.5): with the spec's §4.3 IAM rows the deploy role matched its own `readmate-*` role pattern (it could rewrite itself) and `CreateRole`/`PutRolePolicy` on app roles were admin-equivalent. Decided with the owner: role renamed `github-deploy-readmate`; Lambda execution role `readmate-ocr-execution` moved into the bootstrap stack; `infra/template.yaml` takes `ExecutionRoleArn` and has no `Policies`; the IAM rows of §4.3 are replaced by one `iam:PassRole`; budget access narrowed to `budget/<AppStackName>-*`; extra read-only `lambda:Get*` and `logs:ListTags*` actions added. Rollout therefore needs one switch-over deploy from the laptop (bootstrap first, then the app stack with `ExecutionRoleArn`), which replaces the old auto-generated role.
- **Manual / owner-only steps (an executor must not perform them):** deploying the bootstrap stack, creating the GitHub repository/environment, pushing to GitHub, running the pipeline tests (§10). Task 1 uses read-only AWS calls only.

## Review Focus

1. A wrong token together with an empty, malformed or wrong-content-type body must give 401, never 400 (auth before validation). — Task 2
2. Smoke script must fail loudly (non-zero exit, readable message), never crash or pass, when the backend/frontend is unreachable, returns the wrong status, or the origin/URL arrives with or without a trailing slash. — Task 4
3. The frontend can be built against a stale backend URL or without the commit SHA (the exact failure seen in the manual rename redeploy): both must fail the smoke check. — Task 4
4. A job that can read `vars.*` but cannot get AWS credentials (`smoke-test`), and a feature-branch `workflow_dispatch` that must not reach AWS: only `deploy-*` jobs carry `id-token: write` and the main `if`. — Task 6
5. The PILOT_TOKEN leaking into logs/command lines, and a no-op push failing on an empty changeset. — Task 6

---

## File Structure

- `infra/github-oidc.yaml` — bootstrap stack (OIDC provider, deploy role). Deployed by the owner only.
- `.github/workflows/ci-cd.yml`, `.github/dependabot.yml` — pipeline.
- `scripts/smoke_test.py` — post-deploy checks (stdlib only), invoked by the workflow.
- `frontend/src/build-info.ts` — `shortSha()`; shown in the settings menu in `main.ts`.
- `backend/tests/test_github_oidc_template.py`, `backend/tests/test_workflow.py`, `backend/tests/test_smoke_test.py` — guard and script tests (run by the `test` job).
- `docs/deploy.md`, `CLAUDE.md` (new) — operations docs and the additive-API rule.

---

### Task 1: Verify real resource names (read-only)

**Files:** none changed (findings feed Task 5).

**Interfaces:**
- Produces: confirmed patterns for the Lambda function, execution role, log group, budget and SAM bucket, as a short note in the task's commit-less report.

- [ ] **Step 1:** Run `aws cloudformation list-stack-resources --stack-name readmate --region eu-central-1 --query "StackResourceSummaries[].[LogicalResourceId,ResourceType,PhysicalResourceId]" --output table`. Expected: `OcrFunction` = `readmate-ocr`, a SAM-generated role named `readmate-OcrFunctionRole-<suffix>`, log group `/aws/lambda/readmate-ocr`, budget `readmate-monthly`, plus the function-URL resources.
- [ ] **Step 2:** Run `aws cloudformation describe-stacks --stack-name aws-sam-cli-managed-default --region eu-central-1 --query "Stacks[0].Outputs"` and record the SourceBucket name.
- [ ] **Step 3:** If any physical name does not match `readmate-*` (or `/aws/lambda/readmate-*`), record the real pattern; Task 5 uses it instead of the spec's assumption. If every name matches, record "patterns confirmed".

---

### Task 2: Auth before body validation, pinned by tests

**Files:**
- Modify: `backend/tests/test_handler.py`
- Modify (only if a test fails): `backend/src/readmate/handler.py`

**Interfaces:**
- Consumes: `make_event(body, token, content_type, b64)` and `call(event) -> (status, body)` already in `test_handler.py`.

- [ ] **Step 1: Write the tests** in `test_handler.py`: `test_wrong_token_with_empty_body_is_401`, `test_wrong_token_with_invalid_base64_is_401`, `test_wrong_token_with_wrong_content_type_is_401`, `test_wrong_token_with_oversized_body_is_401`, `test_missing_token_with_none_body_is_401`. Each asserts `status == 401` and `body["error"]["code"] == "UNAUTHORIZED"`.
- [ ] **Step 2: Run** `cd backend && .venv/Scripts/python.exe -m pytest tests/test_handler.py -q`. Expected: **PASS** (the handler already authorizes first; these pin it).
- [ ] **Step 3: Prove the tests can fail:** temporarily move the `_decode_body(...)` call above `_authorize(...)` in `handler.py`, run the five tests, expect FAIL; revert the edit.
- [ ] **Step 4: Run the full backend suite** (`pytest -q`), expect all green. Commit `test: pin auth-before-validation in handler`.

---

### Task 3: Build commit shown in the app

**Files:**
- Create: `frontend/src/build-info.ts`, `frontend/src/build-info.test.ts`
- Modify: `frontend/src/main.ts` (the `settingsMenu()` function)

**Interfaces:**
- Produces: `shortSha(raw: string | undefined): string` — first 7 characters of `raw`; `"dev"` when `raw` is `undefined`, empty or whitespace. `BUILD_SHA: string = shortSha(import.meta.env.VITE_BUILD_SHA)`.

- [ ] **Step 1: Write failing tests** in `build-info.test.ts`: `shortSha(undefined) === "dev"`, `shortSha("") === "dev"`, `shortSha("  ") === "dev"`, `shortSha("0123456789abcdef0123") === "0123456"`, `shortSha("dev") === "dev"`, `shortSha("abc") === "abc"`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/build-info.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `shortSha` and `BUILD_SHA` in `build-info.ts`.
- [ ] **Step 4: Run** the same test → PASS.
- [ ] **Step 5: Show it:** in `settingsMenu()` append `h("p", { class: "version", textContent: \`Version ${BUILD_SHA}\` })` inside the `details` element.
- [ ] **Step 6: Verify the value is embedded:** `VITE_BUILD_SHA=abcdef0123456789 npx vite build`, then `grep -rl abcdef0123456789 dist/assets` lists a JS file; run `npx tsc --noEmit` and the full `npx vitest run` (all green). Commit `feat: show build commit in settings`.

---

### Task 4: Smoke-test script

**Files:**
- Create: `scripts/smoke_test.py`, `backend/tests/test_smoke_test.py`

**Interfaces:**
- Produces: `run_checks(api_url: str, frontend_origin: str, sha: str, timeout: float = 15.0) -> list[str]` returning human-readable failure messages (empty list = all passed); `main(argv: list[str] | None = None) -> int` with CLI `--api-url --frontend-origin --sha`, printing each failure to stderr and returning 1, else printing `smoke test passed` and returning 0. Stdlib only (`urllib`), so the runner needs no install.
- Checks (§6.5): (1) `POST {api_url}ocr` with header `X-Pilot-Token: smoke-test-invalid` and body `b"smoke"`, `Content-Type: image/jpeg` → HTTP 401; (2) `GET {origin}/` → 200 and body contains `<title>ReadMate`; first `/assets/*.js` found in the HTML → 200, contains `urlparse(api_url).netloc`, and contains `sha[:7]`.

- [ ] **Step 1: Write failing tests** in `test_smoke_test.py` using two local `ThreadingHTTPServer`s on port 0 (fake backend, fake frontend) with configurable behavior: `test_all_checks_pass_returns_no_failures`; `test_backend_not_401_is_reported` (backend answers 200); `test_backend_unreachable_is_reported_not_raised`; `test_wrong_title_is_reported`; `test_missing_asset_link_is_reported`; `test_asset_404_is_reported`; `test_stale_backend_url_in_bundle_is_reported` (JS lacks the api host); `test_missing_sha_in_bundle_is_reported`; `test_trailing_slash_variants_are_tolerated` (`api_url` with/without `/`, origin with `/`); `test_main_returns_1_and_prints_failures_to_stderr` and `test_main_returns_0_when_ok` (use `capsys`). Import with `sys.path` pointing at `scripts/` (add `pythonpath` entry `".."` handling or `sys.path.insert` at the top of the test).
- [ ] **Step 2: Run** `pytest tests/test_smoke_test.py -q` → FAIL (module missing).
- [ ] **Step 3: Implement** `run_checks` and `main`; a failed check must never raise (catch `urllib.error.URLError`/`HTTPError`/`OSError`/timeouts and turn them into messages).
- [ ] **Step 4: Run** the file → PASS; full backend suite green, `ruff check .` clean. Commit `feat: post-deploy smoke test script`.

---

### Task 5: Bootstrap template `infra/github-oidc.yaml` + guard tests

**Files:**
- Create: `infra/github-oidc.yaml`, `backend/tests/test_github_oidc_template.py`
- Modify: `backend/requirements-dev.txt` (add `pyyaml`)

**Interfaces:**
- Consumes: Task 1's confirmed name patterns and bucket name.
- Produces: parameters `GitHubOwner`, `GitHubRepo`, `AppStackName` (default `readmate`), `AmplifyAppId`, `AmplifyBranch` (default `staging`), `SamBucketName`, `CreateOidcProvider` (`true`|`false`); condition `CreateProvider`; resources `GitHubOidcProvider` (conditional), `OcrExecutionRole` (`${AppStackName}-ocr-execution`) and `DeployRole` (`RoleName: github-deploy-readmate`); outputs `DeployRoleArn`, `OcrExecutionRoleArn`. `infra/template.yaml` gains parameter `ExecutionRoleArn`.
- Test helper: `load_template() -> dict` in the test file, loading with a `yaml.SafeLoader` subclass whose multi-constructor for `!` tags returns the plain scalar/list/dict (so `!Sub "x"` becomes `"x"`).

- [ ] **Step 1: Write failing tests**: `test_trust_subject_is_production_environment_only` (`StringEquals` `…:sub` equals exactly `repo:${GitHubOwner}/${GitHubRepo}:environment:production`; no `StringLike` anywhere in the trust policy), `test_trust_audience_is_sts_amazonaws_com`, `test_trust_action_is_assume_role_with_web_identity`, `test_max_session_duration_is_3600`, `test_no_wildcard_actions_and_no_managed_policies` (no action equal to `*` or ending in `:*`; no `ManagedPolicyArns`), `test_wildcard_resource_only_for_validate_template_and_describe_log_groups`, `test_passrole_limited_to_lambda_service` (`iam:PassedToService` = `lambda.amazonaws.com`), `test_oidc_provider_is_conditional_on_create_parameter`, `test_role_name_and_output`.
- [ ] **Step 2: Run** `pytest tests/test_github_oidc_template.py -q` → FAIL (file missing).
- [ ] **Step 3: Write the template** per §4.1–4.3: provider for `https://token.actions.githubusercontent.com` with client id `sts.amazonaws.com`, **no** `ThumbprintList`; role with the §4.3 permission table, resources built from `AppStackName`, `AWS::Region`, `AWS::AccountId` and `SamBucketName` (adjusted to Task 1's real names). If `AWS::IAM::OIDCProvider` rejects the omission of `ThumbprintList` in cfn-lint, stop and report to the owner instead of inventing a value.
- [ ] **Step 4: Run** the tests → PASS, then lint: `/c/Users/Morteza/AppData/Local/Temp/cfnv/Scripts/cfn-lint.exe infra/github-oidc.yaml infra/template.yaml` → exit 0.
- [ ] **Step 5: Commit** `feat: GitHub OIDC bootstrap template with guard tests`. (Do not deploy it.)

---

### Task 6: Workflow, Dependabot and guard tests

**Files:**
- Create: `.github/workflows/ci-cd.yml`, `.github/dependabot.yml`, `backend/tests/test_workflow.py`

**Interfaces:**
- Consumes: Task 3's `VITE_BUILD_SHA`; Task 4's `python scripts/smoke_test.py --api-url … --frontend-origin … --sha …`; the variable/secret names from Global Constraints.
- Produces: jobs `test`, `deploy-backend` (output `api_url`), `deploy-frontend`, `smoke-test`.

- [ ] **Step 1: Resolve action SHAs.** For each of `actions/checkout`, `actions/setup-python`, `actions/setup-node`, `aws-actions/configure-aws-credentials`, `aws-actions/setup-sam`, take the latest release tag and run `git ls-remote https://github.com/<org>/<repo> "refs/tags/<tag>" "refs/tags/<tag>^{}"` (use the `^{}` line when present); record the 40-hex SHA. Never write a SHA you did not resolve. Resolve the latest PyPI versions of `cfn-lint` and `actionlint-py` (`pip index versions …`) to pin in the `test` job.
- [ ] **Step 2: Write failing tests** in `test_workflow.py` (PyYAML parses the `on:` key as `True`; read it with `workflow.get(True)`): `test_top_level_permissions_are_contents_read_only`; `test_only_deploy_jobs_request_id_token` (`deploy-backend` and `deploy-frontend` have `id-token: write`; `test` and `smoke-test` do not); `test_deploy_jobs_run_only_on_main_in_production_environment` (both have `if: github.ref == 'refs/heads/main'` and `environment: production`); `test_job_order` (`needs` chains: `deploy-backend`←`test`, `deploy-frontend`←`deploy-backend`, `smoke-test`←both); `test_smoke_test_reads_environment_but_has_no_aws_credentials_step`; `test_all_actions_pinned_to_full_sha_with_version_comment` (every `uses:` matches `@[0-9a-f]{40}` and its raw line ends with `# v…`); `test_no_long_lived_aws_keys` (raw text has no `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `secrets.AWS`); `test_pilot_token_only_via_env` (`secrets.PILOT_TOKEN` appears only under an `env:` mapping, never in a `run:` string; no `set -x`); `test_sam_deploy_has_all_explicit_flags` (every flag in Global Constraints present in the `run:` text of `deploy-backend`); `test_concurrency_groups` (test: group `test-${{ github.ref }}`, cancel true; deploy jobs: `deploy-production`, cancel false); `test_sam_telemetry_disabled`; `test_workflow_dispatch_trigger_present`; and in the same file `test_dependabot_updates_github_actions_weekly`.
- [ ] **Step 3: Run** `pytest tests/test_workflow.py -q` → FAIL (files missing).
- [ ] **Step 4: Write `ci-cd.yml`** per §6.1–6.5 (plus Spec corrections above):
  - `test`: checkout; Python 3.13 with pip cache; `pip install -r backend/requirements-dev.txt cfn-lint==<pinned> actionlint-py==<pinned>`; `ruff check` and `pytest` in `backend/`; Node 24 with npm cache; `npm ci`, `npx vitest run`, `npx tsc --noEmit` in `frontend/`; `actionlint`; `cfn-lint infra/template.yaml infra/github-oidc.yaml`.
  - `deploy-backend`: credentials via `role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}`; `setup-sam`; `sam build -t infra/template.yaml`; `sam deploy` with the explicit flags (`PILOT_TOKEN` from `env:`, other values from `vars.*`); read `FunctionUrl` with `aws cloudformation describe-stacks --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text`, fail if empty, write to `$GITHUB_OUTPUT` as `api_url`.
  - `deploy-frontend`: `npm ci`; build with `VITE_API_URL=${{ needs.deploy-backend.outputs.api_url }}` and `VITE_BUILD_SHA=${{ github.sha }}`; zip; assert `unzip -Z1 site.zip` contains `index.html` at the root and no backslash; credentials; `aws amplify create-deployment` (parse `jobId`, `zipUploadUrl` with `jq`); `curl --fail -T site.zip`; `aws amplify start-deployment`; poll `aws amplify get-job` every 10 s up to 5 min (`SUCCEED` pass; `FAILED`/`CANCELLED`/timeout fail).
  - `smoke-test`: `environment: production`, `permissions: contents: read`; checkout; Python; fail early if `FRONTEND_ORIGIN` or `api_url` is empty (`: "${VAR:?message}"`); `python scripts/smoke_test.py --api-url "$API_URL" --frontend-origin "$FRONTEND_ORIGIN" --sha "$GITHUB_SHA"`.
  - `dependabot.yml`: ecosystem `github-actions`, directory `/`, schedule weekly.
- [ ] **Step 5: Run** the guard tests → PASS; then `pip install actionlint-py` into a scratch venv (or the project venv) and run `actionlint .github/workflows/ci-cd.yml` → no findings.
- [ ] **Step 6: Run** the full backend suite, `ruff check .`, and commit `feat: ci-cd workflow with guard tests and dependabot`.

---

### Task 7: Deployment docs and CLAUDE.md

**Files:**
- Create: `docs/deploy.md`, `CLAUDE.md`

- [ ] **Step 1: Write `docs/deploy.md`** with the four sections from §9: how the pipeline works (job order); one-time setup (bootstrap stack command from §4 with the placeholders explained, the `production` environment from §5 with the exact variable table, and "environment branch rule = `main` only"); the manual Windows fallback with every lesson listed in §9 item 3 (separate PowerShell window, `$tok = Read-Host "Token"`, `npm.cmd`, Python `shutil.make_archive` for the zip, `Resolve-Path` for `-InFile`, all four `--parameter-overrides`, the Function-URL grep before upload, DevTools → Clear site data); rollback (`git revert <commit>` and push) and the additive-API rule.
- [ ] **Step 2: Write `CLAUDE.md`** at the repo root: project one-liner (ReadMate, Phase 1 deployed), how to run tests and the local app (`backend/.venv/Scripts/python -m pytest`, `cd frontend && npx vitest run`, `.\run.cmd`), the pointer line "Deployment: see `docs/deploy.md`", and the rule: *API changes must be additive — every backend version must keep working with the previous frontend (installed PWAs cache old builds); add fields and routes, never remove or change the meaning of existing ones in the same release.*
- [ ] **Step 3: Verify:** `grep -c "Read-Host" docs/deploy.md` ≥ 1, `grep -n "additive" CLAUDE.md docs/deploy.md` finds both, and the bootstrap command in the doc matches `infra/github-oidc.yaml`'s parameter names. Commit `docs: deployment guide and CLAUDE.md`.

---

### Task 8: Owner-driven rollout (manual; not for an executor)

- [ ] **Step 1:** Use the existing private GitHub repository `readmate` and add it as `origin` if the clone has no remote. Do **not** push yet: `.github/workflows/ci-cd.yml` must not reach GitHub before the `production` environment and its `main`-only rule exist. Name it exactly as `GitHubRepo` will be given to the bootstrap stack; the trust condition is case-sensitive.
- [ ] **Step 2:** Create the `production` environment first: deployment branches = `main` only, secret `PILOT_TOKEN`. If a `production` environment already exists, add the branch rule to it before anything else (an environment auto-created by an early workflow run has no rule).
- [ ] **Step 3:** Deploy the bootstrap stack with the §4 command (real `GitHubOwner` spelled exactly as on GitHub, SAM bucket from Task 1; `CreateOidcProvider=true`, or `false` if the account already has the GitHub provider, which must then list `sts.amazonaws.com` as a client id). Note `DeployRoleArn` and `OcrExecutionRoleArn`. Then switch the app stack over once from the laptop: `sam build` and `sam deploy` with all five parameters including `ExecutionRoleArn=<OcrExecutionRoleArn>`; CloudFormation replaces the auto-generated execution role.
- [ ] **Step 4:** Add the eight environment variables from Global Constraints to `production`, then push all branches.
- [ ] **Step 5:** Work through §10 in order: feature-branch run (only `test` runs; the deploy jobs are skipped by their `if` and never reach the environment); the same for a manual `workflow_dispatch` on the feature branch; first `main` run all green and the phone settings show the short SHA; deliberate red test, so no deploy jobs run; no-op `workflow_dispatch` on `main` succeeds with an empty changeset. Fix any `AccessDenied` by adding exactly that action to `infra/github-oidc.yaml` on the scoped resource and redeploying the bootstrap from the laptop.
