from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from app.agent_planner_evaluation import (
    build_evaluation_input_hashes,
    build_evaluation_report,
    evaluate_suite,
    load_evaluation_suite,
    load_meeting_regression_suite,
)
from app.agent_processor import OpenAiAgentPlannerClient


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the Agent planner quality suite without executing any Agent tool."
    )
    parser.add_argument(
        "--suite",
        type=Path,
        default=Path("evals/agent_planner_korean_v1.json"),
        help="Path to the fixed evaluation suite JSON or the Meeting catalog tool snapshot.",
    )
    parser.add_argument(
        "--meeting-catalog",
        type=Path,
        help="Path to the Meeting regression capability catalog JSON.",
    )
    parser.add_argument(
        "--meeting-variant",
        choices=("canonical", "held_out"),
        default="canonical",
        help="Meeting regression prompt set to evaluate when --meeting-catalog is provided.",
    )
    parser.add_argument("--current-date", required=True, help="Planner current date in YYYY-MM-DD.")
    parser.add_argument("--timezone", default="Asia/Seoul")
    parser.add_argument(
        "--repetitions",
        type=int,
        default=1,
        help="Number of times to run every fixed case. Defaults to 1.",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("OPENAI_AGENT_PLANNER_MODEL", "gpt-5.4-mini"),
    )
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required")

    suite = (
        load_meeting_regression_suite(
            args.meeting_catalog,
            args.suite,
            args.meeting_variant,
        )
        if args.meeting_catalog
        else load_evaluation_suite(args.suite)
    )
    results = evaluate_suite(
        OpenAiAgentPlannerClient(api_key, args.model),
        suite,
        current_date=args.current_date,
        timezone=args.timezone,
        repetitions=args.repetitions,
    )
    report = build_evaluation_report(results)
    report["metadata"] = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "model": args.model,
        "currentDate": args.current_date,
        "timezone": args.timezone,
        "repetitions": args.repetitions,
        "suiteVersion": suite.version,
        "toolSchemaVersion": suite.job.tool_schema_version,
        **build_evaluation_input_hashes(args.suite, args.meeting_catalog),
        "sourceRevision": _git_revision(),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


def _git_revision() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


if __name__ == "__main__":
    main()
