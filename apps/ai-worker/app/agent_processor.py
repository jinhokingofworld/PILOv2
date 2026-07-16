from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Protocol
from uuid import UUID
from zoneinfo import ZoneInfo

from app.meeting_report_processor import InfrastructureError

AGENT_RUN_REQUESTED_JOB_TYPE = "agent_run_requested"
AGENT_GROUNDED_ANSWER_REQUESTED_JOB_TYPE = "agent_grounded_answer_requested"
AGENT_TOOL_SCHEMA_VERSION = "agent-tools:v1"
TERMINAL_AGENT_RUN_STATUSES = {"completed", "failed", "cancelled"}
PLANNER_STATUSES = {"tool_candidate", "needs_clarification", "unsupported"}
TOOL_RISK_LEVELS = {"low", "medium", "high"}
TOOL_EXECUTION_MODES = {"auto", "confirmation_required", "contextual"}
MEETING_REPORT_ID_TOOLS = {"get_meeting_report", "summarize_meeting_report"}
FORBIDDEN_JSON_KEY_PARTS = (
    "authorization",
    "cookie",
    "credential",
    "password",
    "providerraw",
    "rawresponse",
    "secret",
    "token",
    "transcript",
    "transcripttext",
)


@dataclass(frozen=True)
class AgentRunJob:
    run_id: str
    workspace_id: str
    requested_by_user_id: str
    tool_schema_version: str
    tools: tuple[AgentToolSchema, ...]
    request_context: dict[str, str] | None = None


@dataclass(frozen=True)
class AgentToolSchema:
    name: str
    description: str
    risk_level: str
    execution_mode: str
    input_schema: dict[str, object]


@dataclass(frozen=True)
class AgentRunContext:
    run_id: str
    workspace_id: str
    requested_by_user_id: str
    status: str
    prompt: str
    timezone: str


@dataclass(frozen=True)
class AgentPlanningRequest:
    run_id: str
    prompt: str
    timezone: str
    current_date: str
    tool_schema_version: str
    tools: tuple[AgentToolSchema, ...]


@dataclass(frozen=True)
class AgentPlannerDecision:
    status: str
    message: str
    final_answer_draft: str | None
    tool_name: str | None
    tool_input: dict[str, object]
    requires_confirmation: bool | None
    missing_fields: tuple[str, ...]
    unsupported_reason: str | None


@dataclass(frozen=True)
class NormalizedPlannerDecision:
    status: str
    message: str
    final_answer: str
    output_summary: dict[str, object]
    risk_level: str | None


@dataclass(frozen=True)
class AgentProcessResult:
    delete_message: bool
    reason: str
    run_id: str | None = None


