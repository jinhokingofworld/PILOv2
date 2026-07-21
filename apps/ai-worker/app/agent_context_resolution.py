from __future__ import annotations

import re
from dataclasses import dataclass

_CONTEXT_REF_PATTERN = re.compile(r"ctx_[0-9a-f]{24}")
_ORDINAL_PATTERNS = (
    re.compile(r"(?<!\d)(\d{1,2})\s*번(?:째)?"),
    re.compile(r"\b(?:number|option|item)\s*(\d{1,2})\b", re.IGNORECASE),
    re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)\b", re.IGNORECASE),
)
_LAST_ORDINAL_SIGNAL = re.compile(r"마지막|맨\s*끝|\b(?:last|final)\b", re.IGNORECASE)
_KOREAN_ORDINALS = {
    "첫 번째": 1,
    "첫번째": 1,
    "첫째": 1,
    "두 번째": 2,
    "두번째": 2,
    "둘째": 2,
    "세 번째": 3,
    "세번째": 3,
    "셋째": 3,
    "네 번째": 4,
    "네번째": 4,
    "넷째": 4,
    "다섯 번째": 5,
    "다섯번째": 5,
}
_REFERENCE_SIGNAL = re.compile(
    r"그거|그것|그걸|(?:^|\s)그(?:\s|$)|그\s+(?:회의|회의록|일정|이슈|문서|파일|세션|PR)|"
    r"아까|방금|앞에서|위에서|이어서|계속|선택한|해당|"
    r"\b(?:it|that|this one|the previous|the selected|above|continue)\b",
    re.IGNORECASE,
)
_CORRECTION_SIGNAL = re.compile(
    r"말고|아니고|아니\s*[,，]|제외|빼고|대신|다른|" r"\b(?:not that|instead|exclude|other)\b",
    re.IGNORECASE,
)
_ASSIGNEE_SELF_SIGNAL = re.compile(
    r"내\s*(?:담당|할당)|나에게\s*(?:할당|배정)|\bassigned\s+to\s+me\b",
    re.IGNORECASE,
)
_RELATIVE_DATE_ALIASES = {
    "today": ("오늘", "today"),
    "tomorrow": ("내일", "tomorrow"),
    "this_week": ("이번 주", "금주", "this week"),
    "next_week": ("다음 주", "차주", "next week"),
}
_ISO_DATE_PATTERN = re.compile(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)")

_DOMAIN_ALIASES = {
    "meeting": ("회의", "회의록", "meeting", "report"),
    "calendar": ("일정", "캘린더", "calendar", "event"),
    "board": ("보드", "이슈", "칸반", "board", "issue", "kanban"),
    "drive": ("문서", "드라이브", "파일", "drive", "document", "file"),
    "sqltoerd": ("erd", "sql", "스키마", "테이블", "schema", "table"),
    "pr_review": ("pr", "리뷰", "pull request", "review"),
}
_RESOURCE_TYPE_ALIASES = {
    "meeting_report": ("회의록", "meeting report"),
    "meeting_report_action_item": ("후속작업", "액션 아이템", "action item"),
    "meeting": ("회의", "meeting"),
    "meeting_room": ("회의실", "meeting room"),
    "event": ("일정", "event"),
    "issue": ("이슈", "issue"),
    "document": ("문서", "파일", "document", "file"),
    "session": ("세션", "session"),
    "review_file": ("리뷰 파일", "review file"),
}
_STATUS_ALIASES = {
    "completed": ("완료", "completed", "done"),
    "open": ("열린", "미완료", "open"),
    "closed": ("닫힌", "종료", "closed"),
    "approved": ("승인", "approved"),
    "pending": ("대기", "pending"),
    "failed": ("실패", "failed"),
}


@dataclass(frozen=True)
class ContextTarget:
    context_ref: str
    domain: str
    resource_type: str
    ordinal: int
    generation: int
    source: str

    def payload(self) -> dict[str, object]:
        return {
            "contextRef": self.context_ref,
            "domain": self.domain,
            "resourceType": self.resource_type,
            "ordinal": self.ordinal,
            "generation": self.generation,
            "source": self.source,
        }


@dataclass(frozen=True)
class ContextResolution:
    status: str
    reason_code: str
    target: ContextTarget | None = None
    constraints: tuple[tuple[str, object], ...] = ()
    clarification_question: str | None = None

    def payload(self) -> dict[str, object]:
        return {
            "version": "agent-context-resolution:v1",
            "status": self.status,
            "reasonCode": self.reason_code,
            "target": self.target.payload() if self.target is not None else None,
            "constraints": dict(self.constraints),
            "clarificationQuestion": self.clarification_question,
        }


