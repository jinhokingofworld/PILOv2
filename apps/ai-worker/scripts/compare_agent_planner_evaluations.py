from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.agent_planner_comparison import build_two_stage_comparison


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare paired baseline and candidate LLM Router -> Planner reports."
    )
    parser.add_argument("--baseline-report", action="append", type=Path, required=True)
    parser.add_argument("--candidate-report", action="append", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    comparison = build_two_stage_comparison(
        [_load(path) for path in args.baseline_report],
        [_load(path) for path in args.candidate_report],
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(comparison, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0 if comparison["improvementEvidence"]["passed"] is True else 1


def _load(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Invalid evaluation report: {path}") from error
    if not isinstance(value, dict):
        raise SystemExit(f"Invalid evaluation report: {path}")
    return value


if __name__ == "__main__":
    raise SystemExit(main())
