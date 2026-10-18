# ReadMate — CI/CD Design Spec

- **Date:** 2026-10-18
- **Status:** Draft — awaiting owner review
- **Path in repo:** `docs/superpowers/specs/2026-10-18-readmate-cicd-design.md`
- **Builds on:** `docs/superpowers/specs/2026-10-17-wort-tap-design.md` (Phase 1, deployed and verified on phone)
- **Prerequisite done:** the project is renamed to ReadMate in every layer (commit `0aa0102`) and redeployed by hand as stack `readmate`.

## 1. Purpose

Phase 1 is deployed by hand from a Windows laptop (`sam deploy`, frontend build, zip, manual upload to Amplify). Before Phase 2 adds frequent backend and frontend changes, replace that with a GitHub Actions pipeline:

- every push to any branch runs all tests;
- every push to `main` whose tests pass deploys the backend, then the frontend, then smoke-tests both;
- no long-lived AWS keys are stored anywhere outside the owner's laptop.

**Context:** single owner, private GitHub repository `readmate`, one environment. Stack `readmate` in `eu-central-1`, deployed manually; Amplify app `readmate` (id `d2bhw8tobanmyi`), branch `staging`, created with "Deploy without Git", URL `https://staging.d2bhw8tobanmyi.amplifyapp.com`.

### Success criteria

1. A push to a non-`main` branch runs the `test` job only; all deploy jobs are skipped.
2. A push to `main` with passing tests runs `test → deploy-backend → deploy-frontend → smoke-test`, all green, with no manual step.
3. A push to `main` with a failing test deploys nothing.
4. The deployed frontend shows the commit it was built from (§6), so the owner can confirm on the phone which version is running.
5. GitHub holds no AWS access keys. The only secret is `PILOT_TOKEN`.
6. Workflows from other branches, other repositories or forks cannot obtain AWS credentials.
7. The manual laptop deploy still works as a fallback and is documented.

## 2. Scope

**In scope:** a one-time AWS bootstrap template for GitHub OIDC and a scoped deploy role; the workflow file; the GitHub `production` environment configuration (documented, done by hand); post-deploy smoke checks; showing the build commit in the app; deployment documentation including the manual fallback; Dependabot for workflow actions.

**Out of scope:** multiple environments (separate staging/production stacks), pull-request preview deployments, automatic rollback beyond what CloudFormation already does, chat/email notifications beyond GitHub's default failure emails, migrating the Amplify app to Git-connected hosting.

## 3. Decisions

| Area | Decision | Why |
|---|---|---|
| CI system | GitHub Actions | Code is already on GitHub; free private-repo minute quota covers this project. |
| AWS auth | GitHub OIDC → `sts:AssumeRoleWithWebIdentity` into one scoped IAM role | Short-lived credentials per run; nothing to leak or rotate. |
| Trust scope | Role trusts only `repo:<owner>/<repo>:environment:production` | Combined with the environment's branch rule (§5), only `main` can deploy. |
| Deploy trigger | `push` to `main` after tests pass, plus `workflow_dispatch` (manual re-run) | Solo pilot, fast feedback on the phone; unfinished work lives on other branches. |
| Frontend hosting | Keep the existing manual-deploy Amplify app; deploy via the Amplify `CreateDeployment` / `StartDeployment` API | Same URL: no CORS change, no reinstall on the phone; ordering guaranteed after backend. |
| Pipeline shape | One workflow, four sequential jobs | One page shows everything; frontend never deploys if tests or backend fail. |
| Bootstrap ownership | Bootstrap stack deployed once by the owner from the laptop; never by CI | CI must not be able to change its own permissions. |
| Config source in CI | All `sam deploy` arguments passed explicitly | `samconfig.toml` is git-ignored and absent on the runner. |

## 4. AWS bootstrap — `infra/github-oidc.yaml`

A standalone CloudFormation template, stack name `readmate-github-oidc`, deployed once by the owner:

```powershell
aws cloudformation deploy `
  --template-file infra/github-oidc.yaml `
  --stack-name readmate-github-oidc `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides GitHubOwner=<owner> GitHubRepo=readmate AppStackName=readmate `
      AmplifyAppId=d2bhw8tobanmyi AmplifyBranch=staging SamBucketName=<bucket> CreateOidcProvider=true
```

