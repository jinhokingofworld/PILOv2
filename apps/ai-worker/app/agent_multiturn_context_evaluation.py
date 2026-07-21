from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import date
from pathlib import Path
from types import MappingProxyType

from app.agent_outcome_judge import (
    MultiTurnJudgeClient,
    MultiTurnJudgeEvidence,
    judge_multiturn_context,
)
from app.agent_processor import (
    AgentPlannerClient,
    AgentRouterClient,
    AgentRunContext,
    AgentRunJob,
    AgentRunProcessor,
)

type FrozenJson = (
    None | bool | int | float | str | tuple[FrozenJson, ...] | Mapping[str, FrozenJson]
)


@dataclass(frozen=True)
class ExpectedContext:
    reference_kind: str
    context_ref: str | None
    constraints: Mapping[str, FrozenJson]


@dataclass(frozen=True)
class MultiTurnToolFixture:
    tool: str
    output: Mapping[str, FrozenJson]


@dataclass(frozen=True)
class ExpectedOutcome:
    delivery_required: bool
    expected_facts: tuple[str, ...]


@dataclass(frozen=True)
class MultiTurnTurn:
    user: str
    expected_tools: tuple[str, ...]
    expected_context: ExpectedContext
    fixtures: tuple[MultiTurnToolFixture, ...]
    expected_outcome: ExpectedOutcome


@dataclass(frozen=True)
class MultiTurnConversation:
    conversation_id: str
    turns: tuple[MultiTurnTurn, ...]
    context_surface: str | None = None


@dataclass(frozen=True)
class MultiTurnCatalog:
    version: str
    conversations: tuple[MultiTurnConversation, ...]


@dataclass(frozen=True)
class MultiTurnEvaluationToolCall:
    turn_index: int
    tool_name: str
    tool_input: Mapping[str, FrozenJson]


@dataclass(frozen=True)
class MultiTurnEvaluationResult:
    conversation_id: str
    attempt: int
    deterministic_context_passed: bool
    deterministic_continuation_passed: bool
    failure_reasons: tuple[str, ...]
    judge_verdict: str | None = None
    judge_failure_codes: tuple[str, ...] = ()
    judge_context_resolved: bool | None = None
    judge_follow_up_delivered: bool | None = None
    tool_selection_passed: bool = False
    expected_tool_sequence: tuple[str, ...] = ()
    executed_tool_sequence: tuple[str, ...] = ()


def load_multiturn_catalog(catalog_path: Path) -> MultiTurnCatalog:
    try:
        payload = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as error:
        raise ValueError("Multi-turn catalog must contain valid JSON") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("version"), str):
        raise ValueError("Multi-turn catalog version is required")
    raw_conversations = payload.get("conversations")
    if not isinstance(raw_conversations, list) or not raw_conversations:
        raise ValueError("Multi-turn catalog conversations are required")

    conversations: list[MultiTurnConversation] = []
    for raw_conversation in raw_conversations:
        if not isinstance(raw_conversation, dict):
            raise ValueError("Multi-turn conversation must be an object")
        conversation_id = raw_conversation.get("id")
        context_surface = raw_conversation.get("contextSurface")
        raw_turns = raw_conversation.get("turns")
        if not isinstance(conversation_id, str) or not conversation_id.strip():
            raise ValueError("Multi-turn conversation id is required")
        if context_surface is not None and context_surface not in {"sql_erd", "pr_review"}:
            raise ValueError("Multi-turn contextSurface is invalid")
        if not isinstance(raw_turns, list) or len(raw_turns) < 2:
            raise ValueError("Multi-turn conversation requires at least two turns")
        turns: list[MultiTurnTurn] = []
        for index, raw_turn in enumerate(raw_turns):
            if not isinstance(raw_turn, dict):
                raise ValueError("Multi-turn turn must be an object")
            user = raw_turn.get("user")
            expected_tools = raw_turn.get("expectedTools")
            if not isinstance(user, str) or not user.strip():
                raise ValueError("Multi-turn turn user is required")
            if (
                not isinstance(expected_tools, list)
                or not expected_tools
                or not all(isinstance(tool, str) and tool.strip() for tool in expected_tools)
            ):
                raise ValueError("Multi-turn expectedTools are required")
            expected_context = _load_expected_context(raw_turn, index)
            fixtures = _load_fixtures(raw_turn)
            expected_outcome = _load_expected_outcome(raw_turn)
            turns.append(
                MultiTurnTurn(
                    user=user.strip(),
                    expected_tools=tuple(tool.strip() for tool in expected_tools),
                    expected_context=expected_context,
                    fixtures=fixtures,
                    expected_outcome=expected_outcome,
                )
            )
        conversations.append(
            MultiTurnConversation(conversation_id.strip(), tuple(turns), context_surface)
        )
    if len({conversation.conversation_id for conversation in conversations}) != len(conversations):
        raise ValueError("Multi-turn conversation ids must be unique")
    return MultiTurnCatalog(payload["version"].strip(), tuple(conversations))


