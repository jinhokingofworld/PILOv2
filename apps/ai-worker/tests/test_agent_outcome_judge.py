from app.agent_outcome_judge import (
    MultiTurnJudgeEvidence,
    OutcomeJudgeEvidence,
    judge_multiturn_context,
    judge_outcome,
    parse_outcome_judge_verdict,
)


def test_multiturn_judge_requires_a_pass_majority_and_deterministic_context_gate() -> None:
    class ScriptedJudge:
        def __init__(self) -> None:
            self.outputs = iter(("pass", "partial", "pass"))

        def judge(self, _evidence: MultiTurnJudgeEvidence) -> str:
            label = next(self.outputs)
            return (
                "{"
                f'"contextResolved":{str(label == "pass").lower()},'
                f'"followUpDelivered":{str(label == "pass").lower()},'
                '"containsMaterialError":false,'
                f'"verdict":"{label}","failureCodes":[]'
                "}"
            )

    evidence = MultiTurnJudgeEvidence(
        conversation_history=("Show the meeting report.", "What actions came from it?"),
        tool_trace=("list_meeting_reports", "find_action_items"),
        expected_context_transition="Use the prior report contextRef.",
        tool_facts=("find_action_items.items: Write the proposal",),
        expected_outcome_facts=("Write the proposal",),
        final_answer="The follow-up action is to write the proposal.",
        deterministic_context_passed=True,
    )

    verdict = judge_multiturn_context(evidence, ScriptedJudge())

    assert verdict.verdict == "pass"
    assert verdict.context_resolved is True
    assert verdict.follow_up_delivered is True

    blocked = judge_multiturn_context(
        MultiTurnJudgeEvidence(
            conversation_history=evidence.conversation_history,
            tool_trace=evidence.tool_trace,
            expected_context_transition=evidence.expected_context_transition,
            tool_facts=evidence.tool_facts,
            expected_outcome_facts=evidence.expected_outcome_facts,
            final_answer=evidence.final_answer,
            deterministic_context_passed=False,
        ),
        ScriptedJudge(),
    )
    assert blocked.verdict == "fail"
    assert blocked.failure_codes == ("deterministic_context_gate",)


def test_multiturn_judge_marks_provider_error_or_vote_split_inconclusive() -> None:
    class FlakyJudge:
        def __init__(self, outputs: tuple[str, ...]) -> None:
            self.outputs = iter(outputs)

        def judge(self, _evidence: MultiTurnJudgeEvidence) -> str:
            label = next(self.outputs)
            if label == "error":
                raise RuntimeError("provider unavailable")
            return (
                "{"
                f'"contextResolved":{str(label == "pass").lower()},'
                f'"followUpDelivered":{str(label == "pass").lower()},'
                '"containsMaterialError":false,'
                f'"verdict":"{label}","failureCodes":[]'
                "}"
            )

    evidence = MultiTurnJudgeEvidence(("a", "b"), (), "reference", (), (), "answer", True)

    provider_error = judge_multiturn_context(evidence, FlakyJudge(("pass", "error", "pass")))
    split = judge_multiturn_context(evidence, FlakyJudge(("pass", "partial", "fail")))

    assert provider_error.verdict == "inconclusive"
    assert "judge_unavailable" in provider_error.failure_codes
    assert split.verdict == "inconclusive"
    assert "judge_vote_split" in split.failure_codes


def test_parses_a_valid_pass_verdict() -> None:
    verdict = parse_outcome_judge_verdict(
        '{"taskFulfilled":true,"groundedInToolEvidence":true,'
        '"containsMaterialError":false,"verdict":"pass","failureCodes":[]}'
    )

    assert verdict.verdict == "pass"
    assert verdict.task_fulfilled is True
    assert verdict.grounded_in_tool_evidence is True
    assert verdict.contains_material_error is False
    assert verdict.failure_codes == ()


def test_judge_outcome_passes_only_minimized_evidence_to_the_judge() -> None:
    class ScriptedJudge:
        def __init__(self) -> None:
            self.evidence: OutcomeJudgeEvidence | None = None

        def judge(self, evidence: OutcomeJudgeEvidence) -> str:
            self.evidence = evidence
            return (
                '{"taskFulfilled":true,"groundedInToolEvidence":true,'
                '"containsMaterialError":false,"verdict":"pass","failureCodes":[]}'
            )

    judge = ScriptedJudge()
    evidence = OutcomeJudgeEvidence(
        user_task="Find the login incident document.",
        expected_outcome="Identify the document and explain its evidence.",
        tool_facts=("title: Login incident", "excerpt: Check OAuth callback."),
        final_answer="The login incident document says to check OAuth callback.",
        terminal_state="completed",
        safety_passed=True,
    )

    verdict = judge_outcome(evidence, judge)

    assert verdict.verdict == "pass"
    assert judge.evidence == evidence


def test_judge_outcome_uses_three_votes_and_returns_the_majority() -> None:
    class ScriptedJudge:
        def __init__(self) -> None:
            self.outputs = iter(("pass", "fail", "pass"))
            self.calls = 0

        def judge(self, _evidence: OutcomeJudgeEvidence) -> str:
            self.calls += 1
            label = next(self.outputs)
            return (
                "{"
                f'"taskFulfilled":{str(label == "pass").lower()},'
                f'"groundedInToolEvidence":{str(label == "pass").lower()},'
                '"containsMaterialError":false,'
                f'"verdict":"{label}","failureCodes":[]'
                "}"
            )

    judge = ScriptedJudge()
    verdict = judge_outcome(
        OutcomeJudgeEvidence("task", "outcome", (), "answer", "completed", True),
        judge,
    )

    assert verdict.verdict == "pass"
    assert judge.calls == 3


def test_judge_error_makes_the_outcome_inconclusive() -> None:
    class FlakyJudge:
        def __init__(self) -> None:
            self.calls = 0

        def judge(self, _evidence: OutcomeJudgeEvidence) -> str:
            self.calls += 1
            if self.calls == 2:
                raise RuntimeError("provider unavailable")
            return (
                '{"taskFulfilled":true,"groundedInToolEvidence":true,'
                '"containsMaterialError":false,"verdict":"pass","failureCodes":[]}'
            )

    verdict = judge_outcome(
        OutcomeJudgeEvidence("task", "outcome", (), "answer", "completed", True), FlakyJudge()
    )

    assert verdict.verdict == "inconclusive"
    assert "judge_unavailable" in verdict.failure_codes


def test_rejects_a_contradictory_pass_verdict() -> None:
    raw = (
        '{"taskFulfilled":false,"groundedInToolEvidence":false,'
        '"containsMaterialError":true,"verdict":"pass","failureCodes":[]}'
    )

    try:
        parse_outcome_judge_verdict(raw)
    except ValueError:
        pass
    else:
        raise AssertionError("contradictory pass verdict must be rejected")
