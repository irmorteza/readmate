"""Guard tests for the CI/CD workflow: they pin its security-relevant structure."""

import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ci-cd.yml"
DEPENDABOT = ROOT / ".github" / "dependabot.yml"
DEPLOY_JOBS = ("deploy-backend", "deploy-frontend")
MASTER_ONLY = "github.ref == 'refs/heads/master'"
SHA_PIN = re.compile(r"^[\w.-]+/[\w.-]+(/[\w./-]+)?@[0-9a-f]{40}$")


@pytest.fixture(scope="module")
def raw() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def workflow(raw) -> dict:
    return yaml.safe_load(raw)


@pytest.fixture(scope="module")
def jobs(workflow) -> dict:
    return workflow["jobs"]


def steps(job: dict) -> list[dict]:
    return job["steps"]


def run_text(job: dict) -> str:
    return "\n".join(s["run"] for s in steps(job) if "run" in s)


def test_workflow_triggers_on_every_push_and_manual_dispatch(workflow):
    triggers = workflow[True]  # PyYAML (YAML 1.1) reads the key `on` as boolean True
    assert "workflow_dispatch" in triggers
    assert "push" in triggers
    assert not (triggers["push"] or {}).get("branches")  # no branch filter: every branch


def test_top_level_permissions_are_contents_read_only(workflow):
    assert workflow["permissions"] == {"contents": "read"}


def test_only_deploy_jobs_request_id_token(jobs):
    for name in DEPLOY_JOBS:
        assert jobs[name]["permissions"] == {"id-token": "write", "contents": "read"}
    for name in ("test", "build-frontend", "smoke-test"):
        assert "id-token" not in jobs[name].get("permissions", {})
    assert jobs["build-frontend"]["permissions"] == {"contents": "read"}


def test_deploy_jobs_run_only_on_master_in_production_environment(jobs):
    for name in DEPLOY_JOBS:
        assert jobs[name]["if"] == MASTER_ONLY
        assert jobs[name]["environment"] == "production"
    assert "environment" not in jobs["test"]
    assert jobs["build-frontend"]["if"] == MASTER_ONLY
    assert "environment" not in jobs["build-frontend"]  # builds with no secrets and no AWS


def test_job_order(jobs):
    assert jobs["deploy-backend"]["needs"] == "test"
    assert jobs["build-frontend"]["needs"] == "deploy-backend"
    assert jobs["deploy-frontend"]["needs"] == "build-frontend"
    assert sorted(jobs["smoke-test"]["needs"]) == ["deploy-backend", "deploy-frontend"]


def test_smoke_test_reads_environment_but_has_no_aws_credentials_step(jobs):
    smoke = jobs["smoke-test"]
    assert smoke["environment"] == "production"  # needed to read vars.FRONTEND_ORIGIN
    assert smoke["permissions"] == {"contents": "read"}
    assert not any("configure-aws-credentials" in s.get("uses", "") for s in steps(smoke))


def test_all_actions_pinned_to_full_sha_with_version_comment(raw, jobs):
    uses_lines = [line for line in raw.splitlines() if re.search(r"^\s*-?\s*uses:", line)]
    assert uses_lines
    for line in uses_lines:
        assert re.search(r"uses:\s*" + SHA_PIN.pattern[1:-1] + r"\s+# v\d", line), line
    for job in jobs.values():
        for step in steps(job):
            if "uses" in step:
                assert SHA_PIN.match(step["uses"]), step["uses"]


def test_no_long_lived_aws_keys(raw):
    for forbidden in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "secrets.AWS"):
        assert forbidden not in raw


def test_pilot_token_only_reaches_steps_through_env(raw, jobs):
    assert "set -x" not in raw
    for job in jobs.values():
        for step in steps(job):
            assert "secrets.PILOT_TOKEN" not in step.get("run", "")
    deploy = next(s for s in steps(jobs["deploy-backend"]) if "sam deploy" in s.get("run", ""))
    assert deploy["env"]["PILOT_TOKEN"] == "${{ secrets.PILOT_TOKEN }}"
    assert "PilotToken=$PILOT_TOKEN" in deploy["run"]
    assert len(re.findall(r"secrets\.\w+", raw)) == 1  # PILOT_TOKEN is the only secret used


def test_sam_deploy_has_all_explicit_flags(jobs):
    text = run_text(jobs["deploy-backend"])
    for flag in (
        "sam build -t infra/template.yaml",
        "--stack-name",
        "--region",
        "--resolve-s3",
        "--capabilities CAPABILITY_IAM",
        "--no-confirm-changeset",
        "--no-fail-on-empty-changeset",
        "--parameter-overrides",
        "PilotToken=",
        "FrontendOrigin=",
        "AlertEmail=",
        "OcrEngine=textract",
        "ExecutionRoleArn=",
    ):
        assert flag in text, flag


def test_backend_job_exposes_non_empty_function_url_as_output(jobs):
    job = jobs["deploy-backend"]
    assert job["outputs"]["api_url"] == "${{ steps.url.outputs.api_url }}"
    step = next(s for s in steps(job) if s.get("id") == "url")
    assert "describe-stacks" in step["run"] and "FunctionUrl" in step["run"]
    assert '-z "$url"' in step["run"] and "exit 1" in step["run"]
    assert "GITHUB_OUTPUT" in step["run"]