class AgentGroundedAnswerProcessor:
    """Keeps transcript text in-memory: only App Server internal HTTPS carries it."""

    def __init__(
        self, handoff_client: object, api_key: str, model: str, timeout_seconds: float
    ) -> None:
        self.handoff_client = handoff_client
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds

    def process_payload(self, payload: dict[str, object]) -> AgentProcessResult:
        if payload.get("jobType") != AGENT_GROUNDED_ANSWER_REQUESTED_JOB_TYPE:
            return AgentProcessResult(True, "invalid_grounded_answer_job")
        run_id = payload.get("runId")
        if not isinstance(run_id, str):
            return AgentProcessResult(True, "invalid_grounded_answer_job")
        try:
            context = self.handoff_client.get_grounding_context(run_id)
            if not context:
                return AgentProcessResult(True, "grounded_answer_not_ready", run_id)
            sources = context.get("sources")
            if not isinstance(sources, list) or not sources:
                self.handoff_client.complete_grounded_answer_without_sources(run_id)
                return AgentProcessResult(True, "grounded_answer_no_sources", run_id)
            answer, citations = self._answer(str(context.get("prompt", "")), sources)
            self.handoff_client.complete_grounded_answer(run_id, answer, citations)
            return AgentProcessResult(True, "grounded_answer_completed", run_id)
        except InfrastructureError:
            return AgentProcessResult(False, "infrastructure_failure", run_id)

    def _answer(self, prompt: str, sources: list[object]) -> tuple[str, list[str]]:
        from openai import OpenAI

        safe_sources = [source for source in sources if isinstance(source, dict)][:5]
        source_text = json.dumps(safe_sources, ensure_ascii=False)
        try:
            response = OpenAI(api_key=self.api_key, timeout=self.timeout_seconds).responses.create(
                model=self.model,
                input=[
                    {
                        "role": "system",
                        "content": (
                            "Answer in Korean using only supplied meeting transcript sources. "
                            "Return JSON with answer and citations (sourceId array). "
                            "Do not invent citations."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(
                            {"question": prompt, "sources": source_text}, ensure_ascii=False
                        ),
                    },
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "grounded_meeting_answer",
                        "strict": True,
                        "schema": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["answer", "citations"],
                            "properties": {
                                "answer": {"type": "string"},
                                "citations": {"type": "array", "items": {"type": "string"}},
                            },
                        },
                    }
                },
            )
        except _openai_retryable_errors() as error:
            raise InfrastructureError("OpenAI grounded answer retryable failure") from error
        except Exception as error:
            raise InfrastructureError("OpenAI grounded answer failed") from error
        text = getattr(response, "output_text", "") or _extract_response_text(response)
        try:
            parsed = json.loads(text)
        except Exception as error:
            raise InfrastructureError("OpenAI grounded answer returned invalid JSON") from error
        answer = parsed.get("answer") if isinstance(parsed, dict) else None
        citations = parsed.get("citations") if isinstance(parsed, dict) else None
        if not isinstance(answer, str) or not answer.strip() or not isinstance(citations, list):
            raise InfrastructureError("OpenAI grounded answer returned invalid payload")
        return answer.strip()[:8000], [item for item in citations if isinstance(item, str)][:5]


class AgentRunRepository(Protocol):
    def try_acquire_run_lock(self, run_id: str) -> bool: ...

    def release_run_lock(self, run_id: str) -> None: ...

    def get_run_context(self, job: AgentRunJob) -> AgentRunContext | None: ...

    def start_planner_step(
        self,
        job: AgentRunJob,
        context: AgentRunContext,
    ) -> str: ...

    def complete_planner_step(
        self,
        run_id: str,
        step_id: str,
        output_summary: dict[str, object],
    ) -> bool: ...

    def fail_planner_step(
        self,
        run_id: str,
        step_id: str,
        error_code: str,
        error_message: str,
    ) -> None: ...

    def complete_run(
        self,
        run_id: str,
        final_answer: str,
        message: str,
        risk_level: str | None,
    ) -> None: ...

    def mark_tool_execution_ready(
        self,
        run_id: str,
        message: str,
        risk_level: str,
    ) -> None: ...

    def mark_failed(
        self,
        run_id: str,
        error_code: str,
        error_message: str,
        message: str,
    ) -> None: ...


class AgentPlannerClient(Protocol):
    def plan(self, request: AgentPlanningRequest) -> AgentPlannerDecision: ...


class AgentExecutionHandoffClient(Protocol):
    def execute(self, run_id: str) -> None: ...


class AgentPlannerOutputError(Exception):
    pass


class AgentExecutionHandoffError(InfrastructureError):
    pass


def parse_agent_run_job_payload(payload: dict[str, object]) -> AgentRunJob:
    if payload.get("jobType") != AGENT_RUN_REQUESTED_JOB_TYPE:
        raise ValueError("Unsupported Agent job type")

    return AgentRunJob(
        run_id=_require_uuid_string(payload, "runId"),
        workspace_id=_require_uuid_string(payload, "workspaceId"),
        requested_by_user_id=_require_uuid_string(payload, "requestedByUserId"),
        tool_schema_version=_require_non_empty_string(payload, "toolSchemaVersion"),
        tools=_parse_tool_schema_snapshot(payload.get("tools")),
        request_context=_parse_request_context(payload.get("requestContext")),
    )


