import json
import logging

from app.meeting_report_processor import InfrastructureError
from app.pr_review_analysis_processor import (
    PR_REVIEW_ANALYSIS_JOB_TYPE,
    PR_REVIEW_ANALYSIS_SCHEMA_VERSION,
    PrReviewAnalysisFileResult,
    PrReviewAnalysisInputError,
    PrReviewAnalysisOutputError,
    PrReviewAnalysisProcessor,
    PrReviewAnalysisProviderError,
    PrReviewAnalysisResult,
    _build_prompt_input,
    _pr_review_analysis_schema,
    _serialize_analysis_result,
    parse_pr_review_analysis_input_payload,
    parse_pr_review_analysis_job_payload,
    parse_pr_review_analysis_output,
)
from app.pr_review_semantic_graph import PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION

JOB_ID = "11111111-1111-1111-1111-111111111111"
SESSION_ID = "22222222-2222-2222-2222-222222222222"
WORKSPACE_ID = "33333333-3333-3333-3333-333333333333"
HEAD_SHA = "abcdef123456"


def job_payload(**overrides: object) -> dict[str, object]:
    return {
        "jobType": PR_REVIEW_ANALYSIS_JOB_TYPE,
        "schemaVersion": PR_REVIEW_ANALYSIS_SCHEMA_VERSION,
        "jobId": JOB_ID,
        "reviewSessionId": SESSION_ID,
        "workspaceId": WORKSPACE_ID,
        "headSha": HEAD_SHA,
        **overrides,
    }


def input_payload(**overrides: object) -> dict[str, object]:
    data = {
        "jobId": JOB_ID,
        "reviewSessionId": SESSION_ID,
        "workspaceId": WORKSPACE_ID,
        "headSha": HEAD_SHA,
        "pullRequest": {
            "prNumber": 24,
            "title": "Async PR analysis",
            "body": "Move the PR review analysis to a worker.",
            "state": "open",
            "draft": False,
            "mergeable": True,
            "authorLogin": "pilo",
            "headBranch": "feature/async-pr-review",
            "baseBranch": "dev",
            "baseSha": "base-sha",
            "changedFilesCount": 2,
            "additions": 20,
            "deletions": 4,
            "commitsCount": 2,
        },
        "files": [
            {
                "filePath": "apps/app-server/src/pr-review.ts",
                "previousFilePath": None,
                "fileName": "pr-review.ts",
                "fileStatus": "modified",
                "additions": 12,
                "deletions": 3,
                "isBinary": False,
                "isLargeDiff": False,
                "patch": "+export const asyncReview = true;",
            },
            {
                "filePath": "docs/api/pr-review-api.md",
                "previousFilePath": None,
                "fileName": "pr-review-api.md",
                "fileStatus": "modified",
                "additions": 8,
                "deletions": 1,
                "isBinary": False,
                "isLargeDiff": False,
                "patch": "+Worker handoff contract",
            },
        ],
    }
    data.update(overrides)
    return {"success": True, "data": data}


def analysis_result() -> PrReviewAnalysisResult:
    return PrReviewAnalysisResult(
        pr_purpose="PR Review 분석을 비동기로 전환합니다.",
        change_summary=("Worker processor 추가",),
        recommended_review_order="Worker 경계부터 확인합니다.",
        caution_points=("head SHA를 확인합니다.",),
        flow_title="PR 변경 파일 리뷰",
        flow_description="분석 입력을 검증합니다.",
        files=(
            PrReviewAnalysisFileResult(
                file_path="apps/app-server/src/pr-review.ts",
                file_role="서버 로직",
                risk_level="medium",
                change_reason="분석 요청을 생성합니다.",
                change_summary="비동기 Job 생성",
                review_points=("중복 Job을 확인합니다.",),
            ),
            PrReviewAnalysisFileResult(
                file_path="docs/api/pr-review-api.md",
                file_role="API 계약",
                risk_level="low",
                change_reason="Worker 경계를 문서화합니다.",
                change_summary="internal handoff 계약",
                review_points=("token 노출 여부를 확인합니다.",),
            ),
        ),
    )


