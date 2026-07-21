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

KOREAN_MULTITURN_HOLDOUT_FORMAT = "agent-korean-multiturn-holdout:v2"
KOREAN_MULTITURN_DOMAINS = (
    "meeting",
    "calendar",
    "board",
    "drive",
    "sqltoerd",
    "pr_review",
)
KOREAN_MULTITURN_SCENARIO_FAMILIES = (
    "anaphora",
    "ellipsis",
    "constraint_accumulation",
    "correction",
    "topic_switch_return",
    "domain_collision",
    "clarification",
    "negation",
    "relative_date",
    "speech_variation",
)


@dataclass(frozen=True)
class ExpectedContext:
    reference_kind: str
    context_ref: str | None
    constraints: Mapping[str, FrozenJson]
    source_turn: int | None = None
    forbidden_tools: tuple[str, ...] = ()
    required_clarification_fields: tuple[str, ...] = ()
    source_constraints: Mapping[str, FrozenJson] | None = None


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
    domain: str | None = None
    scenario_family: str | None = None


@dataclass(frozen=True)
class MultiTurnCatalog:
    version: str
    conversations: tuple[MultiTurnConversation, ...]
    language: str | None = None


@dataclass(frozen=True)
class MultiTurnEvaluationToolCall:
    turn_index: int
    tool_name: str
    tool_input: Mapping[str, FrozenJson]


@dataclass(frozen=True)
class MultiTurnFollowUpResult:
    turn_index: int
    tool_selection_passed: bool
    context_argument_applicable: bool
    context_argument_passed: bool
    deterministic_passed: bool
    failure_reasons: tuple[str, ...]
    judge_verdict: str | None = None
    judge_failure_codes: tuple[str, ...] = ()
    judge_context_resolved: bool | None = None
    judge_follow_up_delivered: bool | None = None


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
    follow_up_results: tuple[MultiTurnFollowUpResult, ...] = ()
    conversation_success: bool = False


def load_multiturn_catalog(catalog_path: Path) -> MultiTurnCatalog:
    try:
        payload = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as error:
        raise ValueError("Multi-turn catalog must contain valid JSON") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("version"), str):
        raise ValueError("Multi-turn catalog version is required")
    version = payload["version"].strip()
    language = payload.get("language")
    if language is not None and (not isinstance(language, str) or not language.strip()):
        raise ValueError("Multi-turn catalog language must be a non-empty string")
    raw_conversations = payload.get("conversations")
    if not isinstance(raw_conversations, list) or not raw_conversations:
        raise ValueError("Multi-turn catalog conversations are required")

    conversations: list[MultiTurnConversation] = []
    for raw_conversation in raw_conversations:
        if not isinstance(raw_conversation, dict):
            raise ValueError("Multi-turn conversation must be an object")
        conversation_id = raw_conversation.get("id")
        context_surface = raw_conversation.get("contextSurface")
        domain = raw_conversation.get("domain")
        scenario_family = raw_conversation.get("scenarioFamily")
        raw_turns = raw_conversation.get("turns")
        if not isinstance(conversation_id, str) or not conversation_id.strip():
            raise ValueError("Multi-turn conversation id is required")
        if context_surface is not None and context_surface not in {"sql_erd", "pr_review"}:
            raise ValueError("Multi-turn contextSurface is invalid")
        if domain is not None and (not isinstance(domain, str) or not domain.strip()):
            raise ValueError("Multi-turn conversation domain must be a non-empty string")
        if scenario_family is not None and (
            not isinstance(scenario_family, str) or not scenario_family.strip()
        ):
            raise ValueError("Multi-turn scenarioFamily must be a non-empty string")
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
            expected_context = _load_expected_context(raw_turn, index)
            if not isinstance(expected_tools, list) or not all(
                isinstance(tool, str) and tool.strip() for tool in expected_tools
            ):
                raise ValueError("Multi-turn expectedTools must be strings")
            if not expected_tools and expected_context.reference_kind != "clarification":
                raise ValueError("Multi-turn expectedTools are required")
            fixtures = _load_fixtures(
                raw_turn,
                allow_empty=expected_context.reference_kind == "clarification",
            )
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
            MultiTurnConversation(
                conversation_id.strip(),
                tuple(turns),
                context_surface,
                domain.strip() if isinstance(domain, str) else None,
                scenario_family.strip() if isinstance(scenario_family, str) else None,
            )
        )
    if len({conversation.conversation_id for conversation in conversations}) != len(conversations):
        raise ValueError("Multi-turn conversation ids must be unique")
    catalog = MultiTurnCatalog(
        version,
        tuple(conversations),
        language.strip() if isinstance(language, str) else None,
    )
    if version == KOREAN_MULTITURN_HOLDOUT_FORMAT:
        validate_korean_multiturn_holdout_catalog(catalog)
    return catalog


