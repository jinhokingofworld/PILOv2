from __future__ import annotations

import json
import logging
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import UUID

from app.meeting_report_processor import InfrastructureError
from app.pr_review_semantic_graph import (
    PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION,
    SemanticGraphInput,
    SemanticGraphOutput,
    parse_semantic_graph_input,
    parse_semantic_graph_output,
    semantic_graph_output_error_category,
    semantic_graph_output_schema,
    semantic_graph_prompt_input,
    serialize_semantic_graph_output,
)

LOGGER = logging.getLogger(__name__)

PR_REVIEW_ANALYSIS_JOB_TYPE = "pr_review_analysis_requested"
PR_REVIEW_ANALYSIS_SCHEMA_VERSION = "pr-review-analysis:v1"
PR_REVIEW_RISK_LEVELS = {"high", "medium", "low", "unknown"}
DEFAULT_PR_REVIEW_MODEL = "gpt-5.1-mini"
MAX_PR_BODY_CHARS = 4_000
MAX_PATCH_CHARS_PER_FILE = 4_000
MAX_TOTAL_PATCH_CHARS = 32_000
PR_REVIEW_SYSTEM_PROMPT = (
    "You are PILO's PR review analysis engine. "
    "Return concise Korean review planning data only in the requested JSON schema."
)
RISK_LEVEL_GUIDANCE = {
    "high": ("Security, auth, payment, data/schema/migration, deletion, or broad runtime impact."),
    "medium": (
        "Main app/server logic, important feature behavior, or sizeable but reviewable changes."
    ),
    "low": "Docs, tests, styling, or isolated low-impact changes.",
    "unknown": ("Binary files, unavailable patch context, or insufficient information to judge."),
}


class PrReviewAnalysisInputError(Exception):
    pass


class PrReviewAnalysisOutputError(Exception):
    pass


class PrReviewAnalysisProviderError(Exception):
    pass


class PrReviewAnalysisStaleError(Exception):
    pass


@dataclass(frozen=True)
class PrReviewAnalysisJob:
    job_id: str
    review_session_id: str
    workspace_id: str
    head_sha: str


@dataclass(frozen=True)
class PrReviewPullRequestInput:
    pr_number: int
    title: str
    body: str | None
    state: str
    draft: bool
    mergeable: bool | None
    author_login: str | None
    head_branch: str | None
    base_branch: str | None
    base_sha: str | None
    changed_files_count: int
    additions: int
    deletions: int
    commits_count: int


@dataclass(frozen=True)
class PrReviewChangedFileInput:
    file_path: str
    previous_file_path: str | None
    file_name: str
    file_status: str
    additions: int
    deletions: int
    is_binary: bool
    is_large_diff: bool
    patch: str | None


@dataclass(frozen=True)
class PrReviewAnalysisInput:
    job: PrReviewAnalysisJob
    pull_request: PrReviewPullRequestInput
    files: tuple[PrReviewChangedFileInput, ...]
    semantic_graph: SemanticGraphInput | None = None


@dataclass(frozen=True)
class PrReviewAnalysisFileResult:
    file_path: str
    file_role: str
    risk_level: str
    change_reason: str
    change_summary: str
    review_points: tuple[str, ...]


@dataclass(frozen=True)
class PrReviewAnalysisResult:
    pr_purpose: str
    change_summary: tuple[str, ...]
    recommended_review_order: str
    caution_points: tuple[str, ...]
    flow_title: str
    flow_description: str
    files: tuple[PrReviewAnalysisFileResult, ...]
    semantic_graph: SemanticGraphOutput | None = None


@dataclass(frozen=True)
class PrReviewAnalysisProcessResult:
    delete_message: bool
    reason: str
    job_id: str | None = None


class PrReviewAnalysisHandoffClient(Protocol):
    def get_input(self, job: PrReviewAnalysisJob) -> PrReviewAnalysisInput: ...

    def submit_result(
        self,
        job: PrReviewAnalysisJob,
        analysis: PrReviewAnalysisResult,
    ) -> None: ...

    def submit_failure(self, job: PrReviewAnalysisJob, code: str) -> None: ...


class PrReviewAnalysisClient(Protocol):
    def analyze(self, input_value: PrReviewAnalysisInput) -> PrReviewAnalysisResult: ...