class AgentRunProcessor:
    def __init__(
        self,
        repository: AgentRunRepository,
        planner_client: AgentPlannerClient,
        execution_handoff_client: AgentExecutionHandoffClient,
        current_date_provider: Callable[[str], date] | None = None,
    ) -> None:
        self.repository = repository
        self.planner_client = planner_client
        self.execution_handoff_client = execution_handoff_client
        self.current_date_provider = current_date_provider or _current_date_for_timezone

    def process_payload(self, payload: dict[str, object]) -> AgentProcessResult:
        try:
            job = parse_agent_run_job_payload(payload)
        except ValueError:
            return AgentProcessResult(delete_message=True, reason="invalid_agent_job")

        try:
            return self.process_job(job)
        except AgentExecutionHandoffError:
            return AgentProcessResult(
                delete_message=False,
                reason="agent_execution_handoff_unavailable",
                run_id=job.run_id,
            )
        except InfrastructureError:
            return AgentProcessResult(
                delete_message=False,
                reason="infrastructure_failure",
                run_id=job.run_id,
            )

    def process_job(self, job: AgentRunJob) -> AgentProcessResult:
        lock_acquired = self.repository.try_acquire_run_lock(job.run_id)
        if not lock_acquired:
            return self._result(
                job,
                delete_message=False,
                reason="agent_run_duplicate_in_progress",
            )

        try:
            context = self.repository.get_run_context(job)
            if context is None:
                return self._result(job, delete_message=True, reason="agent_run_not_found")

            status = context.status
            if status in TERMINAL_AGENT_RUN_STATUSES:
                return self._result(job, delete_message=True, reason="terminal_agent_run")

            if status == "waiting_confirmation":
                return self._result(
                    job,
                    delete_message=True,
                    reason="agent_run_waiting_confirmation",
                )

            if status == "running":
                return self._handoff_execution(job, retried=True)

            if status != "planning":
                return self._result(
                    job,
                    delete_message=True,
                    reason="agent_run_unsupported_status",
                )

            return self._plan_run(job, context)
        finally:
            self.repository.release_run_lock(job.run_id)

    def _plan_run(self, job: AgentRunJob, context: AgentRunContext) -> AgentProcessResult:
        step_id: str | None = None
        try:
            step_id = self.repository.start_planner_step(job, context)
            current_date = self.current_date_provider(context.timezone).isoformat()
            decision = self.planner_client.plan(
                AgentPlanningRequest(
                    run_id=job.run_id,
                    prompt=context.prompt,
                    timezone=context.timezone,
                    current_date=current_date,
                    tool_schema_version=job.tool_schema_version,
                    tools=job.tools,
                )
            )
            normalized = normalize_agent_planner_decision(
                decision,
                job,
                prompt=context.prompt,
                current_date=current_date,
            )
            planner_step_completed = self.repository.complete_planner_step(
                job.run_id,
                step_id,
                normalized.output_summary,
            )
            if not planner_step_completed:
                return self._result(
                    job,
                    delete_message=True,
                    reason="agent_planner_step_no_longer_running",
                )
            if normalized.status == "tool_candidate" and normalized.risk_level is not None:
                self.repository.mark_tool_execution_ready(
                    job.run_id,
                    normalized.message,
                    normalized.risk_level,
                )
                return self._handoff_execution(job, retried=False)

            self.repository.complete_run(
                job.run_id,
                normalized.final_answer,
                normalized.message,
                normalized.risk_level,
            )
            return self._result(
                job,
                delete_message=True,
                reason="agent_planning_completed",
            )
        except InfrastructureError:
            raise
        except AgentPlannerOutputError as error:
            self._fail_planning(job, step_id, str(error))
            return self._result(
                job,
                delete_message=True,
                reason="agent_planning_failed",
            )

    def _handoff_execution(
        self,
        job: AgentRunJob,
        *,
        retried: bool,
    ) -> AgentProcessResult:
        try:
            self.execution_handoff_client.execute(job.run_id)
        except InfrastructureError as error:
            raise AgentExecutionHandoffError() from error
        return self._result(
            job,
            delete_message=True,
            reason=(
                "agent_execution_handoff_retried"
                if retried
                else "agent_execution_handoff_completed"
            ),
        )

    def _fail_planning(
        self,
        job: AgentRunJob,
        step_id: str | None,
        safe_message: str,
    ) -> None:
        if step_id:
            self.repository.fail_planner_step(
                job.run_id,
                step_id,
                "AGENT_PLANNER_FAILED",
                safe_message,
            )
        self.repository.mark_failed(
            job.run_id,
            "AGENT_PLANNER_FAILED",
            safe_message,
            "요청을 분석하지 못했습니다. 다시 시도해주세요.",
        )

    def _result(
        self,
        job: AgentRunJob,
        delete_message: bool,
        reason: str,
    ) -> AgentProcessResult:
        return AgentProcessResult(
            delete_message=delete_message,
            reason=reason,
            run_id=job.run_id,
        )