def validate_korean_multiturn_holdout_catalog(catalog: MultiTurnCatalog) -> None:
    if catalog.version != KOREAN_MULTITURN_HOLDOUT_FORMAT:
        raise ValueError("Korean multi-turn holdout format is invalid")
    if catalog.language != "ko-KR":
        raise ValueError("Korean multi-turn holdout language must be ko-KR")
    if len(catalog.conversations) != 120:
        raise ValueError("Korean multi-turn holdout must contain exactly 120 conversations")

    domain_counts = {domain: 0 for domain in KOREAN_MULTITURN_DOMAINS}
    family_counts = {
        (domain, family): 0
        for domain in KOREAN_MULTITURN_DOMAINS
        for family in KOREAN_MULTITURN_SCENARIO_FAMILIES
    }
    for conversation in catalog.conversations:
        if conversation.domain not in domain_counts:
            raise ValueError(
                f"Korean multi-turn holdout domain is invalid: {conversation.conversation_id}"
            )
        if conversation.scenario_family not in KOREAN_MULTITURN_SCENARIO_FAMILIES:
            raise ValueError(
                "Korean multi-turn holdout scenario family is invalid: "
                f"{conversation.conversation_id}"
            )
        if not 2 <= len(conversation.turns) <= 4:
            raise ValueError(
                "Korean multi-turn holdout conversations require two to four turns: "
                f"{conversation.conversation_id}"
            )
        if any(not _contains_korean(turn.user) for turn in conversation.turns):
            raise ValueError(
                "Korean multi-turn holdout turn must contain Korean: "
                f"{conversation.conversation_id}"
            )
        expected_surface = {
            "sqltoerd": "sql_erd",
            "pr_review": "pr_review",
        }.get(conversation.domain)
        if conversation.context_surface != expected_surface:
            raise ValueError(
                "Korean multi-turn holdout context surface does not match domain: "
                f"{conversation.conversation_id}"
            )
        for turn_index, turn in enumerate(conversation.turns):
            is_clarification = turn.expected_context.reference_kind == "clarification"
            if len(turn.expected_tools) != (0 if is_clarification else 1):
                raise ValueError(
                    "Korean multi-turn holdout requires one Tool per non-clarification turn: "
                    f"{conversation.conversation_id} turn {turn_index}"
                )
            if is_clarification and (
                turn.expected_outcome.delivery_required or turn.expected_outcome.expected_facts
            ):
                raise ValueError(
                    "Korean multi-turn clarification cannot require delivered facts: "
                    f"{conversation.conversation_id} turn {turn_index}"
                )
            if not is_clarification and not turn.expected_outcome.delivery_required:
                raise ValueError(
                    "Korean multi-turn Tool turn must require a delivered answer: "
                    f"{conversation.conversation_id} turn {turn_index}"
                )
        has_clarification = any(
            turn.expected_context.reference_kind == "clarification"
            for turn in conversation.turns[1:]
        )
        if has_clarification != (conversation.scenario_family == "clarification"):
            raise ValueError(
                "Korean multi-turn clarification family does not match turn structure: "
                f"{conversation.conversation_id}"
            )
        if conversation.scenario_family == "topic_switch_return" and not any(
            turn_index >= 2
            and turn.expected_context.source_turn is not None
            and turn.expected_context.source_turn < turn_index - 1
            for turn_index, turn in enumerate(conversation.turns)
        ):
            raise ValueError(
                "Korean multi-turn topic switch must return to a non-adjacent source turn: "
                f"{conversation.conversation_id}"
            )
        domain_counts[conversation.domain] += 1
        family_counts[(conversation.domain, conversation.scenario_family)] += 1

    if any(count != 20 for count in domain_counts.values()):
        raise ValueError("Korean multi-turn holdout requires 20 conversations per domain")
    if any(count != 2 for count in family_counts.values()):
        raise ValueError(
            "Korean multi-turn holdout requires two conversations per domain and scenario family"
        )