`<bucket>` is the `aws-sam-cli-managed-default-samclisourcebucket-…` name from the SAM output.

### 4.1 Parameters

`GitHubOwner`, `GitHubRepo`, `AppStackName` (default `readmate`), `AmplifyAppId`, `AmplifyBranch` (default `staging`), `SamBucketName`, `CreateOidcProvider` (`true` | `false`; an account can hold only one provider per URL, so `false` reuses an existing one and the template builds its ARN from the account id).

### 4.2 OIDC provider (conditional on `CreateOidcProvider`)

`AWS::IAM::OIDCProvider` for `https://token.actions.githubusercontent.com`, client id `sts.amazonaws.com`. Omit `ThumbprintList` (AWS no longer uses it for GitHub's provider). If the CloudFormation resource still rejects the template without it, the plan must surface that to the owner rather than invent a value.

### 4.3 Role `readmate-github-deploy`

**Trust policy:** principal = the provider; action `sts:AssumeRoleWithWebIdentity`; conditions:
- `StringEquals token.actions.githubusercontent.com:aud = sts.amazonaws.com`
- `StringEquals token.actions.githubusercontent.com:sub = repo:<owner>/<repo>:environment:production`

`MaxSessionDuration` 3600.

**Permissions (inline policy, least privilege).** Resource patterns assume SAM's default physical naming `<AppStackName>-<LogicalId>-<suffix>`. **Before writing the policy, the plan's first task verifies the real physical names** with `aws cloudformation list-stack-resources --stack-name readmate` and adjusts the patterns to match. The stack already exists and was created by the owner's IAM user; the CI role takes over updates. The actions below also cover creating the stack from scratch, so a future clean redeploy through CI works too.

| Service | Actions | Resource |
|---|---|---|
| CloudFormation | `CreateChangeSet`, `ExecuteChangeSet`, `DeleteChangeSet`, `DescribeChangeSet`, `DescribeStacks`, `DescribeStackEvents`, `DescribeStackResource(s)`, `GetTemplate`, `GetTemplateSummary`, `ListStackResources` | `stack/<AppStackName>/*` |
| CloudFormation | `DescribeStacks` | `stack/aws-sam-cli-managed-default/*` |
| CloudFormation | `CreateChangeSet` | `arn:aws:cloudformation:<region>:aws:transform/Serverless-2016-10-31` |
| CloudFormation | `ValidateTemplate` | `*` (no resource-level support) |
| S3 | `GetObject`, `PutObject`, `ListBucket`, `GetBucketLocation` | the SAM bucket and `bucket/*` |
| Lambda | create/update/get/delete function, function configuration, function URL config; `AddPermission`, `RemovePermission`, `TagResource`, `UntagResource`, `ListTags`, `PutFunctionConcurrency`, `DeleteFunctionConcurrency` | `function:<AppStackName>-*` |
| IAM | `GetRole`, `CreateRole`, `DeleteRole`, `UpdateAssumeRolePolicy`, `AttachRolePolicy`, `DetachRolePolicy`, `PutRolePolicy`, `GetRolePolicy`, `DeleteRolePolicy`, `TagRole`, `UntagRole` | `role/<AppStackName>-*` |
| IAM | `PassRole` with condition `iam:PassedToService = lambda.amazonaws.com` | `role/<AppStackName>-*` |
| CloudWatch Logs | `CreateLogGroup`, `DeleteLogGroup`, `PutRetentionPolicy`, `TagResource`, `TagLogGroup` | log groups `/aws/lambda/<AppStackName>-*` |
| CloudWatch Logs | `DescribeLogGroups` | `*` |
| Budgets | `ViewBudget`, `ModifyBudget` | `budget/*` in this account |
| Amplify | `CreateDeployment`, `StartDeployment`, `GetJob`, `GetBranch` | `apps/<AmplifyAppId>/branches/<AmplifyBranch>` and `…/jobs/*` |

**Iteration rule:** if a CI deploy fails with `AccessDenied`, add exactly the named action on the scoped resource and redeploy the bootstrap from the laptop. Never widen to `"Action": "*"`, `"Resource": "*"` beyond the rows above, or `AdministratorAccess`.

**Output:** `DeployRoleArn`.

## 5. GitHub configuration (manual, documented)

Settings → Environments → **New environment `production`**:

- **Deployment branches and tags:** "Selected branches" → `main` only.
- **Environment secret:** `PILOT_TOKEN` — the same token the phone uses.
- **Environment variables:**

| Variable | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `DeployRoleArn` output from §4 |
| `AWS_REGION` | `eu-central-1` |
| `STACK_NAME` | `readmate` |
| `AMPLIFY_APP_ID` | `d2bhw8tobanmyi` |
| `AMPLIFY_BRANCH` | `staging` |
| `FRONTEND_ORIGIN` | `https://staging.d2bhw8tobanmyi.amplifyapp.com` (no trailing slash) |
| `ALERT_EMAIL` | owner's email |

No repository-level secrets. No AWS access keys anywhere in GitHub.

## 6. Workflow — `.github/workflows/ci-cd.yml`

### 6.1 Triggers, permissions, concurrency

- `on: push` (all branches) and `workflow_dispatch`.
- Top-level `permissions: contents: read`. Only deploy jobs add `id-token: write`.
- `test` job: `concurrency: group: test-${{ github.ref }}, cancel-in-progress: true`.
- Deploy jobs share `concurrency: group: deploy-production, cancel-in-progress: false` — a second push waits, never interrupts a running deploy.
- All third-party actions pinned to a full commit SHA with the version in a trailing comment. `.github/dependabot.yml` updates the `github-actions` ecosystem weekly.
- Environment variable `SAM_CLI_TELEMETRY: 0` for all jobs.

### 6.2 Job `test` (every push)

On `ubuntu-latest`:

1. Checkout.
2. Python 3.13 (pip cache) → install `backend/requirements.txt` and `backend/requirements-dev.txt` → `ruff check` → `pytest` from `backend/`. The committed `book_page` fixture and golden contract test run here.
3. Node at the same major version the owner uses locally (24) with npm cache → `npm ci` in `frontend/` → Vitest run → `tsc --noEmit`.
4. Static checks: `actionlint` on the workflow files and `cfn-lint` on `infra/template.yaml` and `infra/github-oidc.yaml`.

### 6.3 Job `deploy-backend`

`needs: test`; `if: github.ref == 'refs/heads/main'`; `environment: production`; `permissions: id-token: write, contents: read`.

1. Checkout; Python 3.13.
2. `aws-actions/configure-aws-credentials` with `role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}`, `aws-region: ${{ vars.AWS_REGION }}`.
3. `aws-actions/setup-sam`.
4. `sam build -t infra/template.yaml`.
5. `sam deploy` with every argument explicit:
   `--stack-name $STACK_NAME --region $AWS_REGION --resolve-s3 --capabilities CAPABILITY_IAM --no-confirm-changeset --no-fail-on-empty-changeset --parameter-overrides PilotToken=… FrontendOrigin=… AlertEmail=… OcrEngine=textract`.
   The token comes from `secrets.PILOT_TOKEN` via an `env:` entry, never interpolated into a `run:` script string directly, and is never echoed.
6. Read the `FunctionUrl` output with `aws cloudformation describe-stacks --query` and expose it as job output `api_url`. Fail the job if it is empty.

### 6.4 Job `deploy-frontend`

`needs: deploy-backend`; same `if`, environment and permissions.

1. Checkout; Node 24; `npm ci` in `frontend/`.
2. Build with `VITE_API_URL=${{ needs.deploy-backend.outputs.api_url }}` and `VITE_BUILD_SHA=${{ github.sha }}`.
3. Zip on Linux: `cd dist && zip -r ../site.zip .` — entries use forward slashes and `index.html` sits at the zip root. (This avoids the Windows `Compress-Archive` backslash problem that broke the first manual upload.)
4. Configure AWS credentials as in §6.3.
5. `aws amplify create-deployment --app-id $AMPLIFY_APP_ID --branch-name $AMPLIFY_BRANCH` → `jobId`, `zipUploadUrl`.
6. `curl --fail -T site.zip "$zipUploadUrl"`.
7. `aws amplify start-deployment --app-id … --branch-name … --job-id $jobId`.
8. Poll `aws amplify get-job` every 10 s for up to 5 min. `SUCCEED` → pass; `FAILED`, `CANCELLED` or timeout → fail.

### 6.5 Job `smoke-test`

`needs: [deploy-backend, deploy-frontend]`; no AWS credentials; costs nothing.

1. **Backend auth check:** `POST ${api_url}ocr` with header `X-Pilot-Token: smoke-test-invalid` and a small non-empty body → expect HTTP **401**. This proves the Lambda is live and auth works without calling Textract.
2. **Frontend check:** `GET ${FRONTEND_ORIGIN}/` → 200 and the body contains `<title>ReadMate`. Extract the first `/assets/*.js` path from the HTML and `GET` it → 200 (catches a broken zip layout), and check that the JS contains the host of `api_url` (catches a frontend built against a stale backend URL — the exact failure seen during the manual rename redeploy).
3. **Version check:** the page or a built asset contains the first 7 characters of `github.sha` (see §7).

## 7. Small code changes

- **Auth before body validation (backend):** the handler must check the token before validating the body, so unauthenticated callers always get 401 and learn nothing about input rules. Add a test: wrong token + empty body → 401. If the current handler already behaves this way, the test pins it.
- **Build commit in the app (frontend):** `VITE_BUILD_SHA` (default `dev` for local builds) is shown as the short SHA in the settings menu and embedded in the built output. Unit-test the default.

## 8. Failure handling and rules for Phase 2

| Failure | Result |
|---|---|
| `test` fails | Nothing deploys. |
| `deploy-backend` fails | CloudFormation rolls the stack back automatically; frontend is not deployed. |
| `deploy-frontend` fails | New backend is live with the old frontend. |
| `smoke-test` fails | Both are live; the run is red so the owner investigates. |

**Rule — API changes must be additive.** Because the backend can be ahead of the frontend (row 3), and because an installed PWA may keep running a cached older frontend for a while, every backend version must keep working with the previous frontend: add fields and routes; never remove or change the meaning of existing ones in the same release. Create `CLAUDE.md` at the repo root (it does not exist yet) and record this rule there, together with a one-line pointer to `docs/deploy.md`, so future sessions follow it.

**Rollback:** `git revert <commit>` and push to `main`; the pipeline redeploys the previous state.

## 9. Documentation — `docs/deploy.md`

1. How the pipeline works (one paragraph + the job order).
2. One-time setup: deploying the bootstrap stack (§4), creating the `production` environment (§5).
3. Manual fallback from Windows, with the lessons from the manual deploys: run in a separate PowerShell window; `$tok = Read-Host "Token"`; `npm.cmd` if script execution is disabled; build the frontend zip with Python (`shutil.make_archive`), not `Compress-Archive`; `Resolve-Path` for `-InFile`; pass all four parameters to `sam deploy --parameter-overrides` because the token is not saved in `samconfig.toml`; before uploading a frontend zip, confirm the build contains the current Function URL (`Get-ChildItem dist -Recurse -File | Select-String "https://[a-z0-9]+\.lambda-url"`); after any frontend deploy, use DevTools → Application → Clear site data to drop the cached PWA.
4. Rollback and the additive-API rule.

## 10. Testing the pipeline

1. **Branch run:** push the pipeline on a feature branch → only `test` runs; deploy jobs show as skipped.
2. **Trust check:** a manual `workflow_dispatch` on that feature branch must fail to reach AWS (the `production` environment refuses non-`main` refs).
3. **First main run:** merge → all four jobs green; the phone shows the new short SHA in settings after the PWA updates.
4. **Red test:** on a branch, break one test, merge to `main` deliberately in a throwaway commit → no deploy jobs run; revert.
5. **No-op deploy:** `workflow_dispatch` on `main` with no changes → `sam deploy` succeeds with an empty changeset; frontend redeploys; smoke tests pass.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Least-privilege policy misses an action SAM or CloudFormation needs | Verify physical resource names first (§4.3); iterate one named action at a time; never fall back to admin. |
| Token leaks into logs | Passed only via `env:` from the secret; GitHub masks it; never echoed; no `set -x` in deploy steps. |
| Stale PWA on the phone hides a new deploy | Build SHA visible in settings (§7); additive-API rule (§8). |
| Supply-chain risk from third-party actions | Pinned SHAs + Dependabot. |
| SAM artifact bucket grows with every deploy | Acceptable for the pilot (cents per month); revisit with an S3 lifecycle rule if it matters. |
| Actions minutes on a private repo | Pipeline ~5–8 min per main push, well inside the free monthly quota for personal use. |
## 12. Amendments after the security review of the bootstrap template (2026-10-18)

An independent review of `infra/github-oidc.yaml` found that the §4.3 permissions let the deploy role rewrite itself (its name `readmate-github-deploy` matched `role/readmate-*`) and that `iam:CreateRole`/`PutRolePolicy` on app roles were admin-equivalent through the public function URL. Changes, which supersede §4.3 and §6.3 where they differ:

- The deploy role is named `github-deploy-readmate`.
- The Lambda execution role `readmate-ocr-execution` is created by the bootstrap stack. `infra/template.yaml` takes parameter `ExecutionRoleArn`; `sam deploy` passes it from the environment variable `OCR_EXECUTION_ROLE_ARN`.
- The deploy role has no IAM write actions; its only IAM permission is `iam:PassRole` on that one role (`iam:PassedToService = lambda.amazonaws.com`).
- Budget access is limited to `budget/<AppStackName>-*`; read-only `lambda:GetPolicy`, `GetRuntimeManagementConfig`, `GetFunctionCodeSigningConfig`, `GetFunctionRecursionConfig` and `logs:ListTagsForResource`, `ListTagsLogGroup` were added.
- A compromised CI run can therefore still replace the function code, but only with the app's own permissions (Textract and logs).

### Amendments after the final review

- §6.5: the smoke test also sends a CORS preflight (`OPTIONS {api}/ocr` with `Origin: <FRONTEND_ORIGIN>`, `Access-Control-Request-Method: POST`, `Access-Control-Request-Headers: content-type,x-pilot-token`) and requires `Access-Control-Allow-Origin` to equal the frontend origin, so a deploy that the phone's browser would block fails the run.
- §4/§8 `FrontendOrigin` has `AllowedPattern: '^https://[^/\s]+$'` (bare https origin, no trailing slash).
- §5/§10 rollout order: create the repository, then the `production` environment with its `main`-only rule and `PILOT_TOKEN`, then deploy the bootstrap stack, then set the variables, and only then push. This avoids an auto-created, unprotected `production` environment.

### Amendments before rollout

- §6.3: `sam build` runs before `configure-aws-credentials`, so dependency installation never runs with AWS credentials present. (The job still has `id-token: write` at job level, so the OIDC request variables exist for every step of `deploy-backend`; a build/deploy job split would be needed to remove that.)
- §6.4: split into `build-frontend` (checkout, `npm ci`, build, zip, upload artifact `site`; `permissions: contents: read`, no environment, no OIDC token) and `deploy-frontend` (downloads the artifact, configures AWS credentials, uploads to Amplify; installs and builds nothing, no checkout).
- `.gitignore` ignores `*.zip`.
- §5 step 1 of the rollout covers an existing GitHub repository: the only rule is that `.github/workflows/ci-cd.yml` must not reach GitHub before the `production` environment and its `main`-only rule exist.

### Amendment found during the first real run

- §4.3 trust subject: GitHub now issues the immutable-ID subject `repo:<owner>@<owner-id>/<repo>@<repo-id>:environment:production`, so the first CI run failed at assume-role against the name-only condition. The bootstrap template takes numeric parameters `GitHubOwnerId` and `GitHubRepoId` (digits only, no default) and the `StringEquals` condition uses the new format only. Because the ids are part of the string, a renamed or re-registered owner or repository name can no longer match. `docs/deploy.md` explains how to find the ids (GitHub CLI, REST API, CloudTrail).
