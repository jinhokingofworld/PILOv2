from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass, replace
from typing import Protocol

_SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
_TOKEN_PATTERN = re.compile(r"[0-9A-Za-z가-힣_]+")
_SUPPORTED_CATALOG_VERSIONS = frozenset(
    {
        "agent-tool-capabilities:v1",
        "agent-tool-capabilities:v2",
        "agent-tool-capabilities:v3",
    }
)
TOOL_RETRIEVER_VERSION = "agent-tool-metadata-overlap:v5"
_KOREAN_PARTICLES = (
    "으로",
    "에서",
    "에게",
    "까지",
    "부터",
    "과",
    "와",
    "을",
    "를",
    "이",
    "가",
    "은",
    "는",
    "의",
    "에",
    "로",
    "만",
    "도",
)
_KOREAN_REQUEST_ENDINGS = ("해주세요", "해 주세요", "해줘", "해요")
_GENERIC_REQUEST_TOKENS = frozenset(
    {
        "알려줘",
        "부탁드려요",
        "요청",
        "해주세요",
        "해줘",
        "해요",
    }
)
_TOKEN_ALIASES = {
    "board": ("보드",),
    "canvas": ("캔버스",),
    "pr_review": ("pr", "리뷰"),
    "review": ("리뷰",),
    "sql_erd": ("erd",),
    "sqltoerd": ("erd",),
    "table": ("테이블",),
}
_DOMAIN_SWITCH_ALIASES = {
    "meeting": ("회의록", "회의", "미팅", "meeting"),
    "calendar": ("일정", "캘린더", "calendar"),
    "board": ("보드", "이슈", "board", "issue"),
    "drive": ("드라이브", "문서", "파일", "drive", "document"),
    "sql_erd": ("sqltoerd", "erd"),
    "pr_review": ("pr review", "pr 리뷰", "pr"),
}
_INTENT_CUE_MARKERS = (
    ("조회", ("조회", "보여", "보기", "확인", "살펴")),
    ("생성", ("생성", "만들", "추가")),
    ("변경", ("변경", "바꾸", "바꿔", "수정")),
    ("삭제", ("삭제", "지우", "지워", "제거")),
    ("검색", ("검색", "찾")),
    ("승인", ("승인",)),
    ("반려", ("반려", "제외")),
    ("참여", ("참여", "입장", "재입장")),
    ("퇴장", ("퇴장", "나가")),
    ("시작", ("시작",)),
    ("종료", ("종료", "끝내")),
    ("요약", ("요약",)),
    ("이동", ("이동", "옮겨")),
    ("위임", ("위임",)),
    ("추천", ("추천",)),
    ("실행", ("실행", "돌려")),
    ("제출", ("제출", "merge", "머지")),
)
_INTENT_CUE_TOKENS = frozenset(cue for cue, _ in _INTENT_CUE_MARKERS)
_INTENT_CUE_FAMILY = {
    "조회": "read",
    "검색": "read",
    "추천": "read",
    "요약": "read",
    "생성": "create",
    "변경": "update",
    "삭제": "delete",
    "승인": "approve",
    "반려": "dismiss",
    "참여": "join",
    "퇴장": "leave",
    "시작": "start",
    "종료": "end",
    "이동": "move",
    "위임": "delegate",
    "실행": "execute",
    "제출": "submit",
}
_CAPABILITY_EXAMPLE_KINDS = frozenset(
    {"canonical", "paraphrase", "typo", "honorific", "abbreviation"}
)
_CAPABILITY_BOUNDARY_EXAMPLE_KINDS = frozenset(
    {"negation", "exclusion", "correction", "anaphora", "domain_switch"}
)
_CAPABILITY_SELECTOR_KINDS = frozenset(
    {
        "none",
        "current_meeting",
        "meeting_room_name",
        "meeting_scope",
        "meeting_report",
        "transcript_query",
        "decision_index",
        "action_item",
        "workspace_member",
        "query",
        "calendar_event",
        "date_range",
        "board_issue",
        "title_query",
        "body_query",
        "board_context",
        "sql_erd_session",
        "table_reference",
        "sql_ddl",
        "canvas_context",
        "pr_review_session",
        "review_file",
        "document_query",
    }
)
_UUID_PATTERN = re.compile(
    r"(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![0-9a-f])",
    re.IGNORECASE,
)
DEFAULT_TOOL_SHORTLIST_SCHEMA_TOKEN_BUDGET = 8_000


@dataclass(frozen=True)
class CapabilityExample:
    kind: str
    utterance: str


@dataclass(frozen=True)
class CapabilityBoundaryExample:
    kind: str
    utterance: str
    expected_status: str
    expected_capability_ids: tuple[str, ...]