def parse_pr_review_analysis_job_payload(payload: dict[str, object]) -> PrReviewAnalysisJob:
    if payload.get("jobType") != PR_REVIEW_ANALYSIS_JOB_TYPE:
        raise ValueError("Invalid PR Review job type")
    if payload.get("schemaVersion") != PR_REVIEW_ANALYSIS_SCHEMA_VERSION:
        raise ValueError("Invalid PR Review job schema version")

    return PrReviewAnalysisJob(
        job_id=_require_uuid_string(payload, "jobId"),
        review_session_id=_require_uuid_string(payload, "reviewSessionId"),
        workspace_id=_require_uuid_string(payload, "workspaceId"),
        head_sha=_require_non_empty_string(payload, "headSha", max_length=255),
    )


class PrReviewAnalysisProcessor:
    def __init__(
        self,
        handoff_client: PrReviewAnalysisHandoffClient,
        analysis_client: PrReviewAnalysisClient,
    ) -> None:
        self.handoff_client = handoff_client
        self.analysis_client = analysis_client

    def process_payload(self, payload: dict[str, object]) -> PrReviewAnalysisProcessResult:
        try:
            job = parse_pr_review_analysis_job_payload(payload)
        except ValueError:
            return PrReviewAnalysisProcessResult(
                delete_message=True,
                reason="invalid_pr_review_analysis_job",
            )

        LOGGER.info(
            "pr_review_analysis_started job_id=%s review_session_id=%s",
            job.job_id,
            job.review_session_id,
        )

        try:
            input_value = self.handoff_client.get_input(job)
            analysis = self.analysis_client.analyze(input_value)
            self.handoff_client.submit_result(job, analysis)
        except PrReviewAnalysisInputError:
            return self._submit_terminal_failure(
                job,
                code="ANALYSIS_INPUT_INVALID",
                reason="pr_review_analysis_input_invalid",
            )
        except PrReviewAnalysisOutputError:
            return self._submit_terminal_failure(
                job,
                code="ANALYSIS_INPUT_INVALID",
                reason="pr_review_analysis_output_invalid",
            )
        except PrReviewAnalysisProviderError:
            return self._submit_terminal_failure(
                job,
                code="ANALYSIS_PROVIDER_FAILED",
                reason="pr_review_analysis_provider_failed",
            )
        except PrReviewAnalysisStaleError:
            return self._submit_terminal_failure(
                job,
                code="PR_HEAD_CHANGED",
                reason="pr_review_analysis_head_changed",
            )
        except InfrastructureError:
            return self._result(job, delete_message=False, reason="infrastructure_failure")

        return self._result(job, delete_message=True, reason="pr_review_analysis_completed")

    def terminalize_retry_exhaustion(self, message_body: str) -> bool:
        try:
            payload = json.loads(message_body)
        except json.JSONDecodeError:
            return True

        if not isinstance(payload, dict):
            return True

        try:
            job = parse_pr_review_analysis_job_payload(payload)
        except ValueError:
            return True

        try:
            self.handoff_client.submit_failure(job, "ANALYSIS_PROVIDER_FAILED")
        except PrReviewAnalysisInputError:
            return True
        except InfrastructureError:
            return False

        return True

    def _submit_terminal_failure(
        self,
        job: PrReviewAnalysisJob,
        *,
        code: str,
        reason: str,
    ) -> PrReviewAnalysisProcessResult:
        try:
            self.handoff_client.submit_failure(job, code)
        except PrReviewAnalysisInputError:
            return self._result(job, delete_message=True, reason=reason)
        except InfrastructureError:
            return self._result(job, delete_message=False, reason="infrastructure_failure")

        return self._result(job, delete_message=True, reason=reason)

    @staticmethod
    def _result(
        job: PrReviewAnalysisJob,
        *,
        delete_message: bool,
        reason: str,
    ) -> PrReviewAnalysisProcessResult:
        LOGGER.info(
            "pr_review_analysis_finished job_id=%s review_session_id=%s "
            "reason=%s delete_message=%s",
            job.job_id,
            job.review_session_id,
            reason,
            delete_message,
        )
        return PrReviewAnalysisProcessResult(
            delete_message=delete_message,
            reason=reason,
            job_id=job.job_id,
        )


