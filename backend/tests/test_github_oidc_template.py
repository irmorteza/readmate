"""Guard tests for the OIDC bootstrap stack: they pin the trust policy and least privilege."""

from pathlib import Path

import pytest
import yaml

INFRA = Path(__file__).resolve().parents[2] / "infra"
SUB_KEY = "token.actions.githubusercontent.com:sub"
AUD_KEY = "token.actions.githubusercontent.com:aud"
WILDCARD_RESOURCE_ACTIONS = {"cloudformation:ValidateTemplate", "logs:DescribeLogGroups"}
LAMBDA_BASIC_EXECUTION = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
IAM_WRITE_ACTIONS = {
    "iam:CreateRole",
    "iam:DeleteRole",
    "iam:PutRolePolicy",
    "iam:AttachRolePolicy",
    "iam:DetachRolePolicy",
    "iam:DeleteRolePolicy",
    "iam:UpdateAssumeRolePolicy",
    "iam:CreatePolicy",
    "iam:PutRolePermissionsBoundary",
}
# Exact resources per statement: widening any of them must be a deliberate test change.
EXPECTED_RESOURCES = {
    "CloudFormationOwnStack": [
        "arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${AppStackName}/*"
    ],
    "CloudFormationSamManagedStack": [
        "arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/aws-sam-cli-managed-default/*"
    ],
    "CloudFormationServerlessTransform": [
        "arn:aws:cloudformation:${AWS::Region}:aws:transform/Serverless-2016-10-31"
    ],
    "CloudFormationValidate": ["*"],
    "SamBucketObjects": ["arn:aws:s3:::${SamBucketName}/*"],
    "SamBucket": ["arn:aws:s3:::${SamBucketName}"],
    "LambdaOwnFunctions": [
        "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${AppStackName}-*"
    ],
    "IamPassOcrExecutionRoleOnly": ["OcrExecutionRole.Arn"],
    "LogsOwnLogGroups": [
        "arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AppStackName}-*",
        "arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AppStackName}-*:*",
    ],
    "LogsDescribe": ["*"],
    "BudgetsOwnBudget": ["arn:aws:budgets::${AWS::AccountId}:budget/${AppStackName}-*"],
    "AmplifyDeployToStagingBranch": [
        "arn:aws:amplify:${AWS::Region}:${AWS::AccountId}:apps/${AmplifyAppId}/branches/${AmplifyBranch}",
        "arn:aws:amplify:${AWS::Region}:${AWS::AccountId}:apps/${AmplifyAppId}/branches/${AmplifyBranch}/jobs/*",
    ],
}


class CfnLoader(yaml.SafeLoader):
    """SafeLoader that keeps CloudFormation short-form tags (!Sub, !Ref, ...) as plain values."""


def _tag(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node, deep=True)
    return loader.construct_mapping(node, deep=True)


CfnLoader.add_multi_constructor("!", _tag)


def load(name: str) -> dict:
    return yaml.load((INFRA / name).read_text(encoding="utf-8"), Loader=CfnLoader)


@pytest.fixture(scope="module")
def template() -> dict:
    return load("github-oidc.yaml")


@pytest.fixture(scope="module")
def role(template) -> dict:
    return template["Resources"]["DeployRole"]["Properties"]


@pytest.fixture(scope="module")
def statements(role) -> list[dict]:
    (policy,) = role["Policies"]
    return policy["PolicyDocument"]["Statement"]


@pytest.fixture(scope="module")
def exec_role(template) -> dict:
    return template["Resources"]["OcrExecutionRole"]["Properties"]


def as_list(value) -> list:
    return value if isinstance(value, list) else [value]


# --- trust policy -------------------------------------------------------------------------


def test_trust_subject_is_production_environment_only(role):
    (trust,) = role["AssumeRolePolicyDocument"]["Statement"]
    assert trust["Condition"]["StringEquals"][SUB_KEY] == (
        "repo:${GitHubOwner}/${GitHubRepo}:environment:production"
    )
    assert set(trust["Condition"]) == {"StringEquals"}  # no StringLike / wildcard subjects


def test_trust_audience_is_sts_amazonaws_com(role):
    (trust,) = role["AssumeRolePolicyDocument"]["Statement"]
    assert trust["Condition"]["StringEquals"][AUD_KEY] == "sts.amazonaws.com"


def test_trust_action_is_assume_role_with_web_identity_only(role):
    (trust,) = role["AssumeRolePolicyDocument"]["Statement"]
    assert trust["Effect"] == "Allow"
    assert trust["Action"] == "sts:AssumeRoleWithWebIdentity"
    assert set(trust["Principal"]) == {"Federated"}


def test_trust_principal_is_the_github_oidc_provider_in_both_branches(role):
    (trust,) = role["AssumeRolePolicyDocument"]["Statement"]
    assert trust["Principal"]["Federated"] == [
        "CreateProvider",
        "GitHubOidcProvider",
        "arn:aws:iam::${AWS::AccountId}:oidc-provider/token.actions.githubusercontent.com",
    ]


def test_max_session_duration_is_3600(role):
    assert role["MaxSessionDuration"] == 3600


# --- least privilege ----------------------------------------------------------------------


def test_template_contains_exactly_the_expected_resources(template):
    assert set(template["Resources"]) == {"GitHubOidcProvider", "OcrExecutionRole", "DeployRole"}