@dataclass(frozen=True)
class ToolCapabilityDescriptor:
    tool_name: str
    domain: str
    action: str
    operation: str | None
    capability_ids: tuple[str, ...]
    when_to_use: str
    must_not_use_for: tuple[str, ...]
    accepted_selector_fields: tuple[str, ...]
    selector_kinds: tuple[str, ...]
    prerequisite_tool_names: tuple[str, ...]
    follow_up_tool_names: tuple[str, ...]
    risk_level: str
    execution_mode: str
    requires_confirmation: bool
    context_surface: str | None
    input_schema_sha256: str


@dataclass(frozen=True)
class CapabilityDefinition:
    capability_id: str
    domain: str
    tool_names: tuple[str, ...]
    when_to_use: str
    must_not_use_for: tuple[str, ...]
    positive_examples: tuple[str, ...]
    examples: tuple[CapabilityExample, ...]
    selector_kinds: tuple[str, ...]
    requires_confirmation: bool
    availability: str
    boundary_examples: tuple[CapabilityBoundaryExample, ...] = ()
    terminal_tool_names: tuple[str, ...] = ()
    operation: str | None = None
    execution_mode: str | None = None


@dataclass(frozen=True)
class ToolCapabilityCatalog:
    version: str
    sha256: str
    capabilities: tuple[CapabilityDefinition, ...]
    descriptors: tuple[ToolCapabilityDescriptor, ...]


@dataclass(frozen=True)
class ToolRetrievalResult:
    tool_names: tuple[str, ...]
    low_confidence: bool
    fallback_reason: str | None
    unsupported_capability_id: str | None = None
    selected_capability_ids: tuple[str, ...] = ()
    primary_capability_id: str | None = None
    primary_tool_name: str | None = None
    candidate_count: int = 0
    confidence_bucket: str = "none"


@dataclass(frozen=True)
class ReadOnlyToolSelection:
    tool_names: tuple[str, ...]
    retrieval: ToolRetrievalResult
    used_shortlist: bool


@dataclass(frozen=True)
class ToolShortlistSelection:
    tool_names: tuple[str, ...]
    retrieval: ToolRetrievalResult
    used_shortlist: bool


class SemanticReranker(Protocol):
    def score(self, prompt: str, descriptor: ToolCapabilityDescriptor) -> float: ...


def parse_tool_capability_catalog(
    value: object,
    eligible_tool_schemas: dict[str, dict[str, object]],
) -> ToolCapabilityCatalog | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("Invalid toolCapabilityCatalog")

    version = _required_string(value, "version")
    if version not in _SUPPORTED_CATALOG_VERSIONS:
        raise ValueError("Unsupported toolCapabilityCatalog version")
    sha256 = _required_string(value, "sha256").lower()
    raw_capabilities = value.get("capabilities")
    raw_descriptors = value.get("descriptors")
    if (
        not _SHA256_PATTERN.fullmatch(sha256)
        or not isinstance(raw_capabilities, list)
        or not isinstance(raw_descriptors, list)
    ):
        raise ValueError("Invalid toolCapabilityCatalog")

    expected_sha256 = compute_tool_capability_catalog_sha(
        version, raw_capabilities, raw_descriptors
    )
    if not hmac.compare_digest(sha256, expected_sha256):
        raise ValueError("Invalid toolCapabilityCatalog SHA")

    strict_v2 = version in {
        "agent-tool-capabilities:v2",
        "agent-tool-capabilities:v3",
    }
    strict_v3 = version == "agent-tool-capabilities:v3"
    capabilities = tuple(
        _parse_capability(item, strict_v2=strict_v2, strict_v3=strict_v3)
        for item in raw_capabilities
    )
    descriptors = tuple(_parse_descriptor(item, strict_v2=strict_v2) for item in raw_descriptors)
    tool_names = {descriptor.tool_name for descriptor in descriptors}
    eligible_tool_names = set(eligible_tool_schemas)
    capability_ids = {capability.capability_id for capability in capabilities}
    if (
        len(tool_names) != len(descriptors)
        or tool_names != eligible_tool_names
        or len(capability_ids) != len(capabilities)
        or any(not set(capability.tool_names) <= eligible_tool_names for capability in capabilities)
        or any(
            capability.availability not in {"supported", "unsupported"}
            or (capability.availability == "supported" and not capability.tool_names)
            or (capability.availability == "unsupported" and capability.tool_names)
            for capability in capabilities
        )
        or any(not set(descriptor.capability_ids) <= capability_ids for descriptor in descriptors)
        or any(
            descriptor.requires_confirmation
            != (descriptor.execution_mode == "confirmation_required")
            for descriptor in descriptors
        )
        or (strict_v2 and not _valid_v2_capability_contract(capabilities, descriptors))
        or (
            strict_v3
            and not _valid_v3_capability_contract(
                capabilities,
                descriptors,
                eligible_tool_schemas,
            )
        )
        or any(
            not hmac.compare_digest(
                descriptor.input_schema_sha256,
                compute_input_schema_sha256(eligible_tool_schemas[descriptor.tool_name]),
            )
            for descriptor in descriptors
        )
    ):
        raise ValueError("Invalid toolCapabilityCatalog")

    return ToolCapabilityCatalog(
        version=version,
        sha256=sha256,
        capabilities=capabilities,
        descriptors=descriptors,
    )