def evaluate_deterministic_continuation(
    conversation: MultiTurnConversation,
    tool_calls: tuple[MultiTurnEvaluationToolCall, ...],
    *,
    attempt: int = 1,
) -> MultiTurnEvaluationResult:
    failure_reasons: list[str] = []
    expected_tool_sequence = tuple(
        tool_name for turn in conversation.turns for tool_name in turn.expected_tools
    )
    executed_tool_sequence = tuple(call.tool_name for call in tool_calls)
    calls_by_turn: dict[int, list[MultiTurnEvaluationToolCall]] = {}
    for call in tool_calls:
        calls_by_turn.setdefault(call.turn_index, []).append(call)
    tool_selection_passed = not any(
        turn_index < 0 or turn_index >= len(conversation.turns) for turn_index in calls_by_turn
    ) and all(
        tuple(call.tool_name for call in calls_by_turn.get(turn_index, ())) == turn.expected_tools
        for turn_index, turn in enumerate(conversation.turns)
    )

    for turn_index, turn in enumerate(conversation.turns):
        calls = calls_by_turn.get(turn_index, [])
        actual_tools = tuple(call.tool_name for call in calls)
        if actual_tools != turn.expected_tools:
            failure_reasons.append(
                "unexpected_tool"
                if set(actual_tools) - set(turn.expected_tools)
                else "tool_sequence"
            )
            continue
        if turn_index == 0:
            continue
        if turn.expected_context.reference_kind == "prior_context_ref":
            context_ref = turn.expected_context.context_ref
            if context_ref is None or not all(
                _contains_context_reference(call.tool_input, context_ref) for call in calls
            ):
                failure_reasons.append("context_reference")
                continue
        if not all(
            _contains_mapping(call.tool_input, turn.expected_context.constraints) for call in calls
        ):
            failure_reasons.append("context_constraints")

    unique_failure_reasons = tuple(dict.fromkeys(failure_reasons))
    return MultiTurnEvaluationResult(
        conversation_id=conversation.conversation_id,
        attempt=attempt,
        deterministic_context_passed=tool_selection_passed
        and not any(
            reason in {"context_reference", "context_constraints"}
            for reason in unique_failure_reasons
        ),
        deterministic_continuation_passed=not unique_failure_reasons,
        failure_reasons=unique_failure_reasons,
        tool_selection_passed=tool_selection_passed,
        expected_tool_sequence=expected_tool_sequence,
        executed_tool_sequence=executed_tool_sequence,
    )


