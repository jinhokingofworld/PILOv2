from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from typing import Protocol

_SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
_TOKEN_PATTERN = re.compile(r"[0-9A-Za-z가-힣_]+")
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
_CAPABILITY_EXAMPLE_KINDS = frozenset(
    {"canonical", "paraphrase", "typo", "honorific", "abbreviation"}
)


@dataclass(frozen=True)
class CapabilityExample:
    kind: str
    utterance: str


@dataclass(frozen=True)
class ToolCapabilityDescriptor:
    tool_name: str
    domain: str
    action: str
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

    strict_v2 = version == "agent-tool-capabilities:v2"
    capabilities = tuple(_parse_capability(item, strict_v2=strict_v2) for item in raw_capabilities)
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
) -> ToolRetrievalResult:
    if top_k < 1:
        raise ValueError("top_k must be positive")

    prompt_tokens = set(_tokens(prompt))
    scored: list[tuple[float, str]] = []
    metadata_scores: list[float] = []
    for descriptor in catalog.descriptors:
        metadata_tokens = set(
            _tokens(
                " ".join(
                    (
                        descriptor.domain,
                        descriptor.action,
                        *descriptor.capability_ids,
                        descriptor.when_to_use,
                    )
                )
            )
        )
        negative_tokens = set(_tokens(" ".join(descriptor.must_not_use_for)))
        score = float(len(prompt_tokens & metadata_tokens))
        score -= float(len(prompt_tokens & negative_tokens)) * 0.75
        metadata_scores.append(score)
        if semantic_reranker:
            score += semantic_reranker.score(prompt, descriptor)
        scored.append((score, descriptor.tool_name))

    ranked = sorted(scored, key=lambda item: (-item[0], item[1]))
    best_score = ranked[0][0] if ranked else 0.0
    best_metadata_score = max(metadata_scores, default=0.0)
    unsupported_ranked = sorted(
        (
            (_capability_match_score(prompt_tokens, capability), capability.capability_id)
            for capability in catalog.capabilities
            if capability.availability == "unsupported"
        ),
        key=lambda item: (-item[0], item[1]),
    )
    unsupported_score, unsupported_capability_id = (
        unsupported_ranked[0] if unsupported_ranked else (0.0, None)
    )
    if unsupported_score > 0 and unsupported_score > best_metadata_score:
        return ToolRetrievalResult(
            tool_names=tuple(),
            low_confidence=False,
            fallback_reason="unsupported_capability",
            unsupported_capability_id=unsupported_capability_id,
        )
    if best_score <= 0:
        return ToolRetrievalResult(
            tool_names=tuple(),
            low_confidence=True,
            fallback_reason="no_metadata_match",
        )

    return ToolRetrievalResult(
        tool_names=tuple(name for _, name in ranked[:top_k]),
        low_confidence=False,
        fallback_reason=None,
    )


def _capability_match_score(prompt_tokens: set[str], capability: CapabilityDefinition) -> float:
    metadata_tokens = set(
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
    return float(len(prompt_tokens & metadata_tokens))


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
        ):
            return False
    return True


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


def _parse_capability(value: object, *, strict_v2: bool = False) -> CapabilityDefinition:
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
        tokens.append(token)
        for particle in _KOREAN_PARTICLES:
            if token.endswith(particle) and len(token) > len(particle) + 1:
                tokens.append(token[: -len(particle)])
                break
    return tuple(tokens)