def semantic_graph_payload() -> dict[str, object]:
    relation_key = "supports:docs/api/pr-review-api.md->apps/app-server/src/pr-review.ts"
    return {
        "files": [
            {
                "filePath": "apps/app-server/src/pr-review.ts",
                "roleType": "core_logic",
                "confidence": 65,
                "evidence": "code_file_fallback",
                "roleOverrideAllowed": True,
            },
            {
                "filePath": "docs/api/pr-review-api.md",
                "roleType": "support",
                "confidence": 90,
                "evidence": "support_path",
                "roleOverrideAllowed": False,
            },
        ],
        "relations": [
            {
                "key": relation_key,
                "fromFilePath": "docs/api/pr-review-api.md",
                "toFilePath": "apps/app-server/src/pr-review.ts",
                "relationType": "supports",
                "source": "rule",
                "confidence": 75,
                "evidence": "explicit_file_reference",
            }
        ],
        "flows": [
            {
                "key": "candidate-flow-1",
                "title": "핵심 로직 변경",
                "filePaths": [
                    "apps/app-server/src/pr-review.ts",
                    "docs/api/pr-review-api.md",
                ],
                "relationKeys": [relation_key],
                "fallback": False,
            }
        ],
    }


def semantic_graph_output() -> dict[str, object]:
    relation_key = "supports:docs/api/pr-review-api.md->apps/app-server/src/pr-review.ts"
    return {
        "graphSchemaVersion": PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION,
        "semanticGraph": {
            "files": [
                {
                    "filePath": "apps/app-server/src/pr-review.ts",
                    "roleType": "entry",
                    "roleReason": "분석 Job 진입점을 제공합니다.",
                },
                {
                    "filePath": "docs/api/pr-review-api.md",
                    "roleType": "support",
                    "roleReason": "내부 handoff 계약을 설명합니다.",
                },
            ],
            "relations": [
                {
                    "candidateKey": relation_key,
                    "fromFilePath": "docs/api/pr-review-api.md",
                    "toFilePath": "apps/app-server/src/pr-review.ts",
                    "relationType": "supports",
                    "reason": "문서가 구현 계약을 설명합니다.",
                }
            ],
            "flows": [
                {
                    "candidateKey": "candidate-flow-1",
                    "title": "PR Review 분석 계약",
                    "description": "분석 handoff 변경을 함께 검토합니다.",
                    "reviewOrder": [
                        "docs/api/pr-review-api.md",
                        "apps/app-server/src/pr-review.ts",
                    ],
                }
            ],
        },
    }


class FakeHandoffClient:
    def __init__(self, input_value=None, error: Exception | None = None) -> None:
        self.input_value = input_value
        self.error = error
        self.requested_jobs = []
        self.submitted_results = []
        self.submitted_failures = []

    def get_input(self, job):
        self.requested_jobs.append(job)
        if self.error:
            raise self.error
        return self.input_value

    def submit_result(self, job, analysis) -> None:
        self.submitted_results.append((job, analysis))
        if self.error:
            raise self.error

    def submit_failure(self, job, code) -> None:
        self.submitted_failures.append((job, code))
        if self.error:
            raise self.error


class FakeAnalysisClient:
    def __init__(self, result=None, error: Exception | None = None) -> None:
        self.result = result or analysis_result()
        self.error = error
        self.inputs = []

    def analyze(self, input_value):
        self.inputs.append(input_value)
        if self.error:
            raise self.error
        return self.result


def parsed_input():
    return parse_pr_review_analysis_input_payload(
        input_payload(),
        parse_pr_review_analysis_job_payload(job_payload()),
    )


def test_parser_requires_versioned_uuid_payload() -> None:
    job = parse_pr_review_analysis_job_payload(job_payload())

    assert job.job_id == JOB_ID
    assert job.head_sha == HEAD_SHA

    for payload in (
        job_payload(schemaVersion="pr-review-analysis:v2"),
        job_payload(jobId="not-a-uuid"),
        job_payload(headSha=" "),
    ):
        try:
            parse_pr_review_analysis_job_payload(payload)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid PR Review job must be rejected")


def test_input_handoff_requires_matching_identity_and_unique_paths() -> None:
    job = parse_pr_review_analysis_job_payload(job_payload())
    input_value = parse_pr_review_analysis_input_payload(input_payload(), job)

    assert input_value.pull_request.pr_number == 24
    assert [file.file_path for file in input_value.files] == [
        "apps/app-server/src/pr-review.ts",
        "docs/api/pr-review-api.md",
    ]
    assert input_value.semantic_graph is None

    mismatched = input_payload(headSha="different-head")
    duplicate = input_payload(
        files=[
            input_payload()["data"]["files"][0],
            input_payload()["data"]["files"][0],
        ]
    )
    for payload in (mismatched, duplicate):
        try:
            parse_pr_review_analysis_input_payload(payload, job)
        except ValueError:
            pass
        else:
            raise AssertionError("mismatched handoff input must be rejected")