def _require_uuid_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Invalid {key}")

    normalized = value.strip()
    try:
        UUID(normalized)
    except ValueError as error:
        raise ValueError(f"Invalid {key}") from error

    return normalized


def _require_non_empty_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Invalid {key}")
    return value.strip()


def _parse_request_context(value: object) -> dict[str, str] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"surface", "sessionId"}:
        raise ValueError("Invalid requestContext")

    surface = value.get("surface")
    session_id = value.get("sessionId")
    if surface != "sql_erd" or not isinstance(session_id, str):
        raise ValueError("Invalid requestContext")
    try:
        UUID(session_id)
    except (ValueError, AttributeError, TypeError) as error:
        raise ValueError("Invalid requestContext") from error

    return {"surface": "sql_erd", "sessionId": session_id}


def _parse_tool_schema_snapshot(value: object) -> tuple[AgentToolSchema, ...]:
    if not isinstance(value, list):
        raise ValueError("Invalid tools")

    tools: list[AgentToolSchema] = []
    seen_names: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("Invalid tool schema")

        name = _read_tool_string(item, "name")
        if name in seen_names:
            raise ValueError("Duplicate tool schema")
        seen_names.add(name)

        risk_level = _read_tool_string(item, "riskLevel")
        execution_mode = _read_tool_string(item, "executionMode")
        input_schema = item.get("inputSchema")
        if risk_level not in TOOL_RISK_LEVELS:
            raise ValueError("Invalid tool risk level")
        if execution_mode not in TOOL_EXECUTION_MODES:
            raise ValueError("Invalid tool execution mode")
        if not isinstance(input_schema, dict):
            raise ValueError("Invalid tool input schema")

        tools.append(
            AgentToolSchema(
                name=name,
                description=_read_tool_string(item, "description"),
                risk_level=risk_level,
                execution_mode=execution_mode,
                input_schema=dict(input_schema),
            )
        )

    return tuple(tools)


