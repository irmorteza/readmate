# Deploying ReadMate

## 1. How the pipeline works

`.github/workflows/ci-cd.yml` runs on every push to any branch and on manual dispatch:

`test` (every push) → `deploy-backend` → `build-frontend` → `deploy-frontend` → `smoke-test` (everything after `test` only on `main`, only if the previous job passed).

- **test:** ruff and pytest (backend), Vitest and `tsc` (frontend), `actionlint`, `cfn-lint`.
- **deploy-backend:** `sam build` first (dependency installation runs before any AWS credentials exist), then assumes the AWS role through GitHub OIDC, `sam deploy` to stack `readmate`, and reads the `FunctionUrl` stack output.
- **build-frontend:** `npm ci` and the build run here, with no secrets, no environment and no OIDC token, against that URL and the commit SHA; the zip is passed on as an artifact.
- **deploy-frontend:** the only job with the OIDC token after the backend deploy; it downloads the zip and uploads it to the Amplify app through the manual-deployment API, then waits for the job. It installs and builds nothing.
- **word-info route:** `POST /v1/word-info` (lemma, translation and grammar of a tapped word, from the Anthropic API) deploys with the backend; it needs the one-time setup in section 2.5 and answers 503 until that is done.
- **smoke-test:** a wrong-token request must get HTTP 401; the Amplify page must serve the ReadMate title and a bundle that contains the current API host and the commit SHA.

No AWS keys are stored in GitHub. The only secret is `PILOT_TOKEN`; the workflow gets AWS credentials from a short-lived OIDC token that only the `production` environment (limited to `main`) can obtain.

After a deploy, the phone shows the short commit SHA under **Settings → Version**.

## 2. One-time setup

**Order matters.** Create the protected `production` environment *before* the first push and before the bootstrap stack trusts it. GitHub auto-creates an environment that a job names but that does not exist yet, with no branch rule, and such an environment would let a job on any branch present the `environment:production` identity.

### 2.1 GitHub repository and `production` environment (before pushing anything)

1. **Use the existing repository `readmate`** (or create it if it does not exist yet). Confirm it is private and spelled exactly as `GitHubRepo` will be given to the bootstrap stack (the trust condition is case-sensitive), and add it as `origin` if the local clone has no remote (`git remote add origin <url>`). **Do not push yet.** The one rule: the workflow file `.github/workflows/ci-cd.yml` must not reach GitHub before the `production` environment and its `main`-only rule exist. If the repository already contains that file on any branch, or already shows a `production` environment, do step 2 immediately and add the rule before anything else.
2. Settings → Environments → **New environment `production`**. If an environment named `production` already exists (for example a workflow ran before it was configured), edit it instead.
3. **Deployment branches and tags:** Selected branches → `main` only. Do this first.
4. **Environment secret:** `PILOT_TOKEN` (the same token the phone uses).

The environment variables are added in section 2.4, once the bootstrap outputs exist.

### 2.2 Bootstrap stack (from your laptop, never from CI)

`infra/github-oidc.yaml` creates the GitHub OIDC provider, the Lambda execution role `readmate-ocr-execution`, and the deploy role `github-deploy-readmate`. The deploy role has no IAM write permissions; its only IAM permission is passing the execution role to Lambda.

```powershell
aws cloudformation deploy `
  --template-file infra/github-oidc.yaml `
  --stack-name readmate-github-oidc `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides GitHubOwner=<owner> GitHubOwnerId=<owner-id> GitHubRepo=readmate GitHubRepoId=<repo-id> `
      AppStackName=readmate AmplifyAppId=d2bhw8tobanmyi AmplifyBranch=staging SamBucketName=<bucket> `
      CreateOidcProvider=true