class HttpPrReviewAnalysisHandoffClient:
    def __init__(self, base_url: str, token: str, timeout_seconds: int) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout_seconds = timeout_seconds

    def get_input(self, job: PrReviewAnalysisJob) -> PrReviewAnalysisInput:
        body = self._request_json(f"/api/v1/internal/pr-review/analysis-jobs/{job.job_id}/input")
        try:
            return parse_pr_review_analysis_input_payload(body, job)
        except ValueError as error:
            raise PrReviewAnalysisInputError("PR Review analysis input is invalid") from error

    def submit_result(
        self,
        job: PrReviewAnalysisJob,
        analysis: PrReviewAnalysisResult,
    ) -> None:
        payload = {
            "jobId": job.job_id,
            "reviewSessionId": job.review_session_id,
            "workspaceId": job.workspace_id,
            "headSha": job.head_sha,
            "analysis": _serialize_analysis_result(analysis),
        }
        self._request_json(
            f"/api/v1/internal/pr-review/analysis-jobs/{job.job_id}/result",
            payload,
        )

    def submit_failure(self, job: PrReviewAnalysisJob, code: str) -> None:
        payload = {
            "jobId": job.job_id,
            "reviewSessionId": job.review_session_id,
            "workspaceId": job.workspace_id,
            "headSha": job.head_sha,
            "code": code,
        }
        self._request_json(
            f"/api/v1/internal/pr-review/analysis-jobs/{job.job_id}/failure",
            payload,
        )

    def _request_json(self, path: str, payload: dict[str, object] | None = None) -> object:
        request = Request(
            f"{self.base_url}{path}",
            data=None if payload is None else json.dumps(payload).encode("utf-8"),
            headers={
                "X-Pr-Review-Analysis-Worker-Token": self.token,
                **({"Content-Type": "application/json"} if payload is not None else {}),
            },
            method="GET" if payload is None else "POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw_body = response.read().decode("utf-8")
        except HTTPError as error:
            if payload is None and error.code == 409:
                raise PrReviewAnalysisStaleError("PR Review analysis input is stale") from error
            if error.code in {400, 404, 409}:
                raise PrReviewAnalysisInputError(
                    "PR Review analysis handoff rejected the request"
                ) from error
            raise InfrastructureError("PR Review analysis handoff failed") from error
        except (OSError, TimeoutError, URLError) as error:
            raise InfrastructureError("PR Review analysis handoff is unavailable") from error

        if not raw_body:
            return None
        try:
            return json.loads(raw_body)
        except json.JSONDecodeError as error:
            raise InfrastructureError("PR Review analysis handoff returned invalid JSON") from error


class OpenAiPrReviewAnalysisClient:
    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        from openai import OpenAI

        self.client = OpenAI(api_key=api_key, timeout=timeout_seconds)
        self.model = model

    def analyze(self, input_value: PrReviewAnalysisInput) -> PrReviewAnalysisResult:
        try:
            response = self.client.responses.create(
                model=self.model,
                input=[
                    {
                        "role": "system",
                        "content": PR_REVIEW_SYSTEM_PROMPT,
                    },
                    {
                        "role": "user",
                        "content": json.dumps(_build_prompt_input(input_value)),
                    },
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "pr_review_analysis",
                        "strict": True,
                        "schema": _pr_review_analysis_schema(
                            include_semantic_graph=input_value.semantic_graph is not None
                        ),
                    }
                },
            )
        except _openai_retryable_errors() as error:
            raise InfrastructureError("OpenAI PR Review analysis retryable failure") from error
        except Exception as error:
            raise PrReviewAnalysisProviderError("OpenAI PR Review analysis failed") from error

        output_text = _extract_response_text(response)
        try:
            return parse_pr_review_analysis_output(
                output_text,
                input_value.files,
                input_value.semantic_graph,
            )
        except ValueError as error:
            raise PrReviewAnalysisOutputError(
                "OpenAI PR Review analysis output is invalid"
            ) from error


def parse_pr_review_analysis_input_payload(
    payload: object,
    expected_job: PrReviewAnalysisJob,
) -> PrReviewAnalysisInput:
    data = _read_success_data(payload)
    if not isinstance(data, dict):
        raise ValueError("Missing handoff data")

    if _require_uuid_string(data, "jobId") != expected_job.job_id:
        raise ValueError("Mismatched job id")
    if _require_uuid_string(data, "reviewSessionId") != expected_job.review_session_id:
        raise ValueError("Mismatched review session id")
    if _require_uuid_string(data, "workspaceId") != expected_job.workspace_id:
        raise ValueError("Mismatched workspace id")
    if _require_non_empty_string(data, "headSha", max_length=255) != expected_job.head_sha:
        raise ValueError("Mismatched head SHA")

    pull_request = _parse_pull_request(data.get("pullRequest"))
    files_value = data.get("files")
    if not isinstance(files_value, list):
        raise ValueError("Invalid files")
    files = tuple(_parse_changed_file(item) for item in files_value)
    paths = [file.file_path for file in files]
    if len(paths) != len(set(paths)):
        raise ValueError("Duplicate input file path")
    semantic_graph = parse_semantic_graph_input(data, set(paths))

    return PrReviewAnalysisInput(
        job=expected_job,
        pull_request=pull_request,
        files=files,
        semantic_graph=semantic_graph,
    )