def test_no_wildcard_actions_and_no_managed_policies_on_deploy_role(role, statements):
    assert "ManagedPolicyArns" not in role
    for statement in statements:
        for action in as_list(statement["Action"]):
            assert "*" not in action, action


def test_every_statement_has_the_expected_exact_resources(statements):
    actual = {s["Sid"]: sorted(as_list(s["Resource"])) for s in statements}
    assert actual == {sid: sorted(res) for sid, res in EXPECTED_RESOURCES.items()}


def test_wildcard_resource_only_for_validate_template_and_describe_log_groups(statements):
    for statement in statements:
        if "*" in as_list(statement["Resource"]):
            assert set(as_list(statement["Action"])) <= WILDCARD_RESOURCE_ACTIONS, statement


def test_deploy_role_has_no_iam_write_actions_except_passrole_to_execution_role(statements):
    actions = {a for s in statements for a in as_list(s["Action"])}
    assert not actions & IAM_WRITE_ACTIONS
    iam_actions = {a for a in actions if a.startswith("iam:")}
    assert iam_actions == {"iam:PassRole"}
    (passrole,) = [s for s in statements if "iam:PassRole" in as_list(s["Action"])]
    assert as_list(passrole["Resource"]) == ["OcrExecutionRole.Arn"]
    assert passrole["Condition"]["StringEquals"]["iam:PassedToService"] == "lambda.amazonaws.com"


def test_deploy_role_name_is_outside_every_prefix_it_may_manage(role):
    assert role["RoleName"] == "github-deploy-readmate"
    # No statement may be able to name the deploy role: no IAM resource patterns remain, and
    # the name does not start with the app prefix used by Lambda/log-group/budget patterns.
    assert not role["RoleName"].startswith("readmate-")


def test_lambda_statement_has_the_read_actions_cloudformation_needs(statements):
    (lam,) = [s for s in statements if s["Sid"] == "LambdaOwnFunctions"]
    actions = set(as_list(lam["Action"]))
    assert {
        "lambda:GetPolicy",
        "lambda:GetRuntimeManagementConfig",
        "lambda:GetFunctionCodeSigningConfig",
        "lambda:GetFunctionRecursionConfig",
    } <= actions


# --- execution role (moved here so CI needs no IAM write access) ----------------------------


def test_execution_role_trusts_only_lambda_and_has_basic_execution(exec_role):
    (trust,) = exec_role["AssumeRolePolicyDocument"]["Statement"]
    assert trust["Principal"] == {"Service": "lambda.amazonaws.com"}
    assert trust["Action"] == "sts:AssumeRole"
    assert exec_role["ManagedPolicyArns"] == [LAMBDA_BASIC_EXECUTION]


def test_execution_role_inline_policy_allows_only_textract_detect(exec_role):
    (policy,) = exec_role["Policies"]
    (statement,) = policy["PolicyDocument"]["Statement"]
    assert as_list(statement["Action"]) == ["textract:DetectDocumentText"]


def test_execution_role_name_is_derived_from_the_stack_prefix(exec_role):
    assert exec_role["RoleName"] == "${AppStackName}-ocr-execution"


def test_application_template_uses_the_external_execution_role():
    app = load("template.yaml")
    function = app["Resources"]["OcrFunction"]["Properties"]
    assert function["Role"] == "ExecutionRoleArn"
    assert "Policies" not in function
    assert app["Parameters"]["ExecutionRoleArn"]["Type"] == "String"


# --- provider, parameters, outputs ---------------------------------------------------------


def test_oidc_provider_is_conditional_and_has_no_thumbprint(template):
    provider = template["Resources"]["GitHubOidcProvider"]
    assert provider["Condition"] == "CreateProvider"
    assert provider["Properties"]["Url"] == "https://token.actions.githubusercontent.com"
    assert provider["Properties"]["ClientIdList"] == ["sts.amazonaws.com"]
    assert "ThumbprintList" not in provider["Properties"]
    assert template["Conditions"]["CreateProvider"] == ["CreateOidcProvider", "true"]


def test_parameters_and_outputs(template):
    params = template["Parameters"]
    assert set(params) == {
        "GitHubOwner",
        "GitHubRepo",
        "AppStackName",
        "AmplifyAppId",
        "AmplifyBranch",
        "SamBucketName",
        "CreateOidcProvider",
    }
    assert params["AppStackName"]["Default"] == "readmate"
    assert params["AmplifyBranch"]["Default"] == "staging"
    assert params["CreateOidcProvider"]["AllowedValues"] == ["true", "false"]
    assert set(template["Outputs"]) == {"DeployRoleArn", "OcrExecutionRoleArn"}


def test_frontend_origin_parameter_only_accepts_a_bare_https_origin():
    import re

    pattern = load("template.yaml")["Parameters"]["FrontendOrigin"]["AllowedPattern"]
    for good in ("https://staging.d2bhw8tobanmyi.amplifyapp.com", "https://example.com:8443"):
        assert re.fullmatch(pattern, good), good
    for bad in (
        "https://staging.d2bhw8tobanmyi.amplifyapp.com/",  # never equals a browser Origin
        "http://staging.d2bhw8tobanmyi.amplifyapp.com",
        "https://example.com/path",
        "https://exa mple.com",
        "https://",
        "",
    ):
        assert not re.fullmatch(pattern, bad), bad
