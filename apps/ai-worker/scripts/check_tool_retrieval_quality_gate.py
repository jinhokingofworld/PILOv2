from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.agent_tool_quality_gate import (
    evaluate_tool_retrieval_quality_gate,
    fixture_sha256,
    load_tool_retrieval_quality_fixture,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the deterministic Tool Discovery Phase 0 quality gate."
    )
    parser.add_argument(
        "--fixture",
        type=Path,
        default=Path("evals/tool_retrieval_quality_gate_v1.json"),
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    fixture = load_tool_retrieval_quality_fixture(args.fixture)
    report = evaluate_tool_retrieval_quality_gate(
        fixture,
        fixture_sha256=fixture_sha256(args.fixture),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