def parse_pr_review_analysis_output(
    output_text: str,
    input_files: Iterable[PrReviewChangedFileInput],
    semantic_graph_input: SemanticGraphInput | None = None,
) -> PrReviewAnalysisResult:
    try:
        value = json.loads(output_text)
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError("Analysis output must be JSON") from error
    if not isinstance(value, dict):
        raise ValueError("Analysis output must be an object")

    files_by_path = {file.file_path: file for file in input_files}
    raw_files = value.get("files")
    if not isinstance(raw_files, list) or len(raw_files) != len(files_by_path):
        raise ValueError("Analysis output files do not match input files")

    normalized_files: list[PrReviewAnalysisFileResult] = []
    seen_paths: set[str] = set()
    for item in raw_files:
        if not isinstance(item, dict):
            raise ValueError("Invalid analysis output file")
        file_path = _require_non_empty_string(item, "filePath")
        if file_path not in files_by_path or file_path in seen_paths:
            raise ValueError("Unknown or duplicate analysis output file")
        seen_paths.add(file_path)
        risk_level = _require_non_empty_string(item, "riskLevel")
        if risk_level not in PR_REVIEW_RISK_LEVELS:
            raise ValueError("Invalid analysis risk level")
        normalized_files.append(
            PrReviewAnalysisFileResult(
                file_path=file_path,
                file_role=_require_non_empty_string(item, "fileRole"),
                risk_level=risk_level,
                change_reason=_require_non_empty_string(item, "changeReason"),
                change_summary=_require_non_empty_string(item, "changeSummary"),
                review_points=_require_string_list(item, "reviewPoints", allow_empty=False),
            )
        )

    if seen_paths != set(files_by_path):
        raise ValueError("Analysis output omitted an input file")

    try:
        semantic_graph = parse_semantic_graph_output(value, semantic_graph_input)
    except ValueError as error:
        LOGGER.warning(
            "pr_review_semantic_graph_fallback category=%s",
            semantic_graph_output_error_category(error),
        )
        semantic_graph = None

    return PrReviewAnalysisResult(
        pr_purpose=_require_non_empty_string(value, "prPurpose"),
        change_summary=_require_string_list(value, "changeSummary", allow_empty=False),
        recommended_review_order=_require_non_empty_string(value, "recommendedReviewOrder"),
        caution_points=_require_string_list(value, "cautionPoints", allow_empty=False),
        flow_title=_require_non_empty_string(value, "flowTitle"),
        flow_description=_require_non_empty_string(value, "flowDescription"),
        files=tuple(normalized_files),
        semantic_graph=semantic_graph,
    )


def _parse_pull_request(value: object) -> PrReviewPullRequestInput:
    if not isinstance(value, dict):
        raise ValueError("Invalid pull request")
    return PrReviewPullRequestInput(
        pr_number=_require_non_negative_int(value, "prNumber"),
        title=_require_non_empty_string(value, "title"),
        body=_read_optional_string(value, "body"),
        state=_require_one_of(value, "state", {"open", "closed"}),
        draft=_require_bool(value, "draft"),
        mergeable=_read_optional_bool(value, "mergeable"),
        author_login=_read_optional_string(value, "authorLogin"),
        head_branch=_read_optional_string(value, "headBranch"),
        base_branch=_read_optional_string(value, "baseBranch"),
        base_sha=_read_optional_string(value, "baseSha"),
        changed_files_count=_require_non_negative_int(value, "changedFilesCount"),
        additions=_require_non_negative_int(value, "additions"),
        deletions=_require_non_negative_int(value, "deletions"),
        commits_count=_require_non_negative_int(value, "commitsCount"),
    )