def test_processor_forwards_normalized_analysis_to_next_handoff(caplog) -> None:
    caplog.set_level(logging.INFO)
    handoff = FakeHandoffClient(input_value=parsed_input())
    analysis_client = FakeAnalysisClient()
    result = PrReviewAnalysisProcessor(handoff, analysis_client).process_payload(job_payload())

    assert result.delete_message is True
    assert result.reason == "pr_review_analysis_completed"
    assert result.job_id == JOB_ID
    assert len(analysis_client.inputs) == 1
    assert handoff.submitted_results == [(handoff.requested_jobs[0], analysis_result())]
    assert JOB_ID in caplog.text
    assert SESSION_ID in caplog.text


def test_processor_deletes_invalid_payload_and_terminal_input_or_output_errors() -> None:
    invalid_payload = PrReviewAnalysisProcessor(
        FakeHandoffClient(input_value=parsed_input()),
        FakeAnalysisClient(),
    ).process_payload(job_payload(schemaVersion="invalid"))
    invalid_input = PrReviewAnalysisProcessor(
        FakeHandoffClient(error=PrReviewAnalysisInputError()),
        FakeAnalysisClient(),
    ).process_payload(job_payload())
    invalid_output = PrReviewAnalysisProcessor(
        FakeHandoffClient(input_value=parsed_input()),
        FakeAnalysisClient(error=PrReviewAnalysisOutputError()),
    ).process_payload(job_payload())

    assert invalid_payload == type(invalid_payload)(True, "invalid_pr_review_analysis_job", None)
    assert invalid_input.reason == "pr_review_analysis_input_invalid"
    assert invalid_input.delete_message is True
    assert invalid_output.reason == "pr_review_analysis_output_invalid"
    assert invalid_output.delete_message is True


def test_processor_reports_safe_terminal_failure_codes() -> None:
    input_handoff = FakeHandoffClient(error=PrReviewAnalysisInputError())
    input_result = PrReviewAnalysisProcessor(
        input_handoff,
        FakeAnalysisClient(),
    ).process_payload(job_payload())
    provider_handoff = FakeHandoffClient(input_value=parsed_input())
    provider_result = PrReviewAnalysisProcessor(
        provider_handoff,
        FakeAnalysisClient(error=PrReviewAnalysisProviderError()),
    ).process_payload(job_payload())

    assert input_result.delete_message is True
    assert input_handoff.submitted_failures == [
        (input_handoff.requested_jobs[0], "ANALYSIS_INPUT_INVALID")
    ]
    assert provider_result.delete_message is True
    assert provider_handoff.submitted_failures == [
        (provider_handoff.requested_jobs[0], "ANALYSIS_PROVIDER_FAILED")
    ]


def test_retry_exhaustion_reports_provider_failure_before_deleting_message() -> None:
    handoff = FakeHandoffClient(input_value=parsed_input())
    processor = PrReviewAnalysisProcessor(handoff, FakeAnalysisClient())

    assert processor.terminalize_retry_exhaustion(json.dumps(job_payload())) is True
    assert handoff.submitted_failures == [
        (
            parse_pr_review_analysis_job_payload(job_payload()),
            "ANALYSIS_PROVIDER_FAILED",
        )
    ]


def test_retry_exhaustion_keeps_message_when_failure_handoff_is_unavailable() -> None:
    handoff = FakeHandoffClient(
        input_value=parsed_input(),
        error=InfrastructureError("handoff unavailable"),
    )
    processor = PrReviewAnalysisProcessor(handoff, FakeAnalysisClient())

    assert processor.terminalize_retry_exhaustion(json.dumps(job_payload())) is False


def test_processor_keeps_infrastructure_failures_for_sqs_retry() -> None:
    result = PrReviewAnalysisProcessor(
        FakeHandoffClient(input_value=parsed_input()),
        FakeAnalysisClient(error=InfrastructureError("OpenAI unavailable")),
    ).process_payload(job_payload())

    assert result.delete_message is False
    assert result.reason == "infrastructure_failure"
    assert result.job_id == JOB_ID