def test_frontend_build_job_builds_against_current_backend_and_commit(jobs):
    job = jobs["build-frontend"]
    build = next(s for s in steps(job) if "VITE_API_URL" in s.get("env", {}))
    assert build["env"]["VITE_API_URL"] == "${{ needs.deploy-backend.outputs.api_url }}"
    assert build["env"]["VITE_BUILD_SHA"] == "${{ github.sha }}"
    text = run_text(job)
    for needle in ("npm ci", "npm run build", "zip -r ../site.zip .", "unzip -Z1", "index.html"):
        assert needle in text, needle


def test_zip_is_handed_over_as_an_artifact(jobs):
    upload = next(
        s for s in steps(jobs["build-frontend"]) if "upload-artifact" in s.get("uses", "")
    )
    download = next(
        s for s in steps(jobs["deploy-frontend"]) if "download-artifact" in s.get("uses", "")
    )
    assert upload["with"]["name"] == download["with"]["name"] == "site"
    assert upload["with"]["path"] == "frontend/site.zip"
    assert upload["with"]["if-no-files-found"] == "error"
    assert download["with"]["path"] == "artifact"
    assert "artifact/site.zip" in run_text(jobs["deploy-frontend"])


def test_jobs_holding_the_oidc_token_install_and_build_nothing(jobs):
    # deploy-frontend only downloads the artifact and talks to Amplify.
    frontend = jobs["deploy-frontend"]
    text = run_text(frontend)
    for forbidden in ("npm", "pip install", "sam build"):
        assert forbidden not in text, forbidden
    for step in steps(frontend):
        uses = step.get("uses", "")
        assert "setup-node" not in uses and "setup-python" not in uses and "checkout" not in uses
    # deploy-backend builds (which installs dependencies) before any AWS credentials exist.
    backend_steps = steps(jobs["deploy-backend"])
    build = next(i for i, s in enumerate(backend_steps) if s.get("run", "").startswith("sam build"))
    creds = next(
        i for i, s in enumerate(backend_steps) if "configure-aws-credentials" in s.get("uses", "")
    )
    deploy = next(i for i, s in enumerate(backend_steps) if "sam deploy" in s.get("run", ""))
    assert build < creds < deploy


def test_frontend_deploy_job_talks_to_amplify_and_polls(jobs):
    job = jobs["deploy-frontend"]
    text = run_text(job)
    for needle in (
        "amplify create-deployment",
        "curl --fail",
        "amplify start-deployment",
        "amplify get-job",
        "sleep 10",
        "SUCCEED",
        "FAILED",
        "CANCELLED",
    ):
        assert needle in text, needle


def test_smoke_test_job_runs_the_script_and_fails_on_empty_inputs(jobs):
    text = run_text(jobs["smoke-test"])
    assert "FRONTEND_ORIGIN:?" in text and "API_URL:?" in text
    assert "python scripts/smoke_test.py" in text
    for flag in ("--api-url", "--frontend-origin", "--sha"):
        assert flag in text
    env = next(s for s in steps(jobs["smoke-test"]) if "run" in s)["env"]
    assert env["API_URL"] == "${{ needs.deploy-backend.outputs.api_url }}"
    assert env["FRONTEND_ORIGIN"] == "${{ vars.FRONTEND_ORIGIN }}"


def test_test_job_runs_every_check_the_spec_lists(jobs):
    job = jobs["test"]
    text = run_text(job)
    for needle in (
        "backend/requirements-dev.txt",
        "ruff check",
        "pytest",
        "npm ci",
        "vitest run",
        "tsc --noEmit",
        "actionlint",
        "cfn-lint infra/template.yaml infra/github-oidc.yaml",
    ):
        assert needle in text, needle
    python = next(s for s in steps(job) if "setup-python" in s.get("uses", ""))
    assert python["with"]["python-version"] == "3.13"
    node = next(s for s in steps(job) if "setup-node" in s.get("uses", ""))
    assert node["with"]["node-version"] == "24"


def test_concurrency_groups(jobs):
    assert jobs["test"]["concurrency"] == {
        "group": "test-${{ github.ref }}",
        "cancel-in-progress": True,
    }
    for name in DEPLOY_JOBS:
        assert jobs[name]["concurrency"] == {
            "group": "deploy-production",
            "cancel-in-progress": False,
        }


def test_sam_telemetry_is_disabled_for_every_job(workflow, jobs):
    top = workflow.get("env", {})
    for name, job in jobs.items():
        value = {**top, **job.get("env", {})}.get("SAM_CLI_TELEMETRY")
        assert str(value) == "0", name


def test_dependabot_updates_github_actions_weekly():
    config = yaml.safe_load(DEPENDABOT.read_text(encoding="utf-8"))
    (update,) = [u for u in config["updates"] if u["package-ecosystem"] == "github-actions"]
    assert update["directory"] == "/"
    assert update["schedule"]["interval"] == "weekly"
