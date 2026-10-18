"""Guard tests for the OIDC bootstrap stack: they pin the trust policy and least privilege."""

from pathlib import Path

import pytest
import yaml

TEMPLATE = Path(__file__).resolve().parents[2] / "infra" / "github-oidc.yaml"
SUB_KEY = "token.actions.githubusercontent.com:sub"
AUD_KEY = "token.actions.githubusercontent.com:aud"
WILDCARD_RESOURCE_ACTIONS = {"cloudformation:ValidateTemplate", "logs:DescribeLogGroups"}
LAMBDA_BASIC_EXECUTION = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"


class CfnLoader(yaml.SafeLoader):
    """SafeLoader that keeps CloudFormation short-form tags (!Sub, !Ref, ...) as plain values."""


def _tag(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node, deep=True)
    return loader.construct_mapping(node, deep=True)


CfnLoader.add_multi_constructor("!", _tag)


@pytest.fixture(scope="module")
def template() -> dict:
    return yaml.load(TEMPLATE.read_text(encoding="utf-8"), Loader=CfnLoader)


@pytest.fixture(scope="module")
def role(template) -> dict:
    return template["Resources"]["DeployRole"]["Properties"]


@pytest.fixture(scope="module")
def statements(role) -> list[dict]:
    (policy,) = role["Policies"]
    return policy["PolicyDocument"]["Statement"]


def as_list(value) -> list:
    return value if isinstance(value, list) else [value]


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


def test_max_session_duration_is_3600(role):
    assert role["MaxSessionDuration"] == 3600


def test_no_wildcard_actions_and_no_managed_policies(role, statements):
    assert "ManagedPolicyArns" not in role
    for statement in statements:
        for action in as_list(statement["Action"]):
            assert action != "*" and not action.endswith(":*"), action


def test_wildcard_resource_only_for_validate_template_and_describe_log_groups(statements):
    for statement in statements:
        if "*" in as_list(statement["Resource"]):
            assert set(as_list(statement["Action"])) <= WILDCARD_RESOURCE_ACTIONS, statement


def test_passrole_limited_to_lambda_service(statements):
    passrole = [s for s in statements if "iam:PassRole" in as_list(s["Action"])]
    assert len(passrole) == 1
    assert passrole[0]["Condition"]["StringEquals"]["iam:PassedToService"] == "lambda.amazonaws.com"
    assert as_list(passrole[0]["Action"]) == ["iam:PassRole"]


def test_attach_role_policy_limited_to_lambda_basic_execution(statements):
    attach = [s for s in statements if "iam:AttachRolePolicy" in as_list(s["Action"])]
    assert len(attach) == 1
    assert attach[0]["Condition"]["ArnEquals"]["iam:PolicyARN"] == LAMBDA_BASIC_EXECUTION


def test_iam_actions_only_on_stack_prefixed_roles(statements):
    for statement in statements:
        if any(a.startswith("iam:") for a in as_list(statement["Action"])):
            for resource in as_list(statement["Resource"]):
                assert resource.endswith(":role/${AppStackName}-*"), resource


def test_oidc_provider_is_conditional_and_has_no_thumbprint(template):
    provider = template["Resources"]["GitHubOidcProvider"]
    assert provider["Condition"] == "CreateProvider"
    assert provider["Properties"]["Url"] == "https://token.actions.githubusercontent.com"
    assert provider["Properties"]["ClientIdList"] == ["sts.amazonaws.com"]
    assert "ThumbprintList" not in provider["Properties"]
    assert template["Conditions"]["CreateProvider"] == ["CreateOidcProvider", "true"]


def test_role_name_parameters_and_output(template, role):
    assert role["RoleName"] == "readmate-github-deploy"
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
    assert "DeployRoleArn" in template["Outputs"]