def retrieve_tool_shortlist(
    prompt: str,
    catalog: ToolCapabilityCatalog,
    *,
    top_k: int = 8,
    semantic_reranker: SemanticReranker | None = None,
    tool_schema_bytes: dict[str, int] | None = None,
    schema_token_budget: int | None = DEFAULT_TOOL_SHORTLIST_SCHEMA_TOKEN_BUDGET,
) -> ToolRetrievalResult:
    if top_k < 1:
        raise ValueError("top_k must be positive")
    if schema_token_budget is not None and schema_token_budget < 1:
        raise ValueError("schema_token_budget must be positive")

    prompt_tokens = set(_tokens(prompt))
    negated_intent_cues = _negated_intent_cues(prompt)
    excluded_domains = _excluded_domains(prompt)
    excluded_domain_tokens = set(
        _tokens(
            " ".join(
                alias for domain in excluded_domains for alias in _DOMAIN_SWITCH_ALIASES[domain]
            )
        )
    )
    capability_by_id = {capability.capability_id: capability for capability in catalog.capabilities}
    descriptor_by_tool_name = {
        descriptor.tool_name: descriptor for descriptor in catalog.descriptors
    }
    scored: list[tuple[float, str]] = []
    metadata_scores: list[float] = []
    for capability in catalog.capabilities:
        if capability.availability != "supported":
            continue
        terminal_tool_name = capability.tool_names[-1]
        terminal_descriptor = descriptor_by_tool_name[terminal_tool_name]
        metadata_tokens = _capability_metadata_tokens(capability)
        negative_tokens = set(_tokens(" ".join(capability.must_not_use_for))) - metadata_tokens
        score = _capability_match_score(
            prompt_tokens,
            capability,
            negated_intent_cues=negated_intent_cues,
        )
        if capability.domain in excluded_domains:
            score -= 100.0
        negative_prompt_tokens = prompt_tokens - set(negated_intent_cues) - excluded_domain_tokens
        score -= float(len(negative_prompt_tokens & negative_tokens)) * 0.75
        metadata_scores.append(score)
        if semantic_reranker:
            score += semantic_reranker.score(prompt, terminal_descriptor)
        scored.append((score, capability.capability_id))

    ranked = sorted(scored, key=lambda item: (-item[0], item[1]))
    best_score = ranked[0][0] if ranked else 0.0
    best_metadata_score = max(metadata_scores, default=0.0)
    unsupported_ranked = sorted(
        (
            (
                _capability_match_score(
                    prompt_tokens,
                    capability,
                    negated_intent_cues=negated_intent_cues,
                )
                - (100.0 if capability.domain in excluded_domains else 0.0),
                capability.capability_id,
            )
            for capability in catalog.capabilities
            if capability.availability == "unsupported"
        ),
        key=lambda item: (-item[0], item[1]),
    )
    unsupported_score, unsupported_capability_id = (
        unsupported_ranked[0] if unsupported_ranked else (0.0, None)
    )
    candidate_count = sum(score > 0 for score, _ in scored) + sum(
        score > 0 for score, _ in unsupported_ranked
    )
    handoff_capability_ids = _meeting_report_calendar_handoff_capability_ids(
        prompt_tokens,
        capability_by_id,
    )
    compound_request = _is_compound_request(prompt)
    if (
        not handoff_capability_ids
        and unsupported_score > 0
        and unsupported_score >= best_metadata_score
    ):
        return ToolRetrievalResult(
            tool_names=tuple(),
            low_confidence=False,
            fallback_reason="unsupported_capability",
            unsupported_capability_id=unsupported_capability_id,
            candidate_count=candidate_count,
            confidence_bucket=_confidence_bucket(unsupported_score),
        )
    top_capability_ids = tuple(
        capability_id for score, capability_id in ranked if score > 0 and score == best_score
    )
    if not handoff_capability_ids and not compound_request and len(top_capability_ids) > 1:
        return ToolRetrievalResult(
            tool_names=tuple(),
            low_confidence=True,
            fallback_reason="conflicting_capabilities",
            candidate_count=candidate_count,
            confidence_bucket=_confidence_bucket(best_metadata_score),
        )
    if best_score <= 0:
        return ToolRetrievalResult(
            tool_names=tuple(),
            low_confidence=True,
            fallback_reason="no_metadata_match",
            candidate_count=candidate_count,
            confidence_bucket="none",
        )

    selected: list[str] = []
    selected_set: set[str] = set()
    remaining_schema_bytes = schema_token_budget * 4 if schema_token_budget is not None else None
    # Scores are discrete token overlaps. Preserve a closely matched second
    # capability only for compound requests, while excluding one-token
    # adjacent Meeting actions from an otherwise unambiguous shortlist.
    minimum_candidate_score = max(1.0, best_score - 1.0) if compound_request else best_score

    if handoff_capability_ids:
        score_by_capability_id = {capability_id: score for score, capability_id in ranked}
        ranked = [
            (score_by_capability_id[capability_id], capability_id)
            for capability_id in ("meeting.report.summary", "calendar.events.create")
        ]
        minimum_candidate_score = 0.0

    selected_capability_ids: list[str] = []
    for rank, (score, capability_id) in enumerate(ranked[:top_k]):
        if score < minimum_candidate_score:
            break
        required_chain = capability_by_id[capability_id].tool_names
        if any(name not in descriptor_by_tool_name for name in required_chain):
            if rank > 0:
                continue
            return ToolRetrievalResult(
                tool_names=tuple(),
                low_confidence=True,
                fallback_reason="invalid_tool_chain",
                candidate_count=candidate_count,
                confidence_bucket=_confidence_bucket(best_metadata_score),
            )
        chain_schema_bytes = sum(
            tool_schema_bytes.get(name, 0) if tool_schema_bytes else 0
            for name in required_chain
            if name not in selected_set
        )
        if remaining_schema_bytes is not None and chain_schema_bytes > remaining_schema_bytes:
            if rank > 0:
                continue
            return ToolRetrievalResult(
                tool_names=tuple(),
                low_confidence=True,
                fallback_reason="tool_schema_budget_exceeded",
                candidate_count=candidate_count,
                confidence_bucket=_confidence_bucket(best_metadata_score),
            )
        for name in required_chain:
            if name not in selected_set:
                selected.append(name)
                selected_set.add(name)
        selected_capability_ids.append(capability_id)
        if remaining_schema_bytes is not None:
            remaining_schema_bytes -= chain_schema_bytes

    return ToolRetrievalResult(
        tool_names=tuple(selected),
        low_confidence=False,
        fallback_reason=None,
        selected_capability_ids=tuple(selected_capability_ids),
        primary_capability_id=ranked[0][1],
        primary_tool_name=capability_by_id[ranked[0][1]].tool_names[-1],
        candidate_count=candidate_count,
        confidence_bucket=_confidence_bucket(best_metadata_score),
    )