def _read_tool_string(item: dict[object, object], key: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Invalid tool {key}")
    return value.strip()


def normalize_agent_planner_decision(
    decision: AgentPlannerDecision,
    job: AgentRunJob,
    prompt: str = "",
    current_date: str | None = None,
) -> NormalizedPlannerDecision:
    decision = _normalize_calendar_relative_date_query(
        decision,
        job,
        prompt=prompt,
        current_date=current_date,
    )
    status = decision.status
    if status not in PLANNER_STATUSES:
        raise AgentPlannerOutputError("Agent planner returned an invalid status")

    tools_by_name = {tool.name: tool for tool in job.tools}
    message = _safe_text(decision.message, "요청 분석을 완료했습니다.")
    final_answer = _safe_text(decision.final_answer_draft, message)
    tool = tools_by_name.get(decision.tool_name or "")
    missing_fields = tuple(decision.missing_fields)
    unsupported_reason = decision.unsupported_reason

    if status == "tool_candidate" and tool is None:
        status = "unsupported"
        final_answer = "현재 사용할 수 없는 Agent 도구가 필요한 요청입니다."
        message = "지원하지 않는 Agent 도구 요청입니다."

    if status == "tool_candidate" and tool is not None:
        missing_fields = _missing_required_tool_input_fields(tool, decision.tool_input)
        if tool.name == "update_calendar_event":
            missing_fields = _missing_calendar_update_fields(
                decision.tool_input,
                missing_fields,
            )
        if tool.name == "create_calendar_event" and _has_invalid_calendar_create_time_order(
            decision.tool_input
        ):
            missing_fields = tuple(sorted({*missing_fields, "calendar_event_end_time"}))

        if tool.name == "create_calendar_event" and _is_calendar_recurrence_request(prompt):
            status = "unsupported"
            message = "반복 일정 생성은 현재 지원하지 않습니다."
            final_answer = (
                "현재는 반복 일정을 만들 수 없습니다. " "한 번만 생성할 날짜와 시간을 알려주세요."
            )
            unsupported_reason = "calendar_recurrence_unsupported"
        elif tool.name == "create_calendar_event" and _requires_calendar_time_or_all_day(
            decision.tool_input
        ):
            missing_fields = tuple(sorted({*missing_fields, "calendar_event_time_or_all_day"}))

        if tool.name in MEETING_REPORT_ID_TOOLS and not _has_valid_uuid(
            decision.tool_input.get("reportId")
        ):
            status = "unsupported"
            message = "특정 회의록을 식별할 수 없습니다."
            final_answer = (
                "현재 요청에서는 특정 회의록을 선택할 수 없습니다. "
                "최신 회의록의 결과가 필요하면 최신 회의록을 요청해주세요."
            )
            unsupported_reason = "meeting_report_id_required"
        elif status == "tool_candidate" and missing_fields:
            status = "needs_clarification"
            message = "요청을 처리할 정보가 부족합니다."
            final_answer = _clarification_answer(missing_fields)

    output_summary: dict[str, object] = {
        "status": status,
        "message": message,
        "finalAnswerDraft": final_answer,
        "toolSchemaVersion": job.tool_schema_version,
    }
    risk_level: str | None = None

    if status == "tool_candidate" and tool is not None:
        requires_confirmation = (
            None
            if tool.execution_mode == "contextual"
            else tool.execution_mode == "confirmation_required"
        )
        risk_level = tool.risk_level
        output_summary.update(
            {
                "toolName": tool.name,
                "riskLevel": tool.risk_level,
                "executionMode": tool.execution_mode,
                "requiresConfirmation": requires_confirmation,
                "input": _sanitize_json_value(decision.tool_input),
                "toolInputValidation": "app_server_required",
            }
        )
        if not final_answer:
            final_answer = "요청을 처리하기 위한 Agent tool plan을 만들었습니다."
    elif status == "needs_clarification":
        output_summary["missingFields"] = list(missing_fields)
        final_answer = final_answer or "요청을 처리하려면 추가 정보가 필요합니다."
    else:
        output_summary["unsupportedReason"] = unsupported_reason or "unknown_intent"
        final_answer = final_answer or "현재 Agent 1차 범위에서 지원하지 않는 요청입니다."

    return NormalizedPlannerDecision(
        status=status,
        message=message,
        final_answer=final_answer,
        output_summary=output_summary,
        risk_level=risk_level,
    )


def _missing_required_tool_input_fields(
    tool: AgentToolSchema,
    input_value: dict[str, object],
) -> tuple[str, ...]:
    required = tool.input_schema.get("required")
    if not isinstance(required, list):
        return ()

    missing: list[str] = []
    for field in required:
        if not isinstance(field, str) or not field:
            continue
        value = input_value.get(field)
        if value is None or value == "" or value == {}:
            missing.append(field)
    return tuple(missing)


def _missing_calendar_update_fields(
    input_value: dict[str, object],
    missing_fields: tuple[str, ...],
) -> tuple[str, ...]:
    missing = set(missing_fields)
    event_id = input_value.get("eventId")
    if (
        not isinstance(event_id, str)
        or not event_id.isascii()
        or not event_id.isdigit()
        or event_id.startswith("0")
    ):
        missing.add("eventId")

    changes = input_value.get("changes")
    if not isinstance(changes, dict) or not changes:
        missing.add("changes")

    return tuple(sorted(missing))


def _has_valid_uuid(value: object) -> bool:
    if not isinstance(value, str):
        return False

    try:
        parsed = UUID(value)
    except (TypeError, ValueError, AttributeError):
        return False

    return str(parsed) == value.lower()


def _has_invalid_calendar_create_time_order(input_value: dict[str, object]) -> bool:
    start_date = input_value.get("startDate")
    end_date = input_value.get("endDate")
    start_time = input_value.get("startTime")
    end_time = input_value.get("endTime")
    return (
        isinstance(start_date, str)
        and isinstance(end_date, str)
        and start_date == end_date
        and isinstance(start_time, str)
        and isinstance(end_time, str)
        and end_time <= start_time
    )


def _is_calendar_recurrence_request(prompt: str) -> bool:
    return bool(
        re.search(
            r"(?:매일|매주|매월|매년|평일마다|주말마다|반복|[가-힣]+마다)",
            prompt,
        )
    )


def _requires_calendar_time_or_all_day(input_value: dict[str, object]) -> bool:
    start_date = input_value.get("startDate")
    end_date = input_value.get("endDate")
    is_all_day = input_value.get("isAllDay")
    start_time = input_value.get("startTime")
    end_time = input_value.get("endTime")
    return (
        isinstance(start_date, str)
        and isinstance(end_date, str)
        and start_date != end_date
        and not isinstance(is_all_day, bool)
        and start_time is None
        and end_time is None
    )


def _normalize_calendar_relative_date_query(
    decision: AgentPlannerDecision,
    job: AgentRunJob,
    *,
    prompt: str,
    current_date: str | None,
) -> AgentPlannerDecision:
    if current_date is None or not any(tool.name == "list_calendar_events" for tool in job.tools):
        return decision

    date_range = _supported_calendar_relative_date_range(prompt, current_date)
    if date_range is None:
        return decision

    start_date, end_date = date_range
    return AgentPlannerDecision(
        status="tool_candidate",
        message="Calendar 상대 날짜 조회 후보입니다.",
        final_answer_draft="해당 날짜의 일정을 조회합니다.",
        tool_name="list_calendar_events",
        tool_input={"start": start_date.isoformat(), "end": end_date.isoformat()},
        requires_confirmation=False,
        missing_fields=(),
        unsupported_reason=None,
    )


def _supported_calendar_relative_date_range(
    prompt: str,
    current_date: str,
) -> tuple[date, date] | None:
    normalized_prompt = re.sub(r"\s+", " ", prompt).strip()
    try:
        base_date = date.fromisoformat(current_date)
    except ValueError:
        return None

    read_suffix = r"일정(?:을|만)?\s*(?:보여\s*줘|알려\s*줘|조회해\s*줘)[.!?]?"
    if re.fullmatch(rf"이번\s*주말\s*{read_suffix}", normalized_prompt):
        saturday_offset = 6 if base_date.weekday() == 6 else (5 - base_date.weekday()) % 7
        saturday = base_date + timedelta(days=saturday_offset)
        return saturday, saturday + timedelta(days=1)

    if re.fullmatch(
        rf"다음\s*주\s*월요일(?:\s*(?:오전|오후))?\s*{read_suffix}",
        normalized_prompt,
    ):
        monday = _next_weekday(base_date, 0)
        return monday, monday

    if re.fullmatch(
        rf"다다음\s*주\s*화요일(?:\s*(?:오전|오후))?\s*{read_suffix}",
        normalized_prompt,
    ):
        tuesday = _next_weekday(base_date, 1) + timedelta(days=7)
        return tuesday, tuesday

    return None


def _next_weekday(base_date: date, weekday: int) -> date:
    offset = (weekday - base_date.weekday()) % 7
    return base_date + timedelta(days=offset or 7)


def _clarification_answer(missing_fields: tuple[str, ...]) -> str:
    labels = {
        "eventId": "수정할 일정",
        "changes": "변경할 내용",
        "title": "일정 제목",
        "startDate": "시작 날짜",
        "endDate": "종료 날짜",
        "start": "조회 시작일",
        "end": "조회 종료일",
        "calendar_event_end_time": "시작 시각보다 늦은 종료 시각",
        "calendar_event_time_or_all_day": "종일 여부 또는 시작 시각",
    }
    fields = [labels.get(field, field) for field in missing_fields]
    if not fields:
        return "요청을 처리하려면 추가 정보가 필요합니다."
    return f"요청을 처리하려면 {', '.join(fields)} 정보를 알려주세요."


class OpenAiAgentPlannerClient:
    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        from openai import OpenAI

        self.client = OpenAI(api_key=api_key, timeout=timeout_seconds)
        self.model = model

    def plan(self, request: AgentPlanningRequest) -> AgentPlannerDecision:
        try:
            response = self.client.responses.create(
                model=self.model,
                input=[
                    {
                        "role": "system",
                        "content": _agent_planner_system_prompt(),
                    },
                    {
                        "role": "user",
                        "content": _agent_planner_user_prompt(request),
                    },
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "agent_planner_result",
                        "strict": True,
                        "schema": _agent_planner_schema(),
                    }
                },
            )
        except _openai_retryable_errors() as error:
            raise InfrastructureError("OpenAI Agent planner retryable failure") from error
        except Exception as error:
            raise AgentPlannerOutputError("Agent planner provider failure") from error

        output_text = getattr(response, "output_text", None)
        if not isinstance(output_text, str) or not output_text.strip():
            output_text = _extract_response_text(response)

        return parse_agent_planner_output(output_text)