def resolve_agent_context(prompt: str, context_state: object) -> ContextResolution:
    selected_target, references, active_domain = _read_context_state(context_state)
    explicit_refs = tuple(dict.fromkeys(_CONTEXT_REF_PATTERN.findall(prompt)))
    ordinals = _read_ordinals(prompt)
    last_requested = _LAST_ORDINAL_SIGNAL.search(prompt) is not None
    domains = _matching_aliases(prompt, _DOMAIN_ALIASES)
    resource_types = _matching_aliases(prompt, _RESOURCE_TYPE_ALIASES)
    statuses = _matching_aliases(prompt, _STATUS_ALIASES)
    assignee_self = _ASSIGNEE_SELF_SIGNAL.search(prompt) is not None
    date_constraints = _read_date_constraints(prompt)
    date_constraint = date_constraints[0] if len(date_constraints) == 1 else None
    correction_match = _CORRECTION_SIGNAL.search(prompt)
    hard_reference_signal = bool(
        explicit_refs
        or ordinals
        or last_requested
        or _REFERENCE_SIGNAL.search(prompt)
        or correction_match
    )
    current_domain = selected_target.domain if selected_target is not None else active_domain
    refinement_signal = bool(
        references
        and current_domain
        and (statuses or assignee_self or date_constraints)
        and (not domains or current_domain in domains)
    )
    has_reference_signal = hard_reference_signal or refinement_signal
    if not has_reference_signal:
        return ContextResolution("not_applicable", "new_request")
    if not references:
        return _clarification("context_candidate_missing")

    by_ref = {target.context_ref: target for target in references}
    if len(explicit_refs) > 1:
        return _clarification("context_reference_conflict")
    if explicit_refs:
        target = by_ref.get(explicit_refs[0])
        if target is None:
            return _clarification("context_reference_stale")
        return _resolved(target, explicit_context_ref=target.context_ref)

    if len(statuses) > 1:
        return _clarification("context_constraint_conflict")
    if len(date_constraints) > 1 and references:
        return _clarification("context_constraint_conflict")

    correction = correction_match is not None
    if correction_match is not None and current_domain is not None:
        switched_domains = _matching_aliases(
            prompt[correction_match.end() :],
            _DOMAIN_ALIASES,
        )
        if len(switched_domains) == 1 and current_domain not in switched_domains:
            constraints: list[tuple[str, object]] = [
                ("domains", sorted(switched_domains)),
                ("excludedDomains", [current_domain]),
            ]
            if selected_target is not None:
                constraints.append(("excludedContextRefs", [selected_target.context_ref]))
            return ContextResolution(
                "not_applicable",
                "explicit_domain_switch",
                constraints=tuple(constraints),
            )

    candidates = list(references)
    if domains:
        candidates = [target for target in candidates if target.domain in domains]
        if not candidates:
            return _clarification("context_domain_switch_empty")
    elif active_domain:
        active_candidates = [target for target in candidates if target.domain == active_domain]
        if active_candidates:
            candidates = active_candidates
    if resource_types:
        candidates = [target for target in candidates if target.resource_type in resource_types]
        if not candidates:
            return _clarification("context_resource_type_empty")

    status = next(iter(statuses), None)
    if status is not None:
        candidates = [
            target
            for target in candidates
            if _reference_status(context_state, target.context_ref) == status
        ]
        if not candidates:
            return _clarification("context_constraint_empty")

    candidates = _latest_result_group(candidates)
    excluded_refs: list[str] = []
    if correction and selected_target is not None:
        excluded_refs.append(selected_target.context_ref)
        candidates = [
            target for target in candidates if target.context_ref != selected_target.context_ref
        ]

    requested_ordinal: int | None = None
    if ordinals and last_requested:
        return _clarification("context_ordinal_conflict")
    if ordinals:
        requested_ordinal = ordinals[-1] if correction else ordinals[0]
        if not correction and len(set(ordinals)) > 1:
            return _clarification("context_ordinal_conflict")
        if correction and len(ordinals) > 1:
            excluded_ordinals = set(ordinals[:-1])
            excluded_refs.extend(
                target.context_ref for target in candidates if target.ordinal in excluded_ordinals
            )
            candidates = [
                target for target in candidates if target.ordinal not in excluded_ordinals
            ]
        ordinal_matches = [target for target in candidates if target.ordinal == requested_ordinal]
        if len(ordinal_matches) != 1:
            return _clarification("context_ordinal_stale")
        candidates = ordinal_matches
    elif last_requested:
        if not candidates:
            return _clarification("context_ordinal_stale")
        requested_ordinal = max(target.ordinal for target in candidates)
        ordinal_matches = [target for target in candidates if target.ordinal == requested_ordinal]
        if len(ordinal_matches) != 1:
            return _clarification("context_ordinal_stale")
        candidates = ordinal_matches
    elif selected_target is not None and not correction:
        selected = by_ref.get(selected_target.context_ref)
        if selected is None or selected.generation != selected_target.generation:
            return _clarification("context_selected_target_stale")
        if selected not in candidates:
            return _clarification("context_constraint_empty")
        candidates = [selected]

    if len(candidates) != 1:
        return _clarification(
            "context_candidate_missing" if not candidates else "context_candidate_ambiguous"
        )
    constraints: list[tuple[str, object]] = []
    if domains:
        constraints.append(("domains", sorted(domains)))
    if resource_types:
        constraints.append(("resourceTypes", sorted(resource_types)))
    if status is not None:
        constraints.append(("status", status))
    if requested_ordinal is not None:
        constraints.append(("ordinal", requested_ordinal))
    if last_requested:
        constraints.append(("position", "last"))
    if assignee_self:
        constraints.append(("assigneeSelf", True))
    if date_constraint is not None:
        constraints.append(("date", date_constraint))
    if excluded_refs:
        constraints.append(("excludedContextRefs", sorted(set(excluded_refs))))
    return ContextResolution(
        "resolved",
        "context_reference_resolved",
        candidates[0],
        tuple(constraints),
    )


