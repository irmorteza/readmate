# Deploying ReadMate

## 1. How the pipeline works

`.github/workflows/ci-cd.yml` runs on every push to any branch and on manual dispatch:

`test` (every push) → `deploy-backend` → `deploy-frontend` → `smoke-test` (only on `master`, only if the previous job passed).

- **test:** ruff and pytest (backend), Vitest and `tsc` (frontend), `actionlint`, `cfn-lint`.
- **deploy-backend:** assumes the AWS role through GitHub OIDC, `sam build`, `sam deploy` to stack `readmate`, reads the `FunctionUrl` stack output.
- **deploy-frontend:** builds the PWA against that URL with the commit SHA, zips it, uploads it to the Amplify app through the manual-deployment API, waits for the job.
- **smoke-test:** a wrong-token request must get HTTP 401; the Amplify page must serve the ReadMate title and a bundle that contains the current API host and the commit SHA.

No AWS keys are stored in GitHub. The only secret is `PILOT_TOKEN`; the workflow gets AWS credentials from a short-lived OIDC token that only the `production` environment (limited to `master`) can obtain.

After a deploy, the phone shows the short commit SHA under **Settings → Version**.

## 2. One-time setup

### 2.1 Bootstrap stack (from your laptop, never from CI)

`infra/github-oidc.yaml` creates the GitHub OIDC provider, the Lambda execution role `readmate-ocr-execution`, and the deploy role `github-deploy-readmate`. The deploy role has no IAM write permissions; its only IAM permission is passing the execution role to Lambda.

```powershell
aws cloudformation deploy `
  --template-file infra/github-oidc.yaml `
  --stack-name readmate-github-oidc `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides GitHubOwner=<owner> GitHubRepo=readmate AppStackName=readmate `
      AmplifyAppId=d2bhw8tobanmyi AmplifyBranch=staging SamBucketName=<bucket> CreateOidcProvider=true
```

- `GitHubOwner` and `GitHubRepo` must be spelled exactly as on GitHub (the trust condition is case-sensitive).
- `<bucket>` is the `aws-sam-cli-managed-default-samclisourcebucket-…` name from the SAM stack outputs (`aws cloudformation describe-stacks --stack-name aws-sam-cli-managed-default --query "Stacks[0].Outputs"`).
- Use `CreateOidcProvider=false` if the account already has the GitHub provider; it must list `sts.amazonaws.com` as a client id.
- Note the two outputs: `DeployRoleArn` and `OcrExecutionRoleArn`.

### 2.2 Switch the app stack to the external execution role (once)

The app stack takes the execution role as a parameter. Run the manual deploy from section 3 once with `ExecutionRoleArn=<OcrExecutionRoleArn>`; CloudFormation replaces the old auto-generated role.

### 2.3 GitHub `production` environment

Settings → Environments → **New environment `production`**:

- **Deployment branches and tags:** Selected branches → `master` only.
- **Environment secret:** `PILOT_TOKEN` (the same token the phone uses).
- **Environment variables:**

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

If a CI deploy fails with `AccessDenied`, add exactly the named action on the scoped resource to `infra/github-oidc.yaml` and redeploy the bootstrap stack from the laptop. Never widen to `"Action": "*"` or `AdministratorAccess`.

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

- **Rollback:** `git revert <commit>` and push to `master`; the pipeline redeploys the previous state. CloudFormation already rolls a failed backend deploy back by itself.
- **If a job fails:** `test` red deploys nothing; `deploy-backend` red leaves the frontend untouched; `deploy-frontend` red leaves the new backend live with the old frontend; `smoke-test` red means both are live, so investigate.
- **API changes must be additive.** The backend can be ahead of the frontend, and an installed PWA can keep running an older cached build, so every backend version must keep working with the previous frontend: add fields and routes, never remove or change the meaning of existing ones in the same release.
