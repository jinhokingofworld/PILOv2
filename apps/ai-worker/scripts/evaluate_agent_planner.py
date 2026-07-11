from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from app.agent_planner_evaluation import (
    build_evaluation_report,
    evaluate_suite,
    load_evaluation_suite,
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
        help="Path to the fixed evaluation suite JSON.",
    )
    parser.add_argument("--current-date", required=True, help="Planner current date in YYYY-MM-DD.")
    parser.add_argument("--timezone", default="Asia/Seoul")
    parser.add_argument(
        "--model",
        default=os.environ.get("OPENAI_AGENT_PLANNER_MODEL", "gpt-5.4-mini"),
    )
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required")

    suite = load_evaluation_suite(args.suite)
    results = evaluate_suite(
        OpenAiAgentPlannerClient(api_key, args.model),
        suite,
        current_date=args.current_date,
        timezone=args.timezone,
    )
    print(json.dumps(build_evaluation_report(results), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
