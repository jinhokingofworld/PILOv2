from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal, Protocol


OutcomeJudgeLabel = Literal["pass", "partial", "fail", "inconclusive"]


@dataclass(frozen=True)
class OutcomeJudgeEvidence:
    user_task: str
    expected_outcome: str
    tool_facts: tuple[str, ...]
    final_answer: str
    terminal_state: str
    safety_passed: bool


@dataclass(frozen=True)
class OutcomeJudgeVerdict:
    task_fulfilled: bool
    grounded_in_tool_evidence: bool
    contains_material_error: bool
    verdict: OutcomeJudgeLabel
    failure_codes: tuple[str, ...]


class OutcomeJudgeClient(Protocol):
    def judge(self, evidence: OutcomeJudgeEvidence) -> str: ...


class OpenAiOutcomeJudge:
    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        from openai import OpenAI

        self.client = OpenAI(api_key=api_key, timeout=timeout_seconds)
        self.model = model

    def judge(self, evidence: OutcomeJudgeEvidence) -> str:
        response = self.client.responses.create(
            model=self.model,
            temperature=0,
            input=[
                {"role": "system", "content": _OUTCOME_JUDGE_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "userTask": evidence.user_task,
                            "expectedOutcome": evidence.expected_outcome,
                            "toolFacts": evidence.tool_facts,
                            "finalAnswer": evidence.final_answer,
                            "terminalState": evidence.terminal_state,
                            "safetyPassed": evidence.safety_passed,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "agent_outcome_judge",
                    "strict": True,
                    "schema": _OUTCOME_JUDGE_SCHEMA,
                }
            },
        )
        output = getattr(response, "output_text", None)
        if not isinstance(output, str) or not output.strip():
            raise ValueError("Outcome Judge returned no text")
        return output


_OUTCOME_JUDGE_SYSTEM_PROMPT = (
    "Judge only the supplied evidence. Do not infer unstated facts or reward wording. "
    "Return pass only when the user task is fulfilled, grounded in tool facts, and materially correct."
)
_OUTCOME_JUDGE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "taskFulfilled",
        "groundedInToolEvidence",
        "containsMaterialError",
        "verdict",
        "failureCodes",
    ],
    "properties": {
        "taskFulfilled": {"type": "boolean"},
        "groundedInToolEvidence": {"type": "boolean"},
        "containsMaterialError": {"type": "boolean"},
        "verdict": {"type": "string", "enum": ["pass", "partial", "fail", "inconclusive"]},
        "failureCodes": {"type": "array", "items": {"type": "string"}},
    },
}


def judge_outcome(
    evidence: OutcomeJudgeEvidence,
    judge: OutcomeJudgeClient,
) -> OutcomeJudgeVerdict:
    votes = tuple(_judge_once(evidence, judge) for _ in range(3))
    if any("judge_unavailable" in vote.failure_codes for vote in votes):
        return OutcomeJudgeVerdict(
            task_fulfilled=False,
            grounded_in_tool_evidence=False,
            contains_material_error=False,
            verdict="inconclusive",
            failure_codes=tuple(
                dict.fromkeys(code for vote in votes for code in vote.failure_codes)
            ),
        )
    for label in ("pass", "partial", "fail", "inconclusive"):
        matching = tuple(vote for vote in votes if vote.verdict == label)
        if len(matching) >= 2:
            return matching[0]
    return OutcomeJudgeVerdict(
        task_fulfilled=False,
        grounded_in_tool_evidence=False,
        contains_material_error=False,
        verdict="inconclusive",
        failure_codes=tuple(
            dict.fromkeys(
                code for vote in votes for code in (*vote.failure_codes, "judge_vote_split")
            )
        ),
    )


def _judge_once(
    evidence: OutcomeJudgeEvidence,
    judge: OutcomeJudgeClient,
) -> OutcomeJudgeVerdict:
    try:
        return parse_outcome_judge_verdict(judge.judge(evidence))
    except Exception:
        return OutcomeJudgeVerdict(
            task_fulfilled=False,
            grounded_in_tool_evidence=False,
            contains_material_error=False,
            verdict="inconclusive",
            failure_codes=("judge_unavailable",),
        )


def parse_outcome_judge_verdict(raw: str) -> OutcomeJudgeVerdict:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("Outcome Judge must return valid JSON") from error
    if not isinstance(payload, dict):
        raise ValueError("Outcome Judge response must be an object")

    task_fulfilled = payload.get("taskFulfilled")
    grounded_in_tool_evidence = payload.get("groundedInToolEvidence")
    contains_material_error = payload.get("containsMaterialError")
    verdict = payload.get("verdict")
    failure_codes = payload.get("failureCodes")
    if not all(
        isinstance(value, bool)
        for value in (task_fulfilled, grounded_in_tool_evidence, contains_material_error)
    ):
        raise ValueError("Outcome Judge response booleans are invalid")
    if verdict not in {"pass", "partial", "fail", "inconclusive"}:
        raise ValueError("Outcome Judge verdict is invalid")
    if not isinstance(failure_codes, list) or not all(
        isinstance(code, str) and code.strip() for code in failure_codes
    ):
        raise ValueError("Outcome Judge failure codes are invalid")
    if verdict == "pass" and (
        not task_fulfilled or not grounded_in_tool_evidence or contains_material_error
    ):
        raise ValueError("Outcome Judge pass verdict is contradictory")

    return OutcomeJudgeVerdict(
        task_fulfilled=task_fulfilled,
        grounded_in_tool_evidence=grounded_in_tool_evidence,
        contains_material_error=contains_material_error,
        verdict=verdict,
        failure_codes=tuple(code.strip() for code in failure_codes),
    )
