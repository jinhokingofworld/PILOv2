from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

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


@dataclass(frozen=True)
class MultiTurnCatalog:
    version: str
    conversations: tuple[MultiTurnConversation, ...]


def load_multiturn_catalog(catalog_path: Path) -> MultiTurnCatalog:
    try:
        payload = json.loads(catalog_path.read_text(encoding="utf-8"))
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
        raw_turns = raw_conversation.get("turns")
        if not isinstance(conversation_id, str) or not conversation_id.strip():
            raise ValueError("Multi-turn conversation id is required")
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
        conversations.append(MultiTurnConversation(conversation_id.strip(), tuple(turns)))
    if len({conversation.conversation_id for conversation in conversations}) != len(conversations):
        raise ValueError("Multi-turn conversation ids must be unique")
    return MultiTurnCatalog(payload["version"].strip(), tuple(conversations))


def _load_expected_context(raw_turn: dict[str, object], turn_index: int) -> ExpectedContext:
    raw_context = raw_turn.get("expectedContext")
    if not isinstance(raw_context, dict):
        raise ValueError("Multi-turn expectedContext is required")
    reference_kind = raw_context.get("referenceKind")
    context_ref = raw_context.get("contextRef")
    constraints = raw_context.get("constraints")
    if not isinstance(reference_kind, str) or not reference_kind.strip():
        raise ValueError("Multi-turn expectedContext.referenceKind is required")
    if not isinstance(constraints, dict):
        raise ValueError("Multi-turn expectedContext.constraints must be an object")
    if turn_index > 0 and (not isinstance(context_ref, str) or not context_ref.strip()):
        raise ValueError("Multi-turn follow-up expectedContext.contextRef is required")
    if turn_index == 0 and reference_kind.strip() != "none":
        raise ValueError("Multi-turn first turn expectedContext.referenceKind must be none")
    if turn_index == 0 and context_ref is not None:
        raise ValueError("Multi-turn first turn expectedContext.contextRef must be omitted")
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
