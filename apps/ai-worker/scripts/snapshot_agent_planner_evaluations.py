from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.agent_planner_comparison import (
    build_agent_performance_snapshot,
    build_multiturn_context_snapshot,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build an absolute multi-turn Agent context performance snapshot."
    )
    parser.add_argument("--report", action="append", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    reports = [_load(path) for path in args.report]
    snapshot = (
        build_multiturn_context_snapshot(reports[0])
        if len(reports) == 1 and isinstance(reports[0].get("multiTurnContextEvaluation"), dict)
        else build_agent_performance_snapshot(reports)
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
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