def parse_agent_planner_output(output_text: str) -> AgentPlannerDecision:
    if not isinstance(output_text, str) or not output_text.strip():
        raise AgentPlannerOutputError("Agent planner returned no output")

    try:
        payload = json.loads(output_text)
    except json.JSONDecodeError as error:
        raise AgentPlannerOutputError("Agent planner returned invalid JSON") from error

    if not isinstance(payload, dict):
        raise AgentPlannerOutputError("Agent planner output must be an object")

    status = _planner_string(payload, "status")
    message = _planner_string(payload, "message")
    final_answer_draft = _planner_optional_string(payload, "finalAnswerDraft")
    tool_name = _planner_optional_string(payload, "toolName")
    tool_input = _parse_planner_input_json(_planner_optional_string(payload, "inputJson"))
    requires_confirmation = payload.get("requiresConfirmation") is True
    missing_fields = _planner_string_list(payload.get("missingFields"))
    unsupported_reason = _planner_optional_string(payload, "unsupportedReason")

    return AgentPlannerDecision(
        status=status,
        message=message,
        final_answer_draft=final_answer_draft,
        tool_name=tool_name,
        tool_input=tool_input,
        requires_confirmation=requires_confirmation,
        missing_fields=tuple(missing_fields),
        unsupported_reason=unsupported_reason,
    )