def validate_multiturn_catalog_against_job(
    conversations: tuple[MultiTurnConversation, ...],
    job: AgentRunJob,
) -> None:
    tools_by_name = {tool.name: tool for tool in job.tools}
    for conversation in conversations:
        if conversation.context_surface not in {None, "sql_erd", "pr_review"}:
            raise ValueError(
                f"Multi-turn catalog has invalid context surface: {conversation.conversation_id}"
            )
        if conversation.context_surface is not None:
            catalog = job.tool_capability_catalog
            if catalog is None:
                raise ValueError(
                    "Multi-turn catalog context surface requires a registry capability catalog: "
                    f"{conversation.conversation_id}"
                )
            descriptors = {descriptor.tool_name: descriptor for descriptor in catalog.descriptors}
            expected_tools = {
                tool_name for turn in conversation.turns for tool_name in turn.expected_tools
            }
            unsupported_tools = sorted(
                tool_name
                for tool_name in expected_tools
                if descriptors.get(tool_name) is None
                or descriptors[tool_name].context_surface != conversation.context_surface
            )
            if unsupported_tools:
                raise ValueError(
                    "Multi-turn catalog context surface is not supported by registered tools: "
                    f"{conversation.conversation_id} {unsupported_tools}"
                )
        for turn_index, turn in enumerate(conversation.turns):
            fixture_sequence = tuple(fixture.tool for fixture in turn.fixtures)
            if fixture_sequence != turn.expected_tools:
                raise ValueError(
                    "Multi-turn catalog fixture sequence must match expected tools: "
                    f"{conversation.conversation_id} turn {turn_index}"
                )
            for tool_name in turn.expected_tools:
                tool = tools_by_name.get(tool_name)
                if tool is None:
                    raise ValueError(
                        "Multi-turn catalog references unavailable tool: "
                        f"{conversation.conversation_id} {tool_name}"
                    )
                properties = tool.input_schema.get("properties")
                if not isinstance(properties, dict):
                    raise ValueError(
                        "Multi-turn catalog tool schema has no properties: "
                        f"{conversation.conversation_id} {tool_name}"
                    )
                unknown_selector_fields = set(turn.expected_context.constraints) - set(properties)
                if unknown_selector_fields:
                    raise ValueError(
                        "Multi-turn catalog selector is not in registered tool schema: "
                        f"{conversation.conversation_id} {tool_name} "
                        f"{sorted(unknown_selector_fields)}"
                    )
            if turn_index > 0:
                prior_fixtures = conversation.turns[turn_index - 1].fixtures
                if (
                    turn.expected_context.reference_kind == "prior_context_ref"
                    and turn.expected_context.context_ref is not None
                    and not _fixtures_contain_value(
                        prior_fixtures, turn.expected_context.context_ref
                    )
                ):
                    raise ValueError(
                        "Multi-turn catalog context reference is absent from prior fixture: "
                        f"{conversation.conversation_id} turn {turn_index}"
                    )
                if turn.expected_context.reference_kind == "prior_result_selector" and not all(
                    _fixtures_contain_value(prior_fixtures, value)
                    for value in turn.expected_context.constraints.values()
                ):
                    raise ValueError(
                        "Multi-turn catalog selector is absent from prior fixture: "
                        f"{conversation.conversation_id} turn {turn_index}"
                    )
            if turn_index == len(conversation.turns) - 1:
                fixture_facts = _fixture_text(turn.fixtures)
                missing_facts = [
                    fact
                    for fact in turn.expected_outcome.expected_facts
                    if fact not in fixture_facts
                ]
                if missing_facts:
                    raise ValueError(
                        "Multi-turn catalog expected fact is absent from final fixture: "
                        f"{conversation.conversation_id} {missing_facts}"
                    )


