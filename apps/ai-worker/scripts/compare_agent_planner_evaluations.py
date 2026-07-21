from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.agent_planner_comparison import build_multiturn_context_comparison


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare paired baseline and candidate multi-turn context reports."
    )
    parser.add_argument("--baseline-report", action="append", type=Path, required=True)
    parser.add_argument("--candidate-report", action="append", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    if len(args.baseline_report) != 1 or len(args.candidate_report) != 1:
        raise SystemExit(
            "Multi-turn comparison requires exactly one baseline and one candidate report"
        )
    comparison = build_multiturn_context_comparison(
        _load(args.baseline_report[0]),
        _load(args.candidate_report[0]),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(comparison, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0


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
