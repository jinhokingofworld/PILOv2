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


@dataclass(frozen=True)
class ToolCapabilityDescriptor:
    tool_name: str
    domain: str
    action: str
    capability_ids: tuple[str, ...]
    when_to_use: str
    must_not_use_for: tuple[str, ...]
    accepted_selector_fields: tuple[str, ...]
    prerequisite_tool_names: tuple[str, ...]
    follow_up_tool_names: tuple[str, ...]
    risk_level: str
    execution_mode: str
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

    capabilities = tuple(_parse_capability(item) for item in raw_capabilities)
    descriptors = tuple(_parse_descriptor(item) for item in raw_descriptors)
    tool_names = {descriptor.tool_name for descriptor in descriptors}
    eligible_tool_names = set(eligible_tool_schemas)
    capability_ids = {capability.capability_id for capability in capabilities}
    if (
        len(tool_names) != len(descriptors)
        or tool_names != eligible_tool_names
        or len(capability_ids) != len(capabilities)
        or any(not set(capability.tool_names) <= eligible_tool_names for capability in capabilities)
        or any(not set(descriptor.capability_ids) <= capability_ids for descriptor in descriptors)
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
    scored = []
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
        if semantic_reranker:
            score += semantic_reranker.score(prompt, descriptor)
        scored.append((score, descriptor.tool_name))

    ranked = sorted(scored, key=lambda item: (-item[0], item[1]))
    best_score = ranked[0][0] if ranked else 0.0
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


def _parse_descriptor(value: object) -> ToolCapabilityDescriptor:
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
        prerequisite_tool_names=_string_tuple(value, "prerequisiteToolNames"),
        follow_up_tool_names=_string_tuple(value, "followUpToolNames"),
        risk_level=_required_string(value, "riskLevel"),
        execution_mode=_required_string(value, "executionMode"),
        context_surface=context_surface,
        input_schema_sha256=_sha256_string(value, "inputSchemaSha256"),
    )


def _parse_capability(value: object) -> CapabilityDefinition:
    if not isinstance(value, dict):
        raise ValueError("Invalid capability definition")
    return CapabilityDefinition(
        capability_id=_required_string(value, "id"),
        domain=_required_string(value, "domain"),
        tool_names=_string_tuple(value, "toolNames"),
        when_to_use=_required_string(value, "whenToUse"),
        must_not_use_for=_string_tuple(value, "mustNotUseFor"),
        positive_examples=_string_tuple(value, "positiveExamples"),
    )


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