def _agent_planner_system_prompt() -> str:
    return (
        "You are the PILO Workspace Agent planner. "
        "Return only JSON that matches the schema. "
        "Choose only tools from the provided tool list. "
        "If no provided tool can handle the request, return unsupported. "
        "High-risk or excluded actions such as delete, PR review submission, "
        "meeting recording control, label, milestone, or due date changes "
        "must be unsupported. "
        "Board assignee changes are allowed only when the provided tool list contains "
        "assign_board_issue_safely; otherwise they must be unsupported. "
        "If required fields are missing, return needs_clarification and ask one concise "
        "question in finalAnswerDraft. "
        "Never invent Board, issue, or column internal IDs; use exact Board names, repository "
        "full names, GitHub issue numbers, and column names required by the registered schema. "
        "Never invent Calendar event IDs or MeetingReport IDs. Calendar updates require "
        "eventId and changes only; the server loads the current values for confirmation. "
        "For a broad MeetingReport request without a report ID, use list_meeting_reports "
        "with limit 1 to return the latest report. A specific MeetingReport detail or "
        "summary request without a valid report ID must be unsupported. "
        "Calendar list_calendar_events supports only a date range; title, keyword, participant, "
        "or current-time filters are not supported and must be unsupported rather than ignored. "
        "Calendar recurrence is not supported and must be unsupported rather than converted to a "
        "single event. For multi-day Calendar creation without times, require an explicit "
        "all-day choice rather than inferring isAllDay. "
        "For timed Calendar creation, omit endTime when the user gives only a start time so the "
        "Calendar default can apply; never set endTime equal to startTime. "
        "When the user supplies a positive integer Calendar event ID with changes, use it and let "
        "the App Server verify that the event exists in the Workspace. "
        "Normalize relative dates using the provided timezone and currentDate. For Korean week "
        "phrases, '이번 주말' means the nearest Saturday-Sunday that is not fully past: include "
        "the current Saturday, but on Sunday use the following weekend. '다음 주 월요일' means "
        "the immediately upcoming Monday, using the Monday seven days later when currentDate is "
        "Monday. '다다음 주 화요일' means one week after the immediately upcoming Tuesday. For "
        "currentDate 2026-07-12, use 2026-07-18 through 2026-07-19 for '이번 주말', 2026-07-13 "
        "for '다음 주 월요일', and 2026-07-21 for '다다음 주 화요일'. "
        "Use YYYY-MM-DD dates and HH:mm 24-hour times in tool inputs. "
        "Write message and finalAnswerDraft in Korean. "
        "Put the selected tool input object into inputJson as a compact JSON string. "
        "Use null inputJson when there is no tool input. "
        "Never include provider raw responses, tokens, secrets, credentials, cookies, "
        "authorization headers, or long transcripts."
    )