def evaluate_multiturn_conversation(
    planner: AgentPlannerClient,
    job: AgentRunJob,
    conversation: MultiTurnConversation,
    *,
    current_date: str,
    router: AgentRouterClient | None = None,
    judge: MultiTurnJudgeClient | None = None,
    timezone: str = "Asia/Seoul",
    attempt: int = 1,
) -> MultiTurnEvaluationResult:
    evaluation_job = (
        replace(job, request_context={"surface": conversation.context_surface})
        if conversation.context_surface is not None
        else job
    )
    repository = _MultiTurnReplayRepository(evaluation_job, conversation.turns[0].user, timezone)
    handoff = _MultiTurnReplayHandoff(repository, conversation)
    processor = AgentRunProcessor(
        repository,
        planner,
        handoff,
        current_date_provider=lambda _timezone: date.fromisoformat(current_date),
        router_client=router,
        tool_retrieval_mode="llm_router" if router is not None else "shadow",
    )
    runtime_failure = False
    for turn_index, turn in enumerate(conversation.turns):
        if turn_index > 0:
            repository.begin_turn(turn_index, turn.user)
        turn_job = replace(
            evaluation_job,
            turn_sequence=evaluation_job.turn_sequence + turn_index,
        )
        for _ in range(len(turn.expected_tools) + 2):
            try:
                result = processor.process_job(turn_job)
            except Exception:
                runtime_failure = True
                break
            if repository.status in {"completed", "failed", "cancelled", "waiting_user_input"}:
                repository.last_process_reason = result.reason
                break
            if result.reason not in {
                "agent_execution_handoff_completed",
                "agent_execution_handoff_retried",
            }:
                runtime_failure = True
                break
        if runtime_failure or repository.status != "completed":
            runtime_failure = True
            break

    result = evaluate_deterministic_continuation(
        conversation,
        tuple(repository.tool_calls),
        attempt=attempt,
    )
    if not runtime_failure:
        return _with_multiturn_judge(result, conversation, repository, judge)
    failure_reasons = tuple(
        dict.fromkeys((*result.failure_reasons, "runtime_failure", repository.last_process_reason))
    )
    return MultiTurnEvaluationResult(
        conversation_id=result.conversation_id,
        attempt=result.attempt,
        deterministic_context_passed=result.deterministic_context_passed,
        deterministic_continuation_passed=False,
        failure_reasons=failure_reasons,
        judge_verdict=None,
        judge_failure_codes=(),
        judge_context_resolved=None,
        judge_follow_up_delivered=None,
        tool_selection_passed=result.tool_selection_passed,
        expected_tool_sequence=result.expected_tool_sequence,
        executed_tool_sequence=result.executed_tool_sequence,
    )


def evaluate_multiturn_suite(
    planner: AgentPlannerClient,
    router: AgentRouterClient,
    job: AgentRunJob,
    conversations: tuple[MultiTurnConversation, ...],
    *,
    current_date: str,
    timezone: str = "Asia/Seoul",
    repetitions: int = 1,
    judge: MultiTurnJudgeClient | None = None,
) -> tuple[MultiTurnEvaluationResult, ...]:
    if repetitions < 1:
        raise ValueError("Multi-turn repetitions must be positive")
    validate_multiturn_catalog_against_job(conversations, job)
    return tuple(
        evaluate_multiturn_conversation(
            planner,
            job,
            conversation,
            current_date=current_date,
            timezone=timezone,
            router=router,
            judge=judge,
            attempt=attempt,
        )
        for conversation in conversations
        for attempt in range(1, repetitions + 1)
    )


def build_multiturn_context_report(
    results: tuple[MultiTurnEvaluationResult, ...],
) -> dict[str, object]:
    attempts = len(results)
    context_resolved = sum(
        result.deterministic_context_passed
        and result.judge_verdict == "pass"
        and result.judge_context_resolved is True
        for result in results
    )
    tool_selection_correct = sum(result.tool_selection_passed for result in results)
    partial = sum(result.judge_verdict == "partial" for result in results)
    inconclusive = sum(result.judge_verdict == "inconclusive" for result in results)
    failure_codes: dict[str, int] = {}
    for result in results:
        for code in (*result.failure_reasons, *result.judge_failure_codes):
            failure_codes[code] = failure_codes.get(code, 0) + 1
    return {
        "multiTurnContextEvaluation": {
            "conversationCount": len({result.conversation_id for result in results}),
            "attempts": attempts,
            "multiTurnContextResolutionRate": _fraction(context_resolved, attempts),
            "multiTurnToolSelectionAccuracy": _fraction(tool_selection_correct, attempts),
            "partialRate": _fraction(partial, attempts),
            "inconclusiveRate": _fraction(inconclusive, attempts),
            "failureCodeCounts": dict(sorted(failure_codes.items())),
        },
        "results": [
            {
                "id": result.conversation_id,
                "attempt": result.attempt,
                "toolSelectionPassed": result.tool_selection_passed,
                "expectedToolSequence": list(result.expected_tool_sequence),
                "executedToolSequence": list(result.executed_tool_sequence),
                "deterministicContextPassed": result.deterministic_context_passed,
                "deterministicContinuationPassed": result.deterministic_continuation_passed,
                "judgeVerdict": result.judge_verdict,
                "judgeContextResolved": result.judge_context_resolved,
                "judgeFollowUpDelivered": result.judge_follow_up_delivered,
                "failureReasons": list(result.failure_reasons),
                "judgeFailureCodes": list(result.judge_failure_codes),
                "failureClassification": _failure_classification(result),
            }
            for result in results
        ],
    }


