from __future__ import annotations

import argparse
import json
import os
import subprocess
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from app.agent_planner_evaluation import (
    attach_tool_capability_catalog,
    build_evaluation_input_hashes,
    build_evaluation_report,
    build_legacy_shadow_comparison,
    evaluate_suite,
    load_evaluation_suite,
    load_meeting_regression_suite,
)
from app.agent_processor import OpenAiAgentPlannerClient
from app.agent_tool_retrieval import TOOL_RETRIEVER_VERSION


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
        "--tool-capability-catalog",
        type=Path,
        help="Path to an App Server-generated capability catalog snapshot.",
    )
    parser.add_argument(
        "--meeting-variant",
        choices=("canonical", "held_out", "counterexample", "context"),
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
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=60.0,
        help="Provider request timeout for each offline planner call. Defaults to 60 seconds.",
    )
    retrieval_mode = parser.add_mutually_exclusive_group()
    retrieval_mode.add_argument(
        "--shadow-retrieval",
        action="store_true",
        help=(
            "Use the job capability catalog to give the offline evaluator a shortlist only; "
            "this never executes a tool."
        ),
    )
    parser.add_argument(
        "--retrieval-top-k",
        type=int,
        default=8,
        help="Maximum tool schemas supplied by the shadow retriever. Defaults to 8.",
    )
    retrieval_mode.add_argument(
        "--compare-shadow-retrieval",
        action="store_true",
        help="Run both legacy and shadow retrieval with the same fixed inputs.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=0,
        help="Fixed evaluation seed shared by legacy and shadow runs. Defaults to 0.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Write the JSON evaluation report to this path instead of standard output.",
    )
    parser.add_argument(
        "--shard-count",
        type=int,
        default=1,
        help="Split deterministic case order into this many shards. Defaults to 1.",
    )
    parser.add_argument(
        "--shard-index",
        type=int,
        default=0,
        help="Zero-based shard index. Defaults to 0.",
    )
    args = parser.parse_args()
    if args.shard_count < 1 or not 0 <= args.shard_index < args.shard_count:
        raise SystemExit("--shard-index must be within [0, --shard-count)")

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
    if args.tool_capability_catalog:
        suite = attach_tool_capability_catalog(suite, args.tool_capability_catalog)
    if args.shard_count > 1:
        suite = replace(
            suite,
            cases=tuple(
                case
                for index, case in enumerate(suite.cases)
                if index % args.shard_count == args.shard_index
            ),
        )
        if not suite.cases:
            raise SystemExit("Selected evaluation shard has no cases")
    if (args.shadow_retrieval or args.compare_shadow_retrieval) and (
        suite.job.tool_capability_catalog is None
    ):
        raise SystemExit("--tool-capability-catalog is required for shadow retrieval evaluation")
    planner = OpenAiAgentPlannerClient(api_key, args.model, args.timeout_seconds)
    if args.compare_shadow_retrieval:
        legacy_results = evaluate_suite(
            planner,
            suite,
            current_date=args.current_date,
            timezone=args.timezone,
            repetitions=args.repetitions,
            model_version=args.model,
            evaluation_seed=args.seed,
        )
        shadow_results = evaluate_suite(
            planner,
            suite,
            current_date=args.current_date,
            timezone=args.timezone,
            repetitions=args.repetitions,
            use_shadow_retrieval=True,
            shadow_top_k=args.retrieval_top_k,
            model_version=args.model,
            evaluation_seed=args.seed,
        )
        report = build_legacy_shadow_comparison(legacy_results, shadow_results)
    else:
        results = evaluate_suite(
            planner,
            suite,
            current_date=args.current_date,
            timezone=args.timezone,
            repetitions=args.repetitions,
            use_shadow_retrieval=args.shadow_retrieval,
            shadow_top_k=args.retrieval_top_k,
            model_version=args.model,
            evaluation_seed=args.seed,
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
        "shadowRetrieval": args.shadow_retrieval,
        "compareShadowRetrieval": args.compare_shadow_retrieval,
        "retrievalTopK": args.retrieval_top_k,
        "retrieverVersion": TOOL_RETRIEVER_VERSION,
        "evaluationSeed": args.seed,
        "shardCount": args.shard_count,
        "shardIndex": args.shard_index,
        "timeoutSeconds": args.timeout_seconds,
        "toolCapabilityCatalogVersion": (
            suite.job.tool_capability_catalog.version if suite.job.tool_capability_catalog else None
        ),
        "toolCapabilityCatalogSha256": (
            suite.job.tool_capability_catalog.sha256 if suite.job.tool_capability_catalog else None
        ),
        **build_evaluation_input_hashes(
            args.suite,
            args.meeting_catalog,
            args.tool_capability_catalog,
        ),
        "sourceRevision": _git_revision(),
    }
    rendered_report = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(f"{rendered_report}\n", encoding="utf-8")
    else:
        print(rendered_report)


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