```

- `GitHubOwner` and `GitHubRepo` must be spelled exactly as on GitHub (the trust condition is case-sensitive).
- `GitHubOwnerId` and `GitHubRepoId` are the numeric GitHub ids, see "Finding the two numeric ids" below. GitHub puts them into the OIDC subject (`repo:<owner>@<owner-id>/<repo>@<repo-id>:environment:production`), and the role trusts exactly that string, so a renamed or re-registered account or repository name can never match.
- The stack owns the provider, and passing `CreateOidcProvider=false` on an update would delete it. Later updates omit `--parameter-overrides`, so the current value (`true`) is kept and there is no need to pass it again.
- `<bucket>` is the `aws-sam-cli-managed-default-samclisourcebucket-…` name from the SAM stack outputs (`aws cloudformation describe-stacks --stack-name aws-sam-cli-managed-default --query "Stacks[0].Outputs"`).
- Use `CreateOidcProvider=false` if the account already has the GitHub provider; it must list `sts.amazonaws.com` as a client id.
- Note the outputs: `DeployRoleArn`, `OcrExecutionRoleArn` and `WordInfoTableName`.
- For later updates of an existing stack, do not pass `--parameter-overrides`. Unspecified parameters keep their current values. Use `--no-execute-changeset` and review the change set first (see the word-info section, 2.5). The full-parameter command above is only for the first creation.

#### Finding the two numeric ids

GitHub's OIDC token carries the subject in the immutable form `repo:<owner>@<owner-id>/<repo>@<repo-id>:environment:production`. If assuming the role fails with `Not authorized to perform sts:AssumeRoleWithWebIdentity`, the ids in the stack are missing or wrong. Get them in one of these ways:

- **GitHub CLI** (works for private repositories):

  ```powershell
  gh api users/<owner> --jq .id               # GitHubOwnerId
  gh api repos/<owner>/<repo> --jq .id        # GitHubRepoId
  ```

- **GitHub REST API without the CLI** (the repository call needs a token for a private repository, the user call does not):

  ```powershell
  (Invoke-RestMethod https://api.github.com/users/<owner>).id
  (Invoke-RestMethod https://api.github.com/repos/<owner>/<repo> -Headers @{ Authorization = "Bearer <github-token>" }).id
  ```

- **CloudTrail** (reads the exact string GitHub sent): CloudTrail → Event history → filter *Event name* = `AssumeRoleWithWebIdentity` → open the failed event and look at the subject (`userIdentity.userName`, or the `sub` in the error message). It reads `repo:<owner>@<owner-id>/<repo>@<repo-id>:environment:production`; the two numbers are the ids.

Then update the stack from the laptop with the change-set procedure in section 2.5 (review the change set before executing it). Because the ids themselves must change, pass only `--parameter-overrides GitHubOwnerId=<owner-id> GitHubRepoId=<repo-id>`; every other parameter keeps its current value. The change should modify only the role's trust policy.

### 2.3 Switch the app stack to the external execution role (once)

The app stack takes the execution role as a parameter. Run the manual deploy from section 3 once with `ExecutionRoleArn=<OcrExecutionRoleArn>`; CloudFormation replaces the old auto-generated role. Do this before the first CI deploy, because the CI role may not delete the old role.

### 2.4 Environment variables, then the first push

Add these **environment variables** to `production`:

| Variable | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `DeployRoleArn` output |
| `OCR_EXECUTION_ROLE_ARN` | `OcrExecutionRoleArn` output |
| `AWS_REGION` | `eu-central-1` |
| `STACK_NAME` | `readmate` |
| `AMPLIFY_APP_ID` | `d2bhw8tobanmyi` |
| `AMPLIFY_BRANCH` | `staging` |
| `FRONTEND_ORIGIN` | `https://staging.d2bhw8tobanmyi.amplifyapp.com` (no trailing slash) |
| `ALERT_EMAIL` | your email |

No repository-level secrets and no AWS access keys.

Only now push all branches. The first run of the `main` workflow deploys.

If a CI deploy fails with `AccessDenied`, add exactly the named action on the scoped resource to `infra/github-oidc.yaml` and redeploy the bootstrap stack from the laptop. Never widen to `"Action": "*"` or `AdministratorAccess`.

### 2.5 Word-info API: Anthropic key, table and permissions

`POST /v1/word-info` calls the Anthropic API (Claude Haiku 5.5) from the Lambda. Do this once, in this order, before relying on the route. Until then OCR keeps working and word-info answers 503. Everything below is run by the owner from the laptop; CI and agents never run it.

**Anthropic workspace and spend guards (in the Anthropic console):**

1. Create a dedicated workspace for ReadMate and a key scoped to it.
2. Set a workspace spend limit (recommended $10/month).
3. Use prepaid credits with auto-reload off.

**Commands (PowerShell, from the repo root).** Step 1 stores the key as SecureString `/readmate/anthropic-api-key`. Step 2 redeploys the bootstrap stack as change set, review, execute, and adds the `readmate-word-info` table and the execution role's permissions. Step 3 verifies. Step 4 is run after the backend is deployed.

```powershell
# 1. Store the API key (input is hidden and not saved in history; it is passed to the aws process
#    for the duration of the call and never written to disk). Add --overwrite when rotating.
$sec = Read-Host "Anthropic API key" -AsSecureString
$key = [System.Net.NetworkCredential]::new("", $sec).Password
aws ssm put-parameter --region eu-central-1 --name /readmate/anthropic-api-key --type SecureString --value $key
Remove-Variable key, sec

# 2a. Create (do NOT execute) a change set for the bootstrap stack. No --parameter-overrides: per the AWS CLI
#     reference for `cloudformation deploy`, "If you're updating a stack and you don't specify a parameter,
#     the command uses the stack's existing value", so GitHubOwnerId / GitHubRepoId / CreateOidcProvider
#     etc. are reused exactly. The template adds no new parameters.
aws cloudformation deploy --region eu-central-1 `
  --template-file infra/github-oidc.yaml --stack-name readmate-github-oidc --capabilities CAPABILITY_NAMED_IAM `
  --no-execute-changeset

# 2b. Find the change set just created (do not rely on deploy's printed output)
$cs = aws cloudformation list-change-sets --region eu-central-1 --stack-name readmate-github-oidc `
  --query "reverse(sort_by(Summaries, &CreationTime))[0].ChangeSetId" --output text
aws cloudformation describe-change-set --region eu-central-1 --change-set-name $cs --query "{Status:Status,ExecutionStatus:ExecutionStatus}"

# 2c. Review the resource changes
aws cloudformation describe-change-set --region eu-central-1 --change-set-name $cs `
  --query "Changes[].ResourceChange.{Action:Action,Resource:LogicalResourceId,Type:ResourceType,Replacement:Replacement}" --output table

# 2d. Check the parameters are the stack's current values (the two lists must be identical)
aws cloudformation describe-stacks --region eu-central-1 --stack-name readmate-github-oidc `
  --query "sort_by(Stacks[0].Parameters, &ParameterKey)[].[ParameterKey,ParameterValue]" --output text
aws cloudformation describe-change-set --region eu-central-1 --change-set-name $cs `
  --query "sort_by(Parameters, &ParameterKey)[].[ParameterKey,ParameterValue]" --output text

# 2e. Only if 2c and 2d match the expectation below: execute and wait
aws cloudformation execute-change-set --region eu-central-1 --change-set-name $cs
aws cloudformation wait stack-update-complete --region eu-central-1 --stack-name readmate-github-oidc
#     Otherwise discard it:
# aws cloudformation delete-change-set --region eu-central-1 --change-set-name $cs

# 3. Verify (never use --with-decryption)
aws ssm get-parameter --region eu-central-1 --name /readmate/anthropic-api-key --query "Parameter.{Type:Type,Version:Version}"
aws dynamodb describe-table --region eu-central-1 --table-name readmate-word-info --query "Table.{Status:TableStatus,Billing:BillingModeSummary.BillingMode}"
aws dynamodb describe-time-to-live --region eu-central-1 --table-name readmate-word-info
$role = aws cloudformation describe-stacks --stack-name readmate-github-oidc --query "Stacks[0].Outputs[?OutputKey=='OcrExecutionRoleArn'].OutputValue" --output text
$acct = aws sts get-caller-identity --query Account --output text
aws iam simulate-principal-policy --policy-source-arn $role --action-names ssm:GetParameter `
  --resource-arns "arn:aws:ssm:eu-central-1:${acct}:parameter/readmate/anthropic-api-key" --query "EvaluationResults[].EvalDecision"   # allowed
aws iam simulate-principal-policy --policy-source-arn $role --action-names dynamodb:GetItem dynamodb:PutItem dynamodb:UpdateItem dynamodb:DeleteItem dynamodb:Scan `
  --resource-arns "arn:aws:dynamodb:eu-central-1:${acct}:table/readmate-word-info" --query "EvaluationResults[].[EvalActionName,EvalDecision]"  # 3 allowed, 2 denied

# 4. After the backend is deployed: one real lookup (costs well under $0.001)
$tok = Read-Host "Pilot token"
$url = aws cloudformation describe-stacks --stack-name readmate --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text
$body = '{"word":"stellte","wordIndex":1,"sentence":{"kind":"sentence","words":["Sie","stellte","ihn","ihrer","Mutter","vor."]},"target":"en"}'
Invoke-RestMethod -Method Post -Uri "${url}v1/word-info" -ContentType application/json -Headers @{ "X-Pilot-Token" = $tok } -Body $body | ConvertTo-Json -Depth 5
# run it twice: the second answer has meta.cached = true
```

**Expected change set (step 2c): two primary rows.**

| Action | Resource | Replacement |
|---|---|---|
| `Add` | `WordInfoTable` (`AWS::DynamoDB::Table`) | — (empty) |
| `Modify` | `OcrExecutionRole` (`AWS::IAM::Role`) | `False` |

CloudFormation may also list a derived `DeployRole` row, because the deploy role's policy references `OcrExecutionRole`. That row is acceptable ONLY if all of these hold: Action is `Modify`, Replacement is `False`, and its Details show the change is caused only by the reference to `OcrExecutionRole` (every detail has ChangeSource `ResourceAttribute`, Evaluation `Dynamic` and CausingEntity `OcrExecutionRole.Arn`), with NO static property change (no detail with Evaluation `Static`, no `DirectModification`). Print the details of both rows with this query (run it after `$cs` is set):

```powershell
aws cloudformation describe-change-set --region eu-central-1 --change-set-name $cs --query "Changes[?ResourceChange.LogicalResourceId=='DeployRole' || ResourceChange.LogicalResourceId=='OcrExecutionRole'].ResourceChange.{Resource:LogicalResourceId,Action:Action,Replacement:Replacement,Details:Details[].{Name:Target.Name,Attribute:Target.Attribute,Eval:Evaluation,Source:ChangeSource,Cause:CausingEntity}}" --output json
```

**Do not execute if anything else appears.** That includes any other involvement of `GitHubOidcProvider` or `DeployRole` (beyond the derived row described above), any `Remove`, or any `Replacement` of `True` or `Conditional`. It also includes any difference in step 2d. Delete the change set and investigate instead. (The new `WordInfoTableName` output is not a resource change and does not show in 2c.)

**Timing.** The inline policy on `OcrExecutionRole` is renamed (`TextractDetectDocumentText` to `OcrExecutionPermissions`), which may briefly drop the role's Textract permission while the update applies. Execute the change set when no scan or OCR request is running.

**Rotation.** Run step 1 again with `--overwrite` added to `put-parameter`. The Lambda keeps the key in memory per container, so the next cold start picks the new value up; to force that, update any function configuration (for example a description or an environment variable) or just wait.

**Privacy.** Tapped words with their sentence (or window) are sent to Anthropic for each lookup that misses the cache. No user identifier, image or token is sent. Data use follows Anthropic's commercial API terms (API inputs are not used for training by default). DynamoDB stores only hashes and generated answers. Logs hold request id, cached flag, latency, token usage, stop reason and error code, never the sentence, words, key or token.

**Quality probe (optional, after deploys or prompt changes).** It posts 12 curated sentences (about $0.01), prints one line per case, a summary of model calls, `max_tokens` stops and output-token statistics, and a verdict line. It asks for the pilot token at a hidden prompt; the token is never an argument. Right after a deploy with a new `PROMPT_VERSION` every row is a cache miss.

```powershell
$url = aws cloudformation describe-stacks --stack-name readmate --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text
python scripts/probe_word_info.py --api-url $url
```

## 3. Manual fallback from Windows

Use this if the pipeline is unavailable. Run it in a separate PowerShell window.

```powershell
$tok = Read-Host "Token"          # never put the token in a command line or a file
```

**Backend** (from the repo root). The token is not stored in `samconfig.toml`, so pass all five parameters every time:

```powershell
sam build -t infra/template.yaml
sam deploy --stack-name readmate --region eu-central-1 --resolve-s3 --capabilities CAPABILITY_IAM `
  --parameter-overrides "PilotToken=$tok" "FrontendOrigin=https://staging.d2bhw8tobanmyi.amplifyapp.com" `
    "AlertEmail=<email>" "OcrEngine=textract" "ExecutionRoleArn=<OcrExecutionRoleArn>"
$url = aws cloudformation describe-stacks --stack-name readmate --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text
```

**Frontend.** If script execution is disabled, call `npm.cmd` instead of `npm`:

```powershell
cd frontend
$env:VITE_API_URL = $url
$env:VITE_BUILD_SHA = (git rev-parse HEAD)
npm.cmd ci
npm.cmd run build
# Zip with Python, not Compress-Archive (which writes backslash entry names that Amplify rejects):
python -c "import shutil; shutil.make_archive('../site', 'zip', 'dist')"
# Before uploading, confirm the build contains the CURRENT Function URL:
Get-ChildItem dist -Recurse -File | Select-String "https://[a-z0-9]+\.lambda-url"
cd ..
$d = aws amplify create-deployment --app-id d2bhw8tobanmyi --branch-name staging | ConvertFrom-Json
curl.exe --fail -T site.zip $d.zipUploadUrl
aws amplify start-deployment --app-id d2bhw8tobanmyi --branch-name staging --job-id $d.jobId
aws amplify get-job --app-id d2bhw8tobanmyi --branch-name staging --job-id $d.jobId --query "job.summary.status"
```

**Check it:**

```powershell
python scripts/smoke_test.py --api-url $url --frontend-origin https://staging.d2bhw8tobanmyi.amplifyapp.com --sha (git rev-parse HEAD)
# a real OCR round trip (Resolve-Path makes -InFile work with relative paths):
Invoke-RestMethod -Method Post -Uri "${url}ocr" -ContentType image/jpeg -Headers @{ "X-Pilot-Token" = $tok } -InFile (Resolve-Path sample\book-page.jpg) | Select-Object version, engine
```

**After any frontend deploy**, the installed PWA may keep serving the old build: in the browser use DevTools → Application → Clear site data (on the phone, remove and re-add the app if the Version under Settings still shows the old SHA).

## 4. Rollback and API rules

- **Rollback:** `git revert <commit>` and push to `main`; the pipeline redeploys the previous state. CloudFormation already rolls a failed backend deploy back by itself.
- **If a job fails:** `test` red deploys nothing; `deploy-backend` red leaves the frontend untouched; `deploy-frontend` red leaves the new backend live with the old frontend; `smoke-test` red means both are live, so investigate.
- **API changes must be additive.** The backend can be ahead of the frontend, and an installed PWA can keep running an older cached build, so every backend version must keep working with the previous frontend: add fields and routes, never remove or change the meaning of existing ones in the same release.
