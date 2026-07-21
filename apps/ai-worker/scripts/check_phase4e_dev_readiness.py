from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.phase4e_dev_readiness import (
    Phase4eReadinessInputs,
    evaluate_phase4e_dev_readiness,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate Phase 4-E dev rollout readiness.")
    parser.add_argument("--registry-snapshot", type=Path, required=True)
    parser.add_argument("--tool-retrieval-report", type=Path, required=True)
    parser.add_argument("--prompt-security-report", type=Path, required=True)
    parser.add_argument("--app-server-report", type=Path, required=True)
    parser.add_argument(
        "--meeting-catalog",
        type=Path,
        default=Path("evals/meeting_agent_capability_catalog_v1.json"),
    )
    parser.add_argument("--dev-terraform", type=Path, required=True)
    parser.add_argument("--rollout-runbook", type=Path, required=True)
    parser.add_argument(
        "--meeting-evaluation-report",
        action="append",
        type=Path,
        required=True,
        help="One two-stage LLM Router -> Planner report for each Meeting variant.",
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    report = evaluate_phase4e_dev_readiness(
        Phase4eReadinessInputs(
            registry_snapshot=args.registry_snapshot,
            tool_retrieval_report=args.tool_retrieval_report,
            prompt_security_report=args.prompt_security_report,
            app_server_report=args.app_server_report,
            meeting_catalog=args.meeting_catalog,
            dev_terraform=args.dev_terraform,
            rollout_runbook=args.rollout_runbook,
            meeting_evaluation_reports=tuple(args.meeting_evaluation_report),
        )
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