def _parse_changed_file(value: object) -> PrReviewChangedFileInput:
    if not isinstance(value, dict):
        raise ValueError("Invalid changed file")
    return PrReviewChangedFileInput(
        file_path=_require_non_empty_string(value, "filePath"),
        previous_file_path=_read_optional_string(value, "previousFilePath"),
        file_name=_require_non_empty_string(value, "fileName"),
        file_status=_require_one_of(
            value,
            "fileStatus",
            {"added", "modified", "deleted", "renamed"},
        ),
        additions=_require_non_negative_int(value, "additions"),
        deletions=_require_non_negative_int(value, "deletions"),
        is_binary=_require_bool(value, "isBinary"),
        is_large_diff=_require_bool(value, "isLargeDiff"),
        patch=_read_optional_string(value, "patch"),
    )


def _build_prompt_input(input_value: PrReviewAnalysisInput) -> dict[str, object]:
    remaining_patch_chars = MAX_TOTAL_PATCH_CHARS
    files: list[dict[str, object]] = []
    for index, file in enumerate(input_value.files):
        patch_snippet = _take_patch_snippet(file.patch, remaining_patch_chars)
        if patch_snippet is not None:
            remaining_patch_chars -= len(patch_snippet)
        files.append(
            {
                "order": index + 1,
                "filePath": file.file_path,
                "previousFilePath": file.previous_file_path,
                "fileName": file.file_name,
                "fileStatus": file.file_status,
                "additions": file.additions,
                "deletions": file.deletions,
                "isBinary": file.is_binary,
                "isLargeDiff": file.is_large_diff,
                "patchSnippet": patch_snippet,
                "patchOmitted": (
                    "patch_unavailable"
                    if patch_snippet is None and file.patch is None
                    else "patch_budget_exhausted" if patch_snippet is None else None
                ),
            }
        )

    pull_request = input_value.pull_request
    prompt: dict[str, object] = {
        "task": (
            "Analyze this pull request for an MVP PR review workflow. Keep every file in the "
            "response and match each file by filePath."
        ),
        "riskLevelGuidance": RISK_LEVEL_GUIDANCE,
        "pullRequest": {
            "number": pull_request.pr_number,
            "title": pull_request.title,
            "body": _truncate_text(pull_request.body, MAX_PR_BODY_CHARS),
            "state": pull_request.state,
            "draft": pull_request.draft,
            "mergeable": pull_request.mergeable,
            "authorLogin": pull_request.author_login,
            "headBranch": pull_request.head_branch,
            "baseBranch": pull_request.base_branch,
            "headSha": input_value.job.head_sha,
            "baseSha": pull_request.base_sha,
            "changedFilesCount": pull_request.changed_files_count,
            "additions": pull_request.additions,
            "deletions": pull_request.deletions,
            "commitsCount": pull_request.commits_count,
        },
        "files": files,
    }
    if input_value.semantic_graph is not None:
        prompt["semanticGraph"] = semantic_graph_prompt_input(input_value.semantic_graph)
    return prompt


def _pr_review_analysis_schema(*, include_semantic_graph: bool = False) -> dict[str, object]:
    required = [
        "prPurpose",
        "changeSummary",
        "recommendedReviewOrder",
        "cautionPoints",
        "flowTitle",
        "flowDescription",
        "files",
    ]
    properties: dict[str, object] = {
        "prPurpose": {"type": "string"},
        "changeSummary": {"type": "array", "items": {"type": "string"}},
        "recommendedReviewOrder": {"type": "string"},
        "cautionPoints": {"type": "array", "items": {"type": "string"}},
        "flowTitle": {"type": "string"},
        "flowDescription": {"type": "string"},
        "files": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "filePath",
                    "fileRole",
                    "riskLevel",
                    "changeReason",
                    "changeSummary",
                    "reviewPoints",
                ],
                "properties": {
                    "filePath": {"type": "string"},
                    "fileRole": {"type": "string"},
                    "riskLevel": {
                        "type": "string",
                        "enum": ["high", "medium", "low", "unknown"],
                    },
                    "changeReason": {"type": "string"},
                    "changeSummary": {"type": "string"},
                    "reviewPoints": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
            },
        },
    }
    if include_semantic_graph:
        required.extend(["graphSchemaVersion", "semanticGraph"])
        properties["graphSchemaVersion"] = {
            "type": "string",
            "enum": [PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION],
        }
        properties["semanticGraph"] = semantic_graph_output_schema()

    return {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": properties,
    }