def _read_context_state(
    value: object,
) -> tuple[ContextTarget | None, tuple[ContextTarget, ...], str | None]:
    if not isinstance(value, dict) or value.get("version") != 1:
        return None, (), None
    references: list[ContextTarget] = []
    raw_references = value.get("resultSets")
    if isinstance(raw_references, list):
        for reference in raw_references:
            target = _read_target(reference)
            if target is not None:
                references.append(target)
    selected_target = _read_selected_target(value.get("selectedTarget"), references)
    active_domain = value.get("activeDomain")
    return (
        selected_target,
        tuple(references),
        active_domain if isinstance(active_domain, str) else None,
    )


def _read_target(value: object) -> ContextTarget | None:
    if not isinstance(value, dict):
        return None
    context_ref = value.get("contextRef")
    domain = value.get("domain")
    resource_type = value.get("resourceType")
    ordinal = value.get("ordinal")
    generation = value.get("generation")
    source = value.get("source", "tool_result")
    if (
        not isinstance(context_ref, str)
        or _CONTEXT_REF_PATTERN.fullmatch(context_ref) is None
        or not isinstance(domain, str)
        or not isinstance(resource_type, str)
        or not isinstance(ordinal, int)
        or ordinal < 1
        or not isinstance(generation, int)
        or source not in {"tool_result", "candidate"}
    ):
        return None
    return ContextTarget(context_ref, domain, resource_type, ordinal, generation, source)


def _read_selected_target(
    value: object,
    references: list[ContextTarget],
) -> ContextTarget | None:
    if not isinstance(value, dict):
        return None
    context_ref = value.get("contextRef")
    generation = value.get("generation")
    if not isinstance(context_ref, str) or not isinstance(generation, int):
        return None
    return next(
        (
            target
            for target in references
            if target.context_ref == context_ref and target.generation == generation
        ),
        None,
    )


def _read_ordinals(prompt: str) -> tuple[int, ...]:
    matches: list[tuple[int, int]] = []
    for pattern in _ORDINAL_PATTERNS:
        matches.extend((match.start(), int(match.group(1))) for match in pattern.finditer(prompt))
    for text, value in _KOREAN_ORDINALS.items():
        start = 0
        while (position := prompt.find(text, start)) >= 0:
            matches.append((position, value))
            start = position + len(text)
    return tuple(value for _position, value in sorted(matches))


def _read_date_constraints(prompt: str) -> tuple[str, ...]:
    iso_dates = tuple(dict.fromkeys(_ISO_DATE_PATTERN.findall(prompt)))
    relative_dates = _matching_aliases(prompt, _RELATIVE_DATE_ALIASES)
    return (*iso_dates, *sorted(relative_dates))


def _matching_aliases(
    prompt: str,
    aliases: dict[str, tuple[str, ...]],
) -> set[str]:
    folded = prompt.casefold()
    return {
        canonical
        for canonical, values in aliases.items()
        if any(_alias_matches(folded, alias.casefold()) for alias in values)
    }


def _alias_matches(prompt: str, alias: str) -> bool:
    if alias.isascii() and alias.replace(" ", "").isalnum():
        return re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", prompt) is not None
    if alias == "완료":
        return re.search(r"(?<!미)완료", prompt) is not None
    if alias == "회의":
        return re.search(r"회의(?!록|실)", prompt) is not None
    return alias in prompt


def _latest_result_group(candidates: list[ContextTarget]) -> list[ContextTarget]:
    if not candidates:
        return []
    latest = candidates[-1]
    return [
        target
        for target in candidates
        if target.domain == latest.domain and target.generation == latest.generation
    ]


def _reference_status(context_state: object, context_ref: str) -> str | None:
    if not isinstance(context_state, dict):
        return None
    result_sets = context_state.get("resultSets")
    if not isinstance(result_sets, list):
        return None
    for reference in result_sets:
        if not isinstance(reference, dict) or reference.get("contextRef") != context_ref:
            continue
        status = reference.get("status")
        if not isinstance(status, str):
            return None
        folded = status.casefold()
        for canonical, aliases in _STATUS_ALIASES.items():
            if folded == canonical or any(alias.casefold() == folded for alias in aliases):
                return canonical
        return folded[:100]
    return None


def _resolved(target: ContextTarget, **constraints: object) -> ContextResolution:
    return ContextResolution(
        "resolved",
        "context_reference_resolved",
        target,
        tuple(sorted(constraints.items())),
    )


def _clarification(reason_code: str) -> ContextResolution:
    return ContextResolution(
        "needs_clarification",
        reason_code,
        clarification_question="어느 대상을 뜻하는지 이름이나 번호로 알려주세요.",
    )