def evaluate_deterministic_continuation(
    conversation: MultiTurnConversation,
    tool_calls: tuple[MultiTurnEvaluationToolCall, ...],
    *,
    attempt: int = 1,
    turn_terminal_states: Mapping[int, str] | None = None,
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

    follow_up_results: list[MultiTurnFollowUpResult] = []
    for turn_index, turn in enumerate(conversation.turns):
        calls = calls_by_turn.get(turn_index, [])
        actual_tools = tuple(call.tool_name for call in calls)
        turn_failure_reasons: list[str] = []
        forbidden_called = set(actual_tools) & set(turn.expected_context.forbidden_tools)
        turn_tool_selection_passed = actual_tools == turn.expected_tools and not forbidden_called
        if not turn_tool_selection_passed:
            turn_failure_reasons.append(
                "forbidden_tool"
                if forbidden_called
                else (
                    "unexpected_tool"
                    if set(actual_tools) - set(turn.expected_tools)
                    else "tool_sequence"
                )
            )
        if turn_index == 0:
            failure_reasons.extend(turn_failure_reasons)
            continue

        is_clarification = turn.expected_context.reference_kind == "clarification"
        context_argument_applicable = not is_clarification and bool(
            turn.expected_context.context_ref or turn.expected_context.constraints
        )
        context_argument_passed = True
        if is_clarification:
            terminal_state = (
                turn_terminal_states.get(turn_index) if turn_terminal_states is not None else None
            )
            if terminal_state != "waiting_user_input":
                turn_failure_reasons.append("clarification_state")
        context_reference_failed = False
        if not is_clarification and turn.expected_context.reference_kind == "prior_context_ref":
            context_ref = turn.expected_context.context_ref
            if context_ref is None or not all(
                _contains_context_reference(call.tool_input, context_ref) for call in calls
            ):
                context_argument_passed = False
                context_reference_failed = True
                turn_failure_reasons.append("context_reference")
        if (
            not is_clarification
            and not context_reference_failed
            and not all(
                _contains_mapping(call.tool_input, turn.expected_context.constraints)
                for call in calls
            )
        ):
            context_argument_passed = False
            turn_failure_reasons.append("context_constraints")

        deterministic_passed = not turn_failure_reasons
        follow_up_results.append(
            MultiTurnFollowUpResult(
                turn_index=turn_index,
                tool_selection_passed=turn_tool_selection_passed,
                context_argument_applicable=context_argument_applicable,
                context_argument_passed=context_argument_passed,
                deterministic_passed=deterministic_passed,
                failure_reasons=tuple(dict.fromkeys(turn_failure_reasons)),
            )
        )
        failure_reasons.extend(turn_failure_reasons)

    unique_failure_reasons = tuple(dict.fromkeys(failure_reasons))
    follow_up_deterministic_passed = bool(follow_up_results) and all(
        result.deterministic_passed for result in follow_up_results
    )
    return MultiTurnEvaluationResult(
        conversation_id=conversation.conversation_id,
        attempt=attempt,
        deterministic_context_passed=follow_up_deterministic_passed,
        deterministic_continuation_passed=follow_up_deterministic_passed,
        failure_reasons=unique_failure_reasons,
        tool_selection_passed=tool_selection_passed,
        expected_tool_sequence=expected_tool_sequence,
        executed_tool_sequence=executed_tool_sequence,
        follow_up_results=tuple(follow_up_results),
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
            unknown_forbidden_tools = sorted(
                tool_name
                for tool_name in turn.expected_context.forbidden_tools
                if tool_name not in tools_by_name
            )
            if unknown_forbidden_tools:
                raise ValueError(
                    "Multi-turn catalog references unavailable forbidden Tool: "
                    f"{conversation.conversation_id} {unknown_forbidden_tools}"
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
            if turn_index > 0 and turn.expected_context.reference_kind != "clarification":
                source_turn = (
                    turn.expected_context.source_turn
                    if turn.expected_context.source_turn is not None
                    else turn_index - 1
                )
                prior_fixtures = conversation.turns[source_turn].fixtures
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
                    for value in (turn.expected_context.source_constraints or {}).values()
                ):
                    raise ValueError(
                        "Multi-turn catalog selector is absent from prior fixture: "
                        f"{conversation.conversation_id} turn {turn_index}"
                    )
            if (
                turn.expected_outcome.delivery_required
                and turn.expected_context.reference_kind != ("clarification")
            ):
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
    repository.seed_setup_turn(conversation.turns[0])
    runtime_failure = False
    for turn_index, turn in enumerate(conversation.turns[1:], start=1):
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
        expected_terminal_state = (
            "waiting_user_input"
            if turn.expected_context.reference_kind == "clarification"
            else "completed"
        )
        if runtime_failure or repository.status != expected_terminal_state:
            runtime_failure = True
            break

    result = evaluate_deterministic_continuation(
        conversation,
        tuple(repository.tool_calls),
        attempt=attempt,
        turn_terminal_states=repository.terminal_states,
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
        follow_up_results=result.follow_up_results,
        conversation_success=False,
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
    conversation_success = sum(result.conversation_success for result in results)
    follow_ups = tuple(follow_up for result in results for follow_up in result.follow_up_results)
    follow_up_tool_selection_correct = sum(
        follow_up.tool_selection_passed for follow_up in follow_ups
    )
    context_arguments = tuple(
        follow_up for follow_up in follow_ups if follow_up.context_argument_applicable
    )
    context_arguments_correct = sum(
        follow_up.context_argument_passed for follow_up in context_arguments
    )
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
            "koreanMultiTurnContextTaskSuccessRate": _fraction(conversation_success, attempts),
            "followUpToolSelectionAccuracy": _fraction(
                follow_up_tool_selection_correct, len(follow_ups)
            ),
            "priorContextArgumentAccuracy": _fraction(
                context_arguments_correct, len(context_arguments)
            ),
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
                "conversationSuccess": result.conversation_success,
                "followUpResults": [
                    {
                        "turnIndex": follow_up.turn_index,
                        "toolSelectionPassed": follow_up.tool_selection_passed,
                        "contextArgumentApplicable": (follow_up.context_argument_applicable),
                        "contextArgumentPassed": follow_up.context_argument_passed,
                        "deterministicPassed": follow_up.deterministic_passed,
                        "judgeVerdict": follow_up.judge_verdict,
                        "judgeContextResolved": follow_up.judge_context_resolved,
                        "judgeFollowUpDelivered": follow_up.judge_follow_up_delivered,
                        "failureReasons": list(follow_up.failure_reasons),
                        "judgeFailureCodes": list(follow_up.judge_failure_codes),
                    }
                    for follow_up in result.follow_up_results
                ],
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
    source_constraints = raw_context.get("sourceConstraints", constraints)
    source_turn = raw_context.get("sourceTurn")
    forbidden_tools = raw_context.get("forbiddenTools", [])
    required_clarification_fields = raw_context.get("requiredClarificationFields", [])
    if not isinstance(reference_kind, str) or not reference_kind.strip():
        raise ValueError("Multi-turn expectedContext.referenceKind is required")
    allowed_reference_kinds = {
        "none",
        "prior_context_ref",
        "prior_result_selector",
        "clarification",
    }
    if reference_kind.strip() not in allowed_reference_kinds:
        raise ValueError("Multi-turn expectedContext.referenceKind is invalid")
    if not isinstance(constraints, dict):
        raise ValueError("Multi-turn expectedContext.constraints must be an object")
    if not isinstance(source_constraints, dict):
        raise ValueError("Multi-turn expectedContext.sourceConstraints must be an object")
    if source_turn is not None and (
        isinstance(source_turn, bool) or not isinstance(source_turn, int)
    ):
        raise ValueError("Multi-turn expectedContext.sourceTurn must be an integer")
    if not isinstance(forbidden_tools, list) or not all(
        isinstance(tool, str) and tool.strip() for tool in forbidden_tools
    ):
        raise ValueError("Multi-turn expectedContext.forbiddenTools must be strings")
    if not isinstance(required_clarification_fields, list) or not all(
        isinstance(field, str) and field.strip() for field in required_clarification_fields
    ):
        raise ValueError("Multi-turn expectedContext.requiredClarificationFields must be strings")
    if turn_index == 0 and reference_kind.strip() != "none":
        raise ValueError("Multi-turn first turn expectedContext.referenceKind must be none")
    if turn_index == 0 and context_ref is not None:
        raise ValueError("Multi-turn first turn expectedContext.contextRef must be omitted")
    if turn_index == 0 and source_turn is not None:
        raise ValueError("Multi-turn first turn expectedContext.sourceTurn must be omitted")
    if turn_index > 0 and reference_kind.strip() == "none":
        raise ValueError(
            "Multi-turn follow-up expectedContext.referenceKind must use prior context"
        )
    if turn_index > 0 and source_turn is None:
        source_turn = turn_index - 1
    if source_turn is not None and not 0 <= source_turn < turn_index:
        raise ValueError("Multi-turn expectedContext.sourceTurn must reference an earlier turn")
    if reference_kind.strip() == "prior_context_ref" and (
        not isinstance(context_ref, str) or not context_ref.strip()
    ):
        raise ValueError("Multi-turn prior_context_ref requires contextRef")
    if reference_kind.strip() == "clarification":
        if context_ref is not None or constraints:
            raise ValueError("Multi-turn clarification cannot declare contextRef or constraints")
        if not required_clarification_fields:
            raise ValueError("Multi-turn clarification requires requiredClarificationFields")
    elif required_clarification_fields:
        raise ValueError("Multi-turn requiredClarificationFields are only valid for clarification")
    return ExpectedContext(
        reference_kind=reference_kind.strip(),
        context_ref=context_ref.strip() if isinstance(context_ref, str) else None,
        constraints=_freeze_mapping(constraints),
        source_turn=source_turn,
        forbidden_tools=tuple(tool.strip() for tool in forbidden_tools),
        required_clarification_fields=tuple(
            field.strip() for field in required_clarification_fields
        ),
        source_constraints=_freeze_mapping(source_constraints),
    )


def _load_fixtures(
    raw_turn: dict[str, object],
    *,
    allow_empty: bool = False,
) -> tuple[MultiTurnToolFixture, ...]:
    raw_fixtures = raw_turn.get("fixtures")
    if not isinstance(raw_fixtures, list) or (not raw_fixtures and not allow_empty):
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


def _contains_korean(value: str) -> bool:
    return any("가" <= character <= "힣" for character in value)


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
        self.final_answers_by_turn: dict[int, str] = {}
        self.terminal_states: dict[int, str] = {}
        self.current_turn_index = 0
        self.tool_calls: list[MultiTurnEvaluationToolCall] = []
        self.last_process_reason = "runtime_unknown"

    def seed_setup_turn(self, turn: MultiTurnTurn) -> None:
        """Create a valid first-turn state without measuring single-turn behavior."""
        context_lines = [self.planning_context]
        for fixture in turn.fixtures:
            output_json = json.dumps(
                _thaw_json(fixture.output),
                ensure_ascii=False,
                separators=(",", ":"),
            )
            context_lines.append(f"tool {fixture.tool}: {output_json}")
            self.tool_calls.append(
                MultiTurnEvaluationToolCall(0, fixture.tool, MappingProxyType({}))
            )
        setup_answer = " ".join(turn.expected_outcome.expected_facts).strip()
        if not setup_answer:
            setup_answer = "요청한 정보를 확인했습니다."
        context_lines.append(f"assistant: {setup_answer}")
        self.final_answers.append(setup_answer)
        self.final_answers_by_turn[0] = setup_answer
        self.terminal_states[0] = "completed"
        self.planning_context = "\n".join(context_lines)
        self.status = "completed"

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
        self.terminal_states[self.current_turn_index] = "failed"

    def complete_run(
        self,
        _run_id: str,
        final_answer: str,
        _message: str,
        _risk_level: str | None,
    ) -> None:
        self.status = "completed"
        self.final_answers.append(final_answer)
        self.final_answers_by_turn[self.current_turn_index] = final_answer
        self.terminal_states[self.current_turn_index] = "completed"
        self.planning_context = "\n".join((self.planning_context, f"assistant: {final_answer}"))

    def mark_tool_execution_ready(
        self,
        _run_id: str,
        _message: str,
        _risk_level: str,
    ) -> None:
        self.status = "running"

    def mark_failed(self, *_args: object) -> None:
        self.status = "failed"
        self.terminal_states[self.current_turn_index] = "failed"

    def wait_for_user_input(self, _run_id: str, message: str) -> bool:
        self.status = "waiting_user_input"
        self.final_answers.append(message)
        self.final_answers_by_turn[self.current_turn_index] = message
        self.terminal_states[self.current_turn_index] = "waiting_user_input"
        self.planning_context = "\n".join((self.planning_context, f"assistant: {message}"))
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
    judged_follow_ups: list[MultiTurnFollowUpResult] = []
    for follow_up in result.follow_up_results:
        turn = conversation.turns[follow_up.turn_index]
        verdict = judge_multiturn_context(
            MultiTurnJudgeEvidence(
                conversation_history=tuple(
                    item.user for item in conversation.turns[: follow_up.turn_index + 1]
                ),
                tool_trace=tuple(
                    call.tool_name
                    for call in repository.tool_calls
                    if call.turn_index == follow_up.turn_index
                ),
                expected_context_transition=_expected_context_transition(turn.expected_context),
                tool_facts=_fixture_facts(turn.fixtures),
                expected_outcome_facts=turn.expected_outcome.expected_facts,
                final_answer=repository.final_answers_by_turn.get(follow_up.turn_index, ""),
                deterministic_context_passed=follow_up.deterministic_passed,
            ),
            judge,
        )
        judged_follow_ups.append(
            replace(
                follow_up,
                judge_verdict=verdict.verdict,
                judge_failure_codes=verdict.failure_codes,
                judge_context_resolved=verdict.context_resolved,
                judge_follow_up_delivered=verdict.follow_up_delivered,
            )
        )

    aggregate_verdict = _aggregate_judge_verdict(judged_follow_ups)
    judge_failure_codes = tuple(
        dict.fromkeys(
            code for follow_up in judged_follow_ups for code in follow_up.judge_failure_codes
        )
    )
    judge_context_resolved = bool(judged_follow_ups) and all(
        follow_up.judge_context_resolved is True for follow_up in judged_follow_ups
    )
    judge_follow_up_delivered = bool(judged_follow_ups) and all(
        follow_up.judge_follow_up_delivered is True for follow_up in judged_follow_ups
    )
    conversation_success = bool(judged_follow_ups) and all(
        follow_up.deterministic_passed
        and follow_up.judge_verdict == "pass"
        and follow_up.judge_context_resolved is True
        and follow_up.judge_follow_up_delivered is True
        for follow_up in judged_follow_ups
    )
    return replace(
        result,
        judge_verdict=aggregate_verdict,
        judge_failure_codes=judge_failure_codes,
        judge_context_resolved=judge_context_resolved,
        judge_follow_up_delivered=judge_follow_up_delivered,
        follow_up_results=tuple(judged_follow_ups),
        conversation_success=conversation_success,
    )


def _expected_context_transition(expected_context: ExpectedContext) -> str:
    return json.dumps(
        {
            "referenceKind": expected_context.reference_kind,
            "sourceTurn": expected_context.source_turn,
            "contextRef": expected_context.context_ref,
            "constraints": _thaw_json(expected_context.constraints),
            "sourceConstraints": _thaw_json(expected_context.source_constraints or {}),
            "requiredClarificationFields": list(expected_context.required_clarification_fields),
        },
        ensure_ascii=False,
        sort_keys=True,
    )


def _aggregate_judge_verdict(
    follow_ups: list[MultiTurnFollowUpResult],
) -> str | None:
    verdicts = {result.judge_verdict for result in follow_ups}
    for label in ("fail", "partial", "inconclusive", "pass"):
        if label in verdicts:
            return label
    return None


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