def _serialize_analysis_result(analysis: PrReviewAnalysisResult) -> dict[str, object]:
    result: dict[str, object] = {
        "prPurpose": analysis.pr_purpose,
        "changeSummary": list(analysis.change_summary),
        "recommendedReviewOrder": analysis.recommended_review_order,
        "cautionPoints": list(analysis.caution_points),
        "flowTitle": analysis.flow_title,
        "flowDescription": analysis.flow_description,
        "files": [
            {
                "filePath": file.file_path,
                "fileRole": file.file_role,
                "riskLevel": file.risk_level,
                "changeReason": file.change_reason,
                "changeSummary": file.change_summary,
                "reviewPoints": list(file.review_points),
            }
            for file in analysis.files
        ],
    }
    if analysis.semantic_graph is not None:
        result["graphSchemaVersion"] = PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION
        result["semanticGraph"] = serialize_semantic_graph_output(analysis.semantic_graph)
    return result


def _read_success_data(payload: object) -> object:
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise ValueError("Invalid handoff response")
    return payload.get("data")


def _require_uuid_string(value: dict[str, object], key: str) -> str:
    normalized = _require_non_empty_string(value, key)
    try:
        return str(UUID(normalized))
    except ValueError as error:
        raise ValueError(f"Invalid {key}") from error


def _require_non_empty_string(
    value: dict[str, object],
    key: str,
    *,
    max_length: int | None = None,
) -> str:
    raw_value = value.get(key)
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise ValueError(f"Invalid {key}")
    normalized = raw_value.strip()
    if max_length is not None and len(normalized) > max_length:
        raise ValueError(f"Invalid {key}")
    return normalized


def _require_string_list(
    value: dict[str, object],
    key: str,
    *,
    allow_empty: bool,
) -> tuple[str, ...]:
    raw_value = value.get(key)
    if not isinstance(raw_value, list) or (not allow_empty and not raw_value):
        raise ValueError(f"Invalid {key}")
    values: list[str] = []
    for item in raw_value:
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"Invalid {key}")
        values.append(item.strip())
    return tuple(values)


def _require_non_negative_int(value: dict[str, object], key: str) -> int:
    raw_value = value.get(key)
    if isinstance(raw_value, bool) or not isinstance(raw_value, int) or raw_value < 0:
        raise ValueError(f"Invalid {key}")
    return raw_value


def _require_bool(value: dict[str, object], key: str) -> bool:
    raw_value = value.get(key)
    if not isinstance(raw_value, bool):
        raise ValueError(f"Invalid {key}")
    return raw_value


def _read_optional_bool(value: dict[str, object], key: str) -> bool | None:
    raw_value = value.get(key)
    if raw_value is None:
        return None
    if not isinstance(raw_value, bool):
        raise ValueError(f"Invalid {key}")
    return raw_value


def _read_optional_string(value: dict[str, object], key: str) -> str | None:
    raw_value = value.get(key)
    if raw_value is None:
        return None
    if not isinstance(raw_value, str):
        raise ValueError(f"Invalid {key}")
    return raw_value


def _require_one_of(value: dict[str, object], key: str, allowed: set[str]) -> str:
    raw_value = _require_non_empty_string(value, key)
    if raw_value not in allowed:
        raise ValueError(f"Invalid {key}")
    return raw_value


def _truncate_text(value: str | None, max_chars: int) -> str | None:
    if value is None:
        return None
    return value[:max_chars]


def _take_patch_snippet(patch: str | None, remaining_chars: int) -> str | None:
    if patch is None or remaining_chars <= 0:
        return None
    return patch[: min(MAX_PATCH_CHARS_PER_FILE, remaining_chars)]


def _extract_response_text(response: object) -> str:
    output_text = getattr(response, "output_text", None)
    if isinstance(output_text, str) and output_text.strip():
        return output_text

    output = getattr(response, "output", None)
    if not isinstance(output, list):
        raise PrReviewAnalysisOutputError("OpenAI PR Review analysis returned no output")

    texts: list[str] = []
    for item in output:
        content = getattr(item, "content", None)
        if not isinstance(content, list):
            continue
        for part in content:
            text = getattr(part, "text", None)
            if isinstance(text, str):
                texts.append(text)
    output_text = "".join(texts)
    if not output_text.strip():
        raise PrReviewAnalysisOutputError("OpenAI PR Review analysis returned no output")
    return output_text


def _openai_retryable_errors() -> tuple[type[BaseException], ...]:
    try:
        from openai import APIConnectionError, APITimeoutError, InternalServerError, RateLimitError
    except Exception:
        return ()

    return (APIConnectionError, APITimeoutError, InternalServerError, RateLimitError)