def test_output_validator_rejects_file_mismatch_and_invalid_risk_level() -> None:
    input_value = parsed_input()
    valid_output = {
        "prPurpose": "비동기 분석",
        "changeSummary": ["Worker 추가"],
        "recommendedReviewOrder": "Worker부터 확인",
        "cautionPoints": ["head SHA 확인"],
        "flowTitle": "PR 변경 파일 리뷰",
        "flowDescription": "분석 경계 확인",
        "files": [
            {
                "filePath": "apps/app-server/src/pr-review.ts",
                "fileRole": "서버",
                "riskLevel": "medium",
                "changeReason": "비동기 Job 생성",
                "changeSummary": "enqueue 처리",
                "reviewPoints": ["중복 처리"],
            },
            {
                "filePath": "docs/api/pr-review-api.md",
                "fileRole": "문서",
                "riskLevel": "low",
                "changeReason": "계약 갱신",
                "changeSummary": "handoff 문서",
                "reviewPoints": ["token 노출"],
            },
        ],
    }

    parsed = parse_pr_review_analysis_output(json.dumps(valid_output), input_value.files)
    assert parsed.files[0].risk_level == "medium"

    for mutation in (
        {**valid_output, "files": valid_output["files"][:1]},
        {
            **valid_output,
            "files": [
                {**valid_output["files"][0], "riskLevel": "critical"},
                valid_output["files"][1],
            ],
        },
    ):
        try:
            parse_pr_review_analysis_output(json.dumps(mutation), input_value.files)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid analysis output must be rejected")


def test_prompt_enforces_patch_budget_and_schema_is_strict() -> None:
    data = input_payload()
    data["data"]["files"][0]["patch"] = "a" * 5_000
    data["data"]["files"][1]["patch"] = "b" * 40_000
    input_value = parse_pr_review_analysis_input_payload(
        data,
        parse_pr_review_analysis_job_payload(job_payload()),
    )

    prompt = _build_prompt_input(input_value)
    files = prompt["files"]
    assert len(files[0]["patchSnippet"]) == 4_000
    assert len(files[1]["patchSnippet"]) == 4_000
    assert "semanticGraph" not in prompt

    def assert_closed_objects(value: object) -> None:
        if isinstance(value, dict):
            if value.get("type") == "object":
                assert value.get("additionalProperties") is False
            for nested in value.values():
                assert_closed_objects(nested)
        elif isinstance(value, list):
            for nested in value:
                assert_closed_objects(nested)

    assert_closed_objects(_pr_review_analysis_schema())


