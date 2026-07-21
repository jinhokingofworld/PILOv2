from app.agent_context_resolution import resolve_agent_context


def reference(
    index: int,
    *,
    domain: str = "drive",
    resource_type: str = "document",
    generation: int = 1,
    status: str | None = None,
    source: str = "tool_result",
) -> dict[str, object]:
    return {
        "domain": domain,
        "resourceType": resource_type,
        "contextRef": f"ctx_{index:024x}",
        "label": f"result {index}",
        "ordinal": index,
        "generation": generation,
        "source": source,
        **({"status": status} if status is not None else {}),
    }


def state(*references: dict[str, object], active_domain: str = "drive") -> dict[str, object]:
    return {
        "version": 1,
        "activeDomain": active_domain,
        "resultSets": list(references),
        "lastToolState": {"toolName": "search", "outcome": "completed"},
        "provenance": {"turnSequence": 1, "stepOrder": 1},
    }


def test_resolves_single_anaphoric_candidate() -> None:
    item = reference(1)

    resolution = resolve_agent_context("그 문서 요약해줘", state(item))

    assert resolution.status == "resolved"
    assert resolution.target is not None
    assert resolution.target.context_ref == item["contextRef"]


def test_new_request_is_not_applicable() -> None:
    current_state = state(reference(1))
    current_state["selectedTarget"] = {
        "contextRef": current_state["resultSets"][0]["contextRef"],
        "generation": 1,
        "source": "tool_result",
    }

    resolution = resolve_agent_context("새 일정을 만들어줘", current_state)

    assert resolution.status == "not_applicable"
    assert resolution.target is None


def test_zero_and_many_candidates_fail_closed() -> None:
    missing = resolve_agent_context("그거 열어줘", state())
    ambiguous = resolve_agent_context(
        "그 문서 열어줘",
        state(reference(1), reference(2)),
    )

    assert missing.status == "needs_clarification"
    assert missing.reason_code == "context_candidate_missing"
    assert ambiguous.status == "needs_clarification"
    assert ambiguous.reason_code == "context_candidate_ambiguous"


def test_ordinal_and_correction_exclusion_are_deterministic() -> None:
    first = reference(1)
    second = reference(2)
    current_state = state(first, second)
    current_state["selectedTarget"] = {
        "contextRef": first["contextRef"],
        "generation": first["generation"],
        "source": "candidate_button",
    }

    ordinal = resolve_agent_context("두 번째 문서", current_state)
    correction = resolve_agent_context("아니, 두 번째", current_state)
    last = resolve_agent_context("마지막 문서", current_state)

    assert ordinal.target is not None
    assert ordinal.target.context_ref == second["contextRef"]
    assert correction.target is not None
    assert correction.target.context_ref == second["contextRef"]
    assert correction.payload()["constraints"]["excludedContextRefs"] == [first["contextRef"]]
    assert last.target is not None
    assert last.target.context_ref == second["contextRef"]
    assert last.payload()["constraints"]["position"] == "last"


def test_assignee_and_date_refinement_preserve_selected_target() -> None:
    action_item = reference(
        1,
        domain="meeting",
        resource_type="meeting_report_action_item",
    )
    current_state = state(action_item, active_domain="meeting")
    current_state["selectedTarget"] = {
        "contextRef": action_item["contextRef"],
        "generation": action_item["generation"],
        "source": "tool_result",
    }

    resolution = resolve_agent_context("내 담당만 이번 주 것으로 좁혀줘", current_state)

    assert resolution.target is not None
    assert resolution.target.context_ref == action_item["contextRef"]
    assert resolution.payload()["constraints"]["assigneeSelf"] is True
    assert resolution.payload()["constraints"]["date"] == "this_week"


def test_explicit_domain_switch_does_not_reuse_previous_target() -> None:
    document = reference(1)
    current_state = state(document)
    current_state["selectedTarget"] = {
        "contextRef": document["contextRef"],
        "generation": document["generation"],
        "source": "tool_result",
    }

    resolution = resolve_agent_context("그거 말고 일정 보여줘", current_state)

    assert resolution.status == "not_applicable"
    assert resolution.reason_code == "explicit_domain_switch"
    assert resolution.payload()["constraints"]["domains"] == ["calendar"]
    assert resolution.payload()["constraints"]["excludedContextRefs"] == [document["contextRef"]]


def test_constraint_refinement_and_domain_switch() -> None:
    open_issue = reference(
        1,
        domain="board",
        resource_type="issue",
        status="open",
    )
    closed_issue = reference(
        2,
        domain="board",
        resource_type="issue",
        status="closed",
    )
    document = reference(1, generation=2)
    current_state = state(open_issue, closed_issue, document)

    refined = resolve_agent_context("그 열린 이슈", current_state)
    incomplete = resolve_agent_context("그 미완료 이슈", current_state)
    switched = resolve_agent_context("아까 찾은 보드 이슈 두 번째", current_state)

    assert refined.target is not None
    assert refined.target.context_ref == open_issue["contextRef"]
    assert incomplete.target is not None
    assert incomplete.target.context_ref == open_issue["contextRef"]
    assert switched.target is not None
    assert switched.target.context_ref == closed_issue["contextRef"]


def test_stale_explicit_reference_and_conflicting_constraints_fail_closed() -> None:
    current_state = state(reference(1, status="open"))

    stale = resolve_agent_context("ctx_ffffffffffffffffffffffff 열어줘", current_state)
    conflict = resolve_agent_context("그 열린 동시에 완료된 문서", current_state)
    date_conflict = resolve_agent_context("그 문서를 오늘과 내일로 좁혀줘", current_state)

    assert stale.status == "needs_clarification"
    assert stale.reason_code == "context_reference_stale"
    assert conflict.status == "needs_clarification"
    assert conflict.reason_code == "context_constraint_conflict"
    assert date_conflict.status == "needs_clarification"
    assert date_conflict.reason_code == "context_constraint_conflict"


def test_selected_candidate_reference_keeps_candidate_source() -> None:
    candidate = reference(1, source="candidate")
    current_state = state(candidate)
    current_state["selectedTarget"] = {
        "contextRef": candidate["contextRef"],
        "generation": candidate["generation"],
        "source": "candidate_button",
    }

    resolution = resolve_agent_context("선택한 것으로 계속해줘", current_state)

    assert resolution.target is not None
    assert resolution.target.source == "candidate"