def _failure_classification(result: MultiTurnEvaluationResult) -> str:
    if result.failure_reasons or result.judge_verdict in {"fail", "partial"}:
        return "agent_failure"
    return "none"


def _load_expected_context(raw_turn: dict[str, object], turn_index: int) -> ExpectedContext:
    raw_context = raw_turn.get("expectedContext")
    if not isinstance(raw_context, dict):
        raise ValueError("Multi-turn expectedContext is required")
    reference_kind = raw_context.get("referenceKind")
    context_ref = raw_context.get("contextRef")
    constraints = raw_context.get("constraints")
    if not isinstance(reference_kind, str) or not reference_kind.strip():
        raise ValueError("Multi-turn expectedContext.referenceKind is required")
    allowed_reference_kinds = {"none", "prior_context_ref", "prior_result_selector"}
    if reference_kind.strip() not in allowed_reference_kinds:
        raise ValueError("Multi-turn expectedContext.referenceKind is invalid")
    if not isinstance(constraints, dict):
        raise ValueError("Multi-turn expectedContext.constraints must be an object")
    if turn_index > 0 and (not isinstance(context_ref, str) or not context_ref.strip()):
        raise ValueError("Multi-turn follow-up expectedContext.contextRef is required")
    if turn_index == 0 and reference_kind.strip() != "none":
        raise ValueError("Multi-turn first turn expectedContext.referenceKind must be none")
    if turn_index == 0 and context_ref is not None:
        raise ValueError("Multi-turn first turn expectedContext.contextRef must be omitted")
    if turn_index > 0 and reference_kind.strip() == "none":
        raise ValueError(
            "Multi-turn follow-up expectedContext.referenceKind must use prior context"
        )
    return ExpectedContext(
        reference_kind=reference_kind.strip(),
        context_ref=context_ref.strip() if isinstance(context_ref, str) else None,
        constraints=_freeze_mapping(constraints),
    )


def _load_fixtures(raw_turn: dict[str, object]) -> tuple[MultiTurnToolFixture, ...]:
    raw_fixtures = raw_turn.get("fixtures")
    if not isinstance(raw_fixtures, list) or not raw_fixtures:
        raise ValueError("Multi-turn fixtures are required")
    fixtures: list[MultiTurnToolFixture] = []
    for raw_fixture in raw_fixtures:
        if not isinstance(raw_fixture, dict):
            raise ValueError("Multi-turn fixture must be an object")
        tool = raw_fixture.get("tool")
        output = raw_fixture.get("output")
        if not isinstance(tool, str) or not tool.strip():
            raise ValueError("Multi-turn fixture tool is required")
        if not isinstance(output, dict):
            raise ValueError("Multi-turn fixture output must be an object")
        fixtures.append(MultiTurnToolFixture(tool.strip(), _freeze_mapping(output)))
    return tuple(fixtures)


def _load_expected_outcome(raw_turn: dict[str, object]) -> ExpectedOutcome:
    raw_outcome = raw_turn.get("expectedOutcome")
    if not isinstance(raw_outcome, dict):
        raise ValueError("Multi-turn expectedOutcome is required")
    delivery_required = raw_outcome.get("deliveryRequired")
    expected_facts = raw_outcome.get("expectedFacts")
    if not isinstance(delivery_required, bool):
        raise ValueError("Multi-turn expectedOutcome.deliveryRequired must be boolean")
    if not isinstance(expected_facts, list) or not all(
        isinstance(fact, str) and fact.strip() for fact in expected_facts
    ):
        raise ValueError("Multi-turn expectedOutcome.expectedFacts must be strings")
    return ExpectedOutcome(
        delivery_required=delivery_required,
        expected_facts=tuple(fact.strip() for fact in expected_facts),
    )


def _freeze_mapping(value: dict[str, object]) -> Mapping[str, FrozenJson]:
    return MappingProxyType({str(key): _freeze_json(item) for key, item in value.items()})


def _freeze_json(value: object) -> FrozenJson:
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, list):
        return tuple(_freeze_json(item) for item in value)
    if isinstance(value, dict):
        return _freeze_mapping(value)
    raise ValueError("Multi-turn catalog values must be JSON values")