def select_read_only_tool_shortlist(
    prompt: str,
    catalog: ToolCapabilityCatalog,
    eligible_tool_schemas: dict[str, dict[str, object]],
    *,
    top_k: int = 8,
    schema_token_budget: int = DEFAULT_TOOL_SHORTLIST_SCHEMA_TOKEN_BUDGET,
) -> ReadOnlyToolSelection:
    """Mirrors the runtime's read-only shortlist and legacy fallback policy."""
    legacy_tool_names = tuple(eligible_tool_schemas)
    try:
        retrieval = retrieve_tool_shortlist(
            prompt,
            catalog,
            top_k=top_k,
            tool_schema_bytes={
                tool_name: len(
                    json.dumps(
                        schema,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode()
                )
                for tool_name, schema in eligible_tool_schemas.items()
            },
            schema_token_budget=schema_token_budget,
        )
    except Exception:
        return ReadOnlyToolSelection(
            tool_names=legacy_tool_names,
            retrieval=ToolRetrievalResult(
                tool_names=tuple(),
                low_confidence=True,
                fallback_reason="retriever_error",
            ),
            used_shortlist=False,
        )

    if retrieval.low_confidence or not retrieval.selected_capability_ids:
        return ReadOnlyToolSelection(
            tool_names=legacy_tool_names,
            retrieval=retrieval,
            used_shortlist=False,
        )

    descriptor_by_tool_name = {
        descriptor.tool_name: descriptor for descriptor in catalog.descriptors
    }
    if any(
        descriptor_by_tool_name.get(tool_name) is None
        or descriptor_by_tool_name[tool_name].operation != "read"
        for tool_name in retrieval.tool_names
    ):
        return ReadOnlyToolSelection(
            tool_names=legacy_tool_names,
            retrieval=replace(retrieval, fallback_reason="write_capability"),
            used_shortlist=False,
        )

    retrieved_tool_names = set(retrieval.tool_names)
    return ReadOnlyToolSelection(
        tool_names=tuple(
            tool_name for tool_name in legacy_tool_names if tool_name in retrieved_tool_names
        ),
        retrieval=retrieval,
        used_shortlist=True,
    )


def select_tool_shortlist(
    prompt: str,
    catalog: ToolCapabilityCatalog,
    eligible_tool_schemas: dict[str, dict[str, object]],
    *,
    top_k: int = 8,
    schema_token_budget: int = DEFAULT_TOOL_SHORTLIST_SCHEMA_TOKEN_BUDGET,
) -> ToolShortlistSelection:
    """Selects a bounded capability chain without falling back to all tools."""
    try:
        retrieval = retrieve_tool_shortlist(
            prompt,
            catalog,
            top_k=top_k,
            tool_schema_bytes={
                tool_name: len(
                    json.dumps(
                        schema,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode()
                )
                for tool_name, schema in eligible_tool_schemas.items()
            },
            schema_token_budget=schema_token_budget,
        )
    except Exception:
        return ToolShortlistSelection(
            tool_names=tuple(),
            retrieval=ToolRetrievalResult(
                tool_names=tuple(),
                low_confidence=True,
                fallback_reason="retriever_error",
            ),
            used_shortlist=False,
        )

    if retrieval.low_confidence or not retrieval.selected_capability_ids:
        return ToolShortlistSelection(
            tool_names=tuple(),
            retrieval=retrieval,
            used_shortlist=False,
        )

    retrieved_tool_names = set(retrieval.tool_names)
    return ToolShortlistSelection(
        tool_names=tuple(
            tool_name for tool_name in eligible_tool_schemas if tool_name in retrieved_tool_names
        ),
        retrieval=retrieval,
        used_shortlist=True,
    )


def _confidence_bucket(score: float) -> str:
    if score <= 0:
        return "none"
    if score < 2:
        return "low"
    if score < 4:
        return "medium"
    return "high"


def _capability_match_score(
    prompt_tokens: set[str],
    capability: CapabilityDefinition,
    *,
    negated_intent_cues: frozenset[str] = frozenset(),
) -> float:
    metadata_tokens = _capability_metadata_tokens(capability)
    overlapping_tokens = prompt_tokens & metadata_tokens
    score = sum(0.25 if _is_intent_surface_token(token) else 1.0 for token in overlapping_tokens)
    score -= float(len(negated_intent_cues & metadata_tokens)) * 4.0
    prompt_intent_cues = (prompt_tokens & _INTENT_CUE_TOKENS) - negated_intent_cues
    capability_intent_cues = metadata_tokens & _INTENT_CUE_TOKENS
    prompt_intent_families = {_INTENT_CUE_FAMILY[cue] for cue in prompt_intent_cues}
    capability_intent_families = {_INTENT_CUE_FAMILY[cue] for cue in capability_intent_cues}
    score += float(len(prompt_intent_cues & capability_intent_cues))
    if prompt_intent_cues:
        score -= float(len(capability_intent_families - prompt_intent_families)) * 0.75
    return score


def _negated_intent_cues(prompt: str) -> frozenset[str]:
    negated: set[str] = set()
    for cue, markers in _INTENT_CUE_MARKERS:
        if any(
            re.search(
                rf"{re.escape(marker)}[^\s,.!?]{{0,8}}(?:지\s*말|하지\s*말|말고)",
                prompt,
                re.IGNORECASE,
            )
            for marker in markers
        ):
            negated.add(cue)
    return frozenset(negated)


def _excluded_domains(prompt: str) -> frozenset[str]:
    folded = prompt.casefold()
    excluded: set[str] = set()
    for domain, aliases in _DOMAIN_SWITCH_ALIASES.items():
        if any(
            re.search(
                rf"(?<![0-9a-z]){re.escape(alias)}(?![0-9a-z])\s*"
                r"(?:말고|아니고|제외하고|빼고|대신)",
                folded,
            )
            for alias in aliases
        ):
            excluded.add(domain)
    return frozenset(excluded)


def _is_intent_surface_token(token: str) -> bool:
    return any(marker in token for _, markers in _INTENT_CUE_MARKERS for marker in markers)


def _capability_metadata_tokens(capability: CapabilityDefinition) -> set[str]:
    return set(
        _tokens(
            " ".join(
                (
                    capability.domain,
                    capability.capability_id,
                    capability.when_to_use,
                    *capability.positive_examples,
                    *(example.utterance for example in capability.examples),
                )
            )
        )
    )


def _valid_v2_capability_contract(
    capabilities: tuple[CapabilityDefinition, ...],
    descriptors: tuple[ToolCapabilityDescriptor, ...],
) -> bool:
    descriptor_by_tool_name = {descriptor.tool_name: descriptor for descriptor in descriptors}
    for capability in capabilities:
        example_kinds = {example.kind for example in capability.examples}
        terminal_descriptor = (
            descriptor_by_tool_name.get(capability.tool_names[-1])
            if capability.tool_names
            else None
        )
        if (
            not capability.selector_kinds
            or len(set(capability.selector_kinds)) != len(capability.selector_kinds)
            or len(set(capability.tool_names)) != len(capability.tool_names)
            or len(capability.examples) != len(_CAPABILITY_EXAMPLE_KINDS)
            or example_kinds != _CAPABILITY_EXAMPLE_KINDS
            or tuple(example.utterance for example in capability.examples)
            != capability.positive_examples
            or (
                capability.availability == "supported"
                and (
                    terminal_descriptor is None
                    or capability.requires_confirmation != terminal_descriptor.requires_confirmation
                    or any(
                        descriptor_by_tool_name.get(tool_name) is None
                        or descriptor_by_tool_name[tool_name].domain != capability.domain
                        for tool_name in capability.tool_names
                    )
                )
            )
            or (capability.availability == "unsupported" and capability.requires_confirmation)
        ):
            return False

    for descriptor in descriptors:
        matching_capabilities = [
            capability
            for capability in capabilities
            if descriptor.tool_name in capability.tool_names
        ]
        expected_selector_kinds = {
            selector_kind
            for capability in matching_capabilities
            for selector_kind in capability.selector_kinds
        }
        if (
            not descriptor.selector_kinds
            or len(set(descriptor.selector_kinds)) != len(descriptor.selector_kinds)
            or set(descriptor.selector_kinds) != expected_selector_kinds
            or set(descriptor.capability_ids)
            != {capability.capability_id for capability in matching_capabilities}
            or any(capability.domain != descriptor.domain for capability in matching_capabilities)
        ):
            return False
    return True


def _valid_v3_capability_contract(
    capabilities: tuple[CapabilityDefinition, ...],
    descriptors: tuple[ToolCapabilityDescriptor, ...],
    eligible_tool_schemas: dict[str, dict[str, object]],
) -> bool:
    if not _capability_chains_are_acyclic(capabilities):
        return False
    descriptor_by_tool_name = {descriptor.tool_name: descriptor for descriptor in descriptors}
    capability_ids = {capability.capability_id for capability in capabilities}
    for capability in capabilities:
        boundary_kinds = {example.kind for example in capability.boundary_examples}
        terminal_tool_name = capability.tool_names[-1] if capability.tool_names else None
        terminal_descriptor = (
            descriptor_by_tool_name.get(terminal_tool_name) if terminal_tool_name else None
        )
        if (
            len(capability.boundary_examples) != len(_CAPABILITY_BOUNDARY_EXAMPLE_KINDS)
            or boundary_kinds != _CAPABILITY_BOUNDARY_EXAMPLE_KINDS
            or not set(capability.selector_kinds) <= _CAPABILITY_SELECTOR_KINDS
            or any(_UUID_PATTERN.search(example.utterance) for example in capability.examples)
            or any(
                _UUID_PATTERN.search(example.utterance)
                or len(set(example.expected_capability_ids)) != len(example.expected_capability_ids)
                or not set(example.expected_capability_ids) <= capability_ids
                or (example.expected_status == "routed" and not example.expected_capability_ids)
                or (example.expected_status != "routed" and bool(example.expected_capability_ids))
                or example.expected_status not in {"routed", "needs_clarification", "unsupported"}
                for example in capability.boundary_examples
            )
            or (
                capability.availability == "supported"
                and (
                    terminal_descriptor is None
                    or capability.terminal_tool_names != (terminal_tool_name,)
                    or capability.operation != terminal_descriptor.operation
                    or capability.execution_mode != terminal_descriptor.execution_mode
                    or capability.requires_confirmation != terminal_descriptor.requires_confirmation
                )
            )
            or (
                capability.availability == "unsupported"
                and (
                    capability.terminal_tool_names
                    or capability.operation is not None
                    or capability.execution_mode is not None
                )
            )
        ):
            return False

    for descriptor in descriptors:
        matching_capabilities = tuple(
            capability
            for capability in capabilities
            if descriptor.tool_name in capability.tool_names
        )
        expected_prerequisites: set[str] = set()
        expected_follow_ups: set[str] = set()
        for capability in matching_capabilities:
            index = capability.tool_names.index(descriptor.tool_name)
            expected_prerequisites.update(capability.tool_names[:index])
            expected_follow_ups.update(capability.tool_names[index + 1 :])
        schema_properties = eligible_tool_schemas[descriptor.tool_name].get("properties", {})
        if not isinstance(schema_properties, dict):
            return False
        if (
            set(descriptor.capability_ids)
            != {capability.capability_id for capability in matching_capabilities}
            or set(descriptor.prerequisite_tool_names) != expected_prerequisites
            or set(descriptor.follow_up_tool_names) != expected_follow_ups
            or set(descriptor.accepted_selector_fields) != set(schema_properties)
            or descriptor.operation not in {"read", "write"}
        ):
            return False
    return True


def _capability_chains_are_acyclic(
    capabilities: tuple[CapabilityDefinition, ...],
) -> bool:
    edges: dict[str, set[str]] = {}
    for capability in capabilities:
        if capability.availability != "supported":
            continue
        for source, target in zip(
            capability.tool_names,
            capability.tool_names[1:],
            strict=False,
        ):
            edges.setdefault(source, set()).add(target)

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(tool_name: str) -> bool:
        if tool_name in visiting:
            return False
        if tool_name in visited:
            return True
        visiting.add(tool_name)
        if not all(visit(target) for target in edges.get(tool_name, set())):
            return False
        visiting.remove(tool_name)
        visited.add(tool_name)
        return True

    return all(visit(tool_name) for tool_name in edges)


def _parse_descriptor(value: object, *, strict_v2: bool = False) -> ToolCapabilityDescriptor:
    if not isinstance(value, dict):
        raise ValueError("Invalid tool capability descriptor")
    context_surface = value.get("contextSurface")
    if context_surface is not None and not isinstance(context_surface, str):
        raise ValueError("Invalid tool capability descriptor")

    return ToolCapabilityDescriptor(
        tool_name=_required_string(value, "toolName"),
        domain=_required_string(value, "domain"),
        action=_required_string(value, "action"),
        operation=(_required_operation(value) if strict_v2 else _optional_operation(value)),
        capability_ids=_string_tuple(value, "capabilityIds"),
        when_to_use=_required_string(value, "whenToUse"),
        must_not_use_for=_string_tuple(value, "mustNotUseFor"),
        accepted_selector_fields=_string_tuple(value, "acceptedSelectorFields"),
        selector_kinds=(
            _string_tuple(value, "selectorKinds")
            if strict_v2
            else _optional_string_tuple(value, "selectorKinds")
        ),
        prerequisite_tool_names=_string_tuple(value, "prerequisiteToolNames"),
        follow_up_tool_names=_string_tuple(value, "followUpToolNames"),
        risk_level=_required_string(value, "riskLevel"),
        execution_mode=_required_string(value, "executionMode"),
        requires_confirmation=(
            _required_bool(value, "requiresConfirmation")
            if strict_v2
            else _optional_bool(value, "requiresConfirmation", False)
        ),
        context_surface=context_surface,
        input_schema_sha256=_sha256_string(value, "inputSchemaSha256"),
    )


def _parse_capability(
    value: object,
    *,
    strict_v2: bool = False,
    strict_v3: bool = False,
) -> CapabilityDefinition:
    if not isinstance(value, dict):
        raise ValueError("Invalid capability definition")
    return CapabilityDefinition(
        capability_id=_required_string(value, "id"),
        domain=_required_string(value, "domain"),
        tool_names=_string_tuple(value, "toolNames"),
        when_to_use=_required_string(value, "whenToUse"),
        must_not_use_for=_string_tuple(value, "mustNotUseFor"),
        positive_examples=_string_tuple(value, "positiveExamples"),
        examples=_parse_examples(value, required=strict_v2),
        selector_kinds=(
            _string_tuple(value, "selectorKinds")
            if strict_v2
            else _optional_string_tuple(value, "selectorKinds")
        ),
        requires_confirmation=(
            _required_bool(value, "requiresConfirmation")
            if strict_v2
            else _optional_bool(value, "requiresConfirmation", False)
        ),
        availability=(
            _required_string(value, "availability")
            if strict_v2
            else _optional_string(value, "availability", "supported")
        ),
        boundary_examples=_parse_boundary_examples(value, required=strict_v3),
        terminal_tool_names=(
            _string_tuple(value, "terminalToolNames")
            if strict_v3
            else _optional_string_tuple(value, "terminalToolNames")
        ),
        operation=(
            _nullable_operation(value, required=True)
            if strict_v3
            else _nullable_operation(value, required=False)
        ),
        execution_mode=(
            _nullable_string(value, "executionMode", required=True)
            if strict_v3
            else _nullable_string(value, "executionMode", required=False)
        ),
    )


def _parse_examples(
    value: dict[object, object], *, required: bool
) -> tuple[CapabilityExample, ...]:
    if "examples" not in value and not required:
        return tuple()
    raw_examples = value.get("examples")
    if not isinstance(raw_examples, list):
        raise ValueError("Invalid tool capability descriptor")
    examples: list[CapabilityExample] = []
    for raw_example in raw_examples:
        if not isinstance(raw_example, dict):
            raise ValueError("Invalid tool capability descriptor")
        examples.append(
            CapabilityExample(
                kind=_required_string(raw_example, "kind"),
                utterance=_required_string(raw_example, "utterance"),
            )
        )
    return tuple(examples)


def _parse_boundary_examples(
    value: dict[object, object], *, required: bool
) -> tuple[CapabilityBoundaryExample, ...]:
    if "boundaryExamples" not in value and not required:
        return tuple()
    raw_examples = value.get("boundaryExamples")
    if not isinstance(raw_examples, list):
        raise ValueError("Invalid tool capability descriptor")
    examples: list[CapabilityBoundaryExample] = []
    for raw_example in raw_examples:
        if not isinstance(raw_example, dict):
            raise ValueError("Invalid tool capability descriptor")
        examples.append(
            CapabilityBoundaryExample(
                kind=_required_string(raw_example, "kind"),
                utterance=_required_string(raw_example, "utterance"),
                expected_status=_required_string(raw_example, "expectedStatus"),
                expected_capability_ids=_string_tuple(raw_example, "expectedCapabilityIds"),
            )
        )
    return tuple(examples)


def _required_string(value: dict[object, object], key: str) -> str:
    result = value.get(key)
    if not isinstance(result, str) or not result.strip():
        raise ValueError("Invalid tool capability descriptor")
    return result.strip()


def _string_tuple(value: dict[object, object], key: str) -> tuple[str, ...]:
    result = value.get(key)
    if not isinstance(result, list) or not all(
        isinstance(item, str) and item.strip() for item in result
    ):
        raise ValueError("Invalid tool capability descriptor")
    return tuple(item.strip() for item in result)


def _optional_string_tuple(value: dict[object, object], key: str) -> tuple[str, ...]:
    if key not in value:
        return tuple()
    return _string_tuple(value, key)


def _optional_bool(value: dict[object, object], key: str, default: bool) -> bool:
    result = value.get(key, default)
    if not isinstance(result, bool):
        raise ValueError("Invalid tool capability descriptor")
    return result


def _required_bool(value: dict[object, object], key: str) -> bool:
    if key not in value:
        raise ValueError("Invalid tool capability descriptor")
    return _optional_bool(value, key, False)


def _optional_string(value: dict[object, object], key: str, default: str) -> str:
    result = value.get(key, default)
    if not isinstance(result, str) or not result.strip():
        raise ValueError("Invalid tool capability descriptor")
    return result.strip()


def _optional_operation(value: dict[object, object]) -> str | None:
    if "operation" not in value:
        return None
    return _required_operation(value)


def _required_operation(value: dict[object, object]) -> str:
    operation = _required_string(value, "operation")
    if operation not in {"read", "write"}:
        raise ValueError("Invalid tool capability descriptor")
    return operation


def _nullable_operation(value: dict[object, object], *, required: bool) -> str | None:
    if "operation" not in value:
        if required:
            raise ValueError("Invalid tool capability descriptor")
        return None
    result = value.get("operation")
    if result is None:
        return None
    return _required_operation(value)


def _nullable_string(value: dict[object, object], key: str, *, required: bool) -> str | None:
    if key not in value:
        if required:
            raise ValueError("Invalid tool capability descriptor")
        return None
    result = value.get(key)
    if result is None:
        return None
    return _required_string(value, key)


def _sha256_string(value: dict[object, object], key: str) -> str:
    result = _required_string(value, key).lower()
    if not _SHA256_PATTERN.fullmatch(result):
        raise ValueError("Invalid tool capability descriptor")
    return result


def compute_tool_capability_catalog_sha(
    version: str, capabilities: list[object], descriptors: list[object]
) -> str:
    canonical = json.dumps(
        {
            "version": version,
            "capabilities": capabilities,
            "descriptors": descriptors,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def compute_input_schema_sha256(input_schema: dict[str, object]) -> str:
    canonical = json.dumps(
        input_schema,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _tokens(value: str) -> tuple[str, ...]:
    tokens: list[str] = []
    for raw_token in _TOKEN_PATTERN.findall(value):
        token = raw_token.lower()
        variants = [token]
        for ending in _KOREAN_REQUEST_ENDINGS:
            if token.endswith(ending) and len(token) > len(ending) + 1:
                variants.append(token[: -len(ending)])
                break
        for particle in _KOREAN_PARTICLES:
            if token.endswith(particle) and len(token) > len(particle) + 1:
                variants.append(token[: -len(particle)])
                break
        for variant in variants:
            if variant in _GENERIC_REQUEST_TOKENS:
                continue
            tokens.append(variant)
            tokens.extend(_TOKEN_ALIASES.get(variant, ()))
            for intent_cue, markers in _INTENT_CUE_MARKERS:
                if any(marker in variant for marker in markers):
                    tokens.append(intent_cue)
    return tuple(tokens)


def _is_compound_request(prompt: str) -> bool:
    raw_tokens = _TOKEN_PATTERN.findall(prompt.lower())
    return (
        "," in prompt
        or any(token in {"및", "그리고"} for token in raw_tokens)
        or any(len(token) > 1 and token.endswith(("와", "과")) for token in raw_tokens)
    )


def _meeting_report_calendar_handoff_capability_ids(
    prompt_tokens: set[str],
    capability_by_id: dict[str, CapabilityDefinition],
) -> frozenset[str]:
    """Keeps a Meeting decision -> Calendar creation handoff executable.

    The generic unsupported Meeting action-item creation capability also contains
    ``회의록`` and ``추가``. It must not preempt a request that explicitly names a
    Calendar destination. The planner still receives only a read prerequisite and
    a confirmation-required write candidate; it cannot create an event directly.
    """
    has_meeting_report = bool(prompt_tokens & {"회의록", "meeting", "report"})
    has_decision = bool(prompt_tokens & {"결정", "결정사항", "요약", "후속", "후속작업"})
    has_calendar = bool(prompt_tokens & {"일정", "캘린더", "calendar"})
    has_create = "생성" in prompt_tokens
    required = {"meeting.report.summary", "calendar.events.create"}
    if not (has_meeting_report and has_decision and has_calendar and has_create):
        return frozenset()
    if not required <= set(capability_by_id):
        return frozenset()
    return frozenset(required)
