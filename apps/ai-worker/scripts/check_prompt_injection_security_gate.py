from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from app.agent_prompt_security import (
    PROMPT_SECURITY_GATE_VERSION,
    PromptSecuritySource,
    assess_agent_prompt_security,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the deterministic Agent prompt-injection security gate."
    )
    parser.add_argument(
        "--fixture",
        type=Path,
        default=Path("evals/prompt_injection_security_gate_v1.json"),
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    fixture_bytes = args.fixture.read_bytes()
    fixture = json.loads(fixture_bytes)
    if not isinstance(fixture, dict) or not isinstance(fixture.get("cases"), list):
        raise ValueError("Prompt security fixture requires a cases array")
    if fixture.get("detectorVersion") != PROMPT_SECURITY_GATE_VERSION:
        raise ValueError("Prompt security fixture detector version mismatch")

    failures: list[dict[str, object]] = []
    blocked = 0
    allowed = 0
    for item in fixture["cases"]:
        if not isinstance(item, dict):
            raise ValueError("Prompt security fixture case must be an object")
        case_id = item.get("id")
        source_kind = item.get("sourceKind")
        text = item.get("text")
        expected_suspected = item.get("expectedSuspected")
        expected_signals = item.get("expectedSignalTypes")
        if (
            not isinstance(case_id, str)
            or source_kind
            not in {
                "current_user",
                "user_follow_up",
                "thread_resource",
                "tool_result",
                "selected_candidate",
                "grounded_evidence",
            }
            or not isinstance(text, str)
            or not isinstance(expected_suspected, bool)
            or not isinstance(expected_signals, list)
            or not all(isinstance(signal, str) for signal in expected_signals)
        ):
            raise ValueError("Invalid prompt security fixture case")

        prompt = (
            text
            if source_kind in {"current_user", "user_follow_up"}
            else "최근 회의록 내용을 알려줘"
        )
        context_sources = (
            ()
            if source_kind in {"current_user", "user_follow_up"}
            else (PromptSecuritySource(source_kind, text),)
        )
        assessment = assess_agent_prompt_security(
            prompt,
            context_sources,
            prompt_source_kind=source_kind if not context_sources else "current_user",
        )
        expected_source_kinds = [source_kind] if expected_suspected else []
        if assessment.suspected:
            blocked += 1
        else:
            allowed += 1
        if (
            assessment.suspected != expected_suspected
            or set(assessment.signal_types) != set(expected_signals)
            or list(assessment.source_kinds) != expected_source_kinds
        ):
            failures.append(
                {
                    "caseId": case_id,
                    "expectedSuspected": expected_suspected,
                    "actualSuspected": assessment.suspected,
                    "expectedSignalTypes": sorted(expected_signals),
                    "actualSignalTypes": list(assessment.signal_types),
                    "expectedSourceKinds": expected_source_kinds,
                    "actualSourceKinds": list(assessment.source_kinds),
                }
            )

    report = {
        "version": fixture.get("version"),
        "detectorVersion": PROMPT_SECURITY_GATE_VERSION,
        "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "caseCount": len(fixture["cases"]),
        "blockedCount": blocked,
        "allowedCount": allowed,
        "passed": not failures,
        "failures": failures,
    }
    output = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