def _contains_context_reference(value: Mapping[str, FrozenJson], context_ref: str) -> bool:
    return any(
        item == context_ref
        or isinstance(item, Mapping)
        and _contains_context_reference(item, context_ref)
        or isinstance(item, tuple)
        and any(
            nested_item == context_ref
            or isinstance(nested_item, Mapping)
            and _contains_context_reference(nested_item, context_ref)
            for nested_item in item
        )
        for item in value.values()
    )


def _contains_mapping(actual: Mapping[str, FrozenJson], expected: Mapping[str, FrozenJson]) -> bool:
    for key, expected_value in expected.items():
        actual_value = actual.get(key)
        if isinstance(expected_value, Mapping):
            if not isinstance(actual_value, Mapping) or not _contains_mapping(
                actual_value, expected_value
            ):
                return False
        elif actual_value != expected_value:
            return False
    return True


def _fixtures_contain_value(fixtures: tuple[MultiTurnToolFixture, ...], value: FrozenJson) -> bool:
    return any(_contains_fixture_value(fixture.output, value) for fixture in fixtures)


def _contains_fixture_value(value: FrozenJson, expected: FrozenJson) -> bool:
    if value == expected:
        return True
    if isinstance(value, str) and isinstance(expected, str) and expected in value:
        return True
    if isinstance(value, Mapping):
        return any(_contains_fixture_value(item, expected) for item in value.values())
    if isinstance(value, tuple):
        return any(_contains_fixture_value(item, expected) for item in value)
    return False


def _fixture_text(fixtures: tuple[MultiTurnToolFixture, ...]) -> str:
    return json.dumps(_thaw_json(tuple(fixture.output for fixture in fixtures)), ensure_ascii=False)


class _MultiTurnReplayRepository:
    def __init__(self, job: AgentRunJob, prompt: str, timezone: str) -> None:
        self.job = job
        self.prompt = prompt
        self.timezone = timezone
        self.status = "planning"
        self.planner_turn_count = 0
        self.planning_context = f"user: {prompt}"
        self.latest_planner_tool_name: str | None = None
        self.latest_output_summary: dict[str, object] | None = None
        self.final_answers: list[str] = []
        self.current_turn_index = 0
        self.tool_calls: list[MultiTurnEvaluationToolCall] = []
        self.last_process_reason = "runtime_unknown"

    def begin_turn(self, turn_index: int, prompt: str) -> None:
        self.current_turn_index = turn_index
        self.prompt = prompt
        self.status = "planning"
        self.planner_turn_count = 0
        self.latest_planner_tool_name = None
        self.latest_output_summary = None
        self.planning_context = "\n".join((self.planning_context, f"user: {prompt}"))

    def try_acquire_run_lock(self, _run_id: str) -> bool:
        return True

    def release_run_lock(self, _run_id: str) -> None:
        return None

    def get_run_context(self, _job: AgentRunJob) -> AgentRunContext:
        return AgentRunContext(
            run_id=self.job.run_id,
            workspace_id=self.job.workspace_id,
            requested_by_user_id=self.job.requested_by_user_id,
            status=self.status,
            prompt=self.prompt,
            timezone=self.timezone,
            planner_turn_count=self.planner_turn_count,
            latest_planner_tool_name=self.latest_planner_tool_name,
            planning_context=self.planning_context,
        )

    def start_planner_step(self, _job: AgentRunJob, _context: AgentRunContext) -> str:
        self.planner_turn_count += 1
        return f"multiturn-step-{self.current_turn_index}-{self.planner_turn_count}"

    def complete_planner_step(
        self,
        _run_id: str,
        _step_id: str,
        output_summary: dict[str, object],
    ) -> bool:
        self.latest_output_summary = output_summary
        tool_name = output_summary.get("toolName")
        self.latest_planner_tool_name = tool_name if isinstance(tool_name, str) else None
        return True

    def fail_planner_step(self, *_args: object) -> None:
        self.status = "failed"

    def complete_run(
        self,
        _run_id: str,
        final_answer: str,
        _message: str,
        _risk_level: str | None,
    ) -> None:
        self.status = "completed"
        self.final_answers.append(final_answer)

    def mark_tool_execution_ready(
        self,
        _run_id: str,
        _message: str,
        _risk_level: str,
    ) -> None:
        self.status = "running"

    def mark_failed(self, *_args: object) -> None:
        self.status = "failed"

    def wait_for_user_input(self, _run_id: str, message: str) -> bool:
        self.status = "waiting_user_input"
        self.final_answers.append(message)
        return True