def test_versioned_semantic_graph_contract_round_trip_and_role_policy(caplog) -> None:
    data = input_payload(
        graphSchemaVersion=PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION,
        semanticGraph=semantic_graph_payload(),
    )
    input_value = parse_pr_review_analysis_input_payload(
        data,
        parse_pr_review_analysis_job_payload(job_payload()),
    )

    assert input_value.semantic_graph is not None
    assert input_value.semantic_graph.files[0].role_override_allowed is True
    assert input_value.semantic_graph.files[1].role_override_allowed is False
    assert _build_prompt_input(input_value)["semanticGraph"]["rolePolicy"] == {
        "overrideConfidenceThreshold": 85,
        "rule": (
            "Preserve roleType when roleOverrideAllowed is false. Roles with lower "
            "confidence or unknown may be corrected with a concise roleReason."
        ),
    }
    assert _build_prompt_input(input_value)["semanticGraph"]["outputPolicy"] == {
        "files": "Return every input filePath exactly once. Never invent or omit a filePath.",
        "relations": (
            "For an input candidate relation, copy its exact key into candidateKey. "
            "For a genuinely new relation, use null. Use only input file paths, never "
            "connect a file to itself, and never duplicate the same fromFilePath, "
            "toFilePath, and relationType."
        ),
        "flows": (
            "Return every input flow exactly once with its exact key in candidateKey. "
            "reviewOrder must contain every filePath from that flow exactly once and no "
            "filePath from another flow."
        ),
    }

    schema = _pr_review_analysis_schema(input_value.semantic_graph)
    assert "semanticGraph" in schema["required"]
    assert "graphSchemaVersion" in schema["required"]
    graph_schema = schema["properties"]["semanticGraph"]
    relation_schema = graph_schema["properties"]["relations"]["items"]["properties"]
    flow_schema = graph_schema["properties"]["flows"]["items"]["properties"]
    expected_paths = [
        "apps/app-server/src/pr-review.ts",
        "docs/api/pr-review-api.md",
    ]
    assert relation_schema["fromFilePath"]["enum"] == expected_paths
    assert relation_schema["toFilePath"]["enum"] == expected_paths
    assert relation_schema["candidateKey"]["enum"] == [
        None,
        "supports:docs/api/pr-review-api.md->apps/app-server/src/pr-review.ts",
    ]
    assert flow_schema["candidateKey"]["enum"] == ["candidate-flow-1"]
    assert flow_schema["reviewOrder"]["items"]["enum"] == expected_paths

    legacy_output = {
        "prPurpose": "비동기 분석",
        "changeSummary": ["Worker 추가"],
        "recommendedReviewOrder": "Worker부터 확인",
        "cautionPoints": ["head SHA 확인"],
        "flowTitle": "PR 변경 파일 리뷰",
        "flowDescription": "분석 경계 확인",
        "files": [
            {
                "filePath": "apps/app-server/src/pr-review.ts",
                "fileRole": "서버",
                "riskLevel": "medium",
                "changeReason": "비동기 Job 생성",
                "changeSummary": "enqueue 처리",
                "reviewPoints": ["중복 처리"],
            },
            {
                "filePath": "docs/api/pr-review-api.md",
                "fileRole": "문서",
                "riskLevel": "low",
                "changeReason": "계약 갱신",
                "changeSummary": "handoff 문서",
                "reviewPoints": ["token 노출"],
            },
        ],
    }
    parsed = parse_pr_review_analysis_output(
        json.dumps({**legacy_output, **semantic_graph_output()}),
        input_value.files,
        input_value.semantic_graph,
    )

    assert parsed.semantic_graph is not None
    assert parsed.semantic_graph.files[0].role_type == "entry"
    serialized = _serialize_analysis_result(parsed)
    assert serialized["graphSchemaVersion"] == PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION
    assert serialized["semanticGraph"]["flows"][0]["candidateKey"] == "candidate-flow-1"

    invalid_outputs = []

    locked_role_changed = semantic_graph_output()
    locked_role_changed["semanticGraph"]["files"][1]["roleType"] = "api_contract"
    invalid_outputs.append((locked_role_changed, "role_policy", "locked_role_changed"))

    unknown_file = semantic_graph_output()
    unknown_file["semanticGraph"]["files"][0]["filePath"] = "missing.ts"
    invalid_outputs.append((unknown_file, "file_membership", "invalid_file"))

    unknown_relation_endpoint = semantic_graph_output()
    unknown_relation_endpoint["semanticGraph"]["relations"][0]["toFilePath"] = "missing.ts"
    invalid_outputs.append((unknown_relation_endpoint, "relation", "unknown_endpoint"))

    self_relation = semantic_graph_output()
    self_relation["semanticGraph"]["relations"][0]["toFilePath"] = self_relation["semanticGraph"][
        "relations"
    ][0]["fromFilePath"]
    invalid_outputs.append((self_relation, "relation", "self_relation"))

    duplicate_relation = semantic_graph_output()
    duplicate_relation["semanticGraph"]["relations"].append(
        dict(duplicate_relation["semanticGraph"]["relations"][0])
    )
    invalid_outputs.append((duplicate_relation, "relation", "duplicate_relation"))

    unknown_relation_candidate = semantic_graph_output()
    unknown_relation_candidate["semanticGraph"]["relations"][0]["candidateKey"] = "missing-relation"
    invalid_outputs.append((unknown_relation_candidate, "relation", "unknown_candidate_key"))

    unknown_flow = semantic_graph_output()
    unknown_flow["semanticGraph"]["flows"][0]["candidateKey"] = "missing-flow"
    invalid_outputs.append((unknown_flow, "flow", "invalid_flow"))

    for invalid_output, category, reason in invalid_outputs:
        caplog.clear()
        fallback = parse_pr_review_analysis_output(
            json.dumps({**legacy_output, **invalid_output}),
            input_value.files,
            input_value.semantic_graph,
        )
        assert fallback.semantic_graph is None
        fallback_payload = _serialize_analysis_result(fallback)
        assert "graphSchemaVersion" not in fallback_payload
        assert "semanticGraph" not in fallback_payload
        assert (
            f"pr_review_semantic_graph_fallback category={category} reason={reason}" in caplog.text
        )


def test_semantic_graph_input_rejects_partial_or_unknown_contract_data() -> None:
    valid_graph = semantic_graph_payload()
    invalid_graph = {
        **valid_graph,
        "relations": [
            {
                **valid_graph["relations"][0],
                "toFilePath": "missing.ts",
            }
        ],
    }
    for payload in (
        input_payload(semanticGraph=valid_graph),
        input_payload(
            graphSchemaVersion="pr-review-semantic-graph:v2",
            semanticGraph=valid_graph,
        ),
        input_payload(
            graphSchemaVersion=PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION,
            semanticGraph=invalid_graph,
        ),
    ):
        try:
            parse_pr_review_analysis_input_payload(
                payload,
                parse_pr_review_analysis_job_payload(job_payload()),
            )
        except ValueError:
            pass
        else:
            raise AssertionError("invalid semantic graph input must be rejected")