def _agent_planner_user_prompt(request: AgentPlanningRequest) -> str:
    tools = [
        {
            "name": tool.name,
            "description": tool.description,
            "riskLevel": tool.risk_level,
            "executionMode": tool.execution_mode,
            "inputSchema": tool.input_schema,
        }
        for tool in request.tools
    ]
    return json.dumps(
        {
            "runId": request.run_id,
            "timezone": request.timezone,
            "currentDate": request.current_date,
            "toolSchemaVersion": request.tool_schema_version,
            "tools": tools,
            "prompt": request.prompt,
        },
        ensure_ascii=False,
    )


def _agent_planner_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "status",
            "message",
            "finalAnswerDraft",
            "toolName",
            "inputJson",
            "requiresConfirmation",
            "missingFields",
            "unsupportedReason",
        ],
        "properties": {
            "status": {
                "type": "string",
                "enum": ["tool_candidate", "needs_clarification", "unsupported"],
            },
            "message": {"type": "string"},
            "finalAnswerDraft": {"type": ["string", "null"]},
            "toolName": {"type": ["string", "null"]},
            "inputJson": {"type": ["string", "null"]},
            "requiresConfirmation": {"type": "boolean"},
            "missingFields": {
                "type": "array",
                "items": {"type": "string"},
            },
            "unsupportedReason": {"type": ["string", "null"]},
        },
    }


def _safe_text(value: str | None, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()[:1000]
    return fallback


def _planner_string(payload: dict[object, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise AgentPlannerOutputError(f"Agent planner field is invalid: {key}")
    return value.strip()


def _planner_optional_string(payload: dict[object, object], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise AgentPlannerOutputError(f"Agent planner field is invalid: {key}")
    normalized = value.strip()
    return normalized or None


def _planner_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _parse_planner_input_json(value: str | None) -> dict[str, object]:
    if value is None:
        return {}

    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise AgentPlannerOutputError("Agent planner inputJson must be valid JSON") from error

    if not isinstance(parsed, dict):
        raise AgentPlannerOutputError("Agent planner inputJson must be a JSON object")

    return _sanitize_json_value(parsed)


def _sanitize_json_value(value: object) -> dict[str, object]:
    sanitized = _sanitize_any_json_value(value)
    if isinstance(sanitized, dict):
        return sanitized
    return {}


def _current_date_for_timezone(timezone: str) -> date:
    try:
        return datetime.now(ZoneInfo(timezone)).date()
    except Exception as error:
        raise AgentPlannerOutputError("Agent run timezone is invalid") from error


def _sanitize_any_json_value(value: object) -> object:
    if isinstance(value, dict):
        result: dict[str, object] = {}
        for key, item in value.items():
            if not isinstance(key, str) or _is_forbidden_json_key(key):
                continue
            result[key] = _sanitize_any_json_value(item)
        return result
    if isinstance(value, list):
        return [_sanitize_any_json_value(item) for item in value[:100]]
    if isinstance(value, str):
        return value[:2000]
    if isinstance(value, int | float | bool) or value is None:
        return value
    return None


def _is_forbidden_json_key(key: str) -> bool:
    normalized = key.replace("_", "").replace("-", "").lower()
    return any(part in normalized for part in FORBIDDEN_JSON_KEY_PARTS)


def _openai_retryable_errors() -> tuple[type[BaseException], ...]:
    try:
        from openai import APIConnectionError, APITimeoutError, InternalServerError, RateLimitError
    except Exception:
        return ()

    return (APIConnectionError, APITimeoutError, InternalServerError, RateLimitError)


def _extract_response_text(response: object) -> str:
    output = getattr(response, "output", None)
    if not isinstance(output, list):
        return ""

    texts: list[str] = []
    for item in output:
        content = getattr(item, "content", None)
        if not isinstance(content, list):
            continue
        for part in content:
            text = getattr(part, "text", None)
            if isinstance(text, str):
                texts.append(text)

    return "".join(texts)