class _MultiTurnReplayHandoff:
    def __init__(
        self,
        repository: _MultiTurnReplayRepository,
        conversation: MultiTurnConversation,
    ) -> None:
        self.repository = repository
        self.conversation = conversation

    def execute(self, _run_id: str) -> None:
        summary = self.repository.latest_output_summary or {}
        tool_name = summary.get("toolName")
        tool_input = summary.get("input")
        if not isinstance(tool_name, str) or not isinstance(tool_input, dict):
            self.repository.status = "failed"
            return
        turn = self.conversation.turns[self.repository.current_turn_index]
        turn_calls = [
            call
            for call in self.repository.tool_calls
            if call.turn_index == self.repository.current_turn_index
        ]
        fixture = turn.fixtures[len(turn_calls)] if len(turn_calls) < len(turn.fixtures) else None
        self.repository.tool_calls.append(
            MultiTurnEvaluationToolCall(
                self.repository.current_turn_index,
                tool_name,
                _freeze_mapping(tool_input),
            )
        )
        output = (
            _thaw_json(fixture.output)
            if fixture is not None and tool_name == fixture.tool
            else {"error": "unexpected tool"}
        )
        output_json = json.dumps(output, ensure_ascii=False, separators=(",", ":"))
        self.repository.planning_context = "\n".join(
            (
                self.repository.planning_context,
                f"tool {tool_name}: {output_json}",
            )
        )
        self.repository.status = "planning"


def _thaw_json(value: FrozenJson) -> object:
    if isinstance(value, Mapping):
        return {key: _thaw_json(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw_json(item) for item in value]
    return value


def _with_multiturn_judge(
    result: MultiTurnEvaluationResult,
    conversation: MultiTurnConversation,
    repository: _MultiTurnReplayRepository,
    judge: MultiTurnJudgeClient | None,
) -> MultiTurnEvaluationResult:
    if judge is None:
        return result
    final_turn = conversation.turns[-1]
    verdict = judge_multiturn_context(
        MultiTurnJudgeEvidence(
            conversation_history=tuple(turn.user for turn in conversation.turns),
            tool_trace=tuple(call.tool_name for call in repository.tool_calls),
            expected_context_transition=(
                final_turn.expected_context.context_ref or "no prior context required"
            ),
            tool_facts=_fixture_facts(final_turn.fixtures),
            expected_outcome_facts=final_turn.expected_outcome.expected_facts,
            final_answer=repository.final_answers[-1] if repository.final_answers else "",
            deterministic_context_passed=result.deterministic_context_passed,
        ),
        judge,
    )
    return MultiTurnEvaluationResult(
        conversation_id=result.conversation_id,
        attempt=result.attempt,
        deterministic_context_passed=result.deterministic_context_passed,
        deterministic_continuation_passed=result.deterministic_continuation_passed,
        failure_reasons=result.failure_reasons,
        judge_verdict=verdict.verdict,
        judge_failure_codes=verdict.failure_codes,
        judge_context_resolved=verdict.context_resolved,
        judge_follow_up_delivered=verdict.follow_up_delivered,
        tool_selection_passed=result.tool_selection_passed,
        expected_tool_sequence=result.expected_tool_sequence,
        executed_tool_sequence=result.executed_tool_sequence,
    )


def _fraction(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def _fixture_facts(fixtures: tuple[MultiTurnToolFixture, ...]) -> tuple[str, ...]:
    facts: list[str] = []
    for fixture in fixtures:
        output = _thaw_json(fixture.output)
        if not isinstance(output, dict):
            continue
        for key, value in output.items():
            facts.append(f"{fixture.tool}.{key}: {json.dumps(value, ensure_ascii=False)}")
    return tuple(facts)
