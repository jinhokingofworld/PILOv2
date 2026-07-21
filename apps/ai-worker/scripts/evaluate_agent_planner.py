from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from app.agent_outcome_judge import OpenAiOutcomeJudge
from app.agent_planner_evaluation import (
    attach_tool_capability_catalog,
    build_evaluation_input_hashes,
    build_evaluation_report,
    build_legacy_shadow_comparison,
    evaluate_suite,
    load_evaluation_suite,
    load_meeting_regression_suite,
)
from app.agent_processor import OpenAiAgentPlannerClient, OpenAiAgentRouterClient
from app.agent_tool_retrieval import TOOL_RETRIEVER_VERSION
from app.agent_workflow_evaluation import (
    build_workflow_evaluation_report,
    evaluate_workflow_suite,
    load_workflow_catalog,
    load_workflow_scenarios,
)

_EVALUATOR_SOURCE_PATHS = (
    Path("app/agent_planner_evaluation.py"),
    Path("app/agent_workflow_evaluation.py"),
    Path("app/agent_outcome_judge.py"),
    Path("app/agent_planner_comparison.py"),
    Path("scripts/evaluate_agent_planner.py"),
)


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
        "--workflow-catalog",
        type=Path,
        help="Path to the cross-domain Agent workflow catalog JSON.",
    )
    parser.add_argument(
        "--tool-capability-catalog",
        type=Path,
        help="Path to an App Server-generated capability catalog snapshot.",
    )
    parser.add_argument(
        "--registry-snapshot",
        type=Path,
        help="Bind the report to the App Server registry snapshot used to build its inputs.",
    )
    parser.add_argument(
        "--meeting-variant",
        choices=(
            "canonical",
            "held_out",
            "counterexample",
            "context",
            "multi_tool",
            "agent_workflow",
        ),
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
    retrieval_mode.add_argument(
        "--llm-routing",
        action="store_true",
        help="Run the two-stage LLM Router and Planner path without executing a tool.",
    )
    parser.add_argument(
        "--router-model",
        default=os.environ.get(
            "OPENAI_AGENT_ROUTER_MODEL",
            os.environ.get("OPENAI_AGENT_PLANNER_MODEL", "gpt-5.4-mini"),
        ),
        help="Router model used by --llm-routing. Defaults to the Planner model.",
    )
    parser.add_argument(
        "--judge-model",
        default=os.environ.get("OPENAI_AGENT_OUTCOME_JUDGE_MODEL", "gpt-5.4"),
        help="Evidence-grounded outcome Judge model used for agent_workflow evaluation.",
    )
    parser.add_argument(
        "--judge-prompt-version",
        default="agent-outcome-judge:v1",
        help="Fixed Judge prompt version recorded with the snapshot.",
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

    workflow_catalog = (
        load_workflow_catalog(args.workflow_catalog) if args.workflow_catalog else None
    )
    if args.meeting_variant == "agent_workflow":
        if workflow_catalog is None:
            raise SystemExit("agent_workflow evaluation requires --workflow-catalog")
        suite = replace(
            load_evaluation_suite(args.suite),
            version=f"{workflow_catalog.version}:agent_workflow",
        )
    else:
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
    if (args.shadow_retrieval or args.compare_shadow_retrieval or args.llm_routing) and (
        suite.job.tool_capability_catalog is None
    ):
        raise SystemExit("--tool-capability-catalog is required for routing evaluation")
    workflow_mode = args.meeting_variant in {"multi_tool", "agent_workflow"}
    if workflow_mode and (args.compare_shadow_retrieval or not args.llm_routing):
        raise SystemExit("workflow evaluation requires --llm-routing")
    planner = OpenAiAgentPlannerClient(api_key, args.model, args.timeout_seconds)
    router = (
        OpenAiAgentRouterClient(api_key, args.router_model, args.timeout_seconds)
        if args.llm_routing
        else None
    )
    outcome_judge = (
        OpenAiOutcomeJudge(api_key, args.judge_model, args.timeout_seconds)
        if args.meeting_variant == "agent_workflow"
        else None
    )
    if workflow_mode:
        assert router is not None
        if args.meeting_variant == "agent_workflow":
            assert workflow_catalog is not None
            scenarios = workflow_catalog.scenarios
        else:
            assert args.meeting_variant == "multi_tool"
            if args.meeting_catalog is None:
                raise SystemExit("multi_tool evaluation requires --meeting-catalog")
            scenarios = load_workflow_scenarios(args.meeting_catalog)
        workflow_results = evaluate_workflow_suite(
            planner,
            router,
            suite.job,
            scenarios,
            current_date=args.current_date,
            timezone=args.timezone,
            repetitions=args.repetitions,
            outcome_judge=outcome_judge,
        )
        report = build_workflow_evaluation_report(workflow_results)
    elif args.compare_shadow_retrieval:
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
            router=router,
            use_llm_routing=args.llm_routing,
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
        "llmRouting": args.llm_routing,
        "routerModel": args.router_model if args.llm_routing else None,
        "outcomeJudgeModel": args.judge_model if outcome_judge else None,
        "outcomeJudgePromptVersion": args.judge_prompt_version if outcome_judge else None,
        "outcomeJudgeTemperature": 0 if outcome_judge else None,
        "outcomeJudgeVoteCount": 3 if outcome_judge else None,
        "retrievalTopK": args.retrieval_top_k,
        "retrieverVersion": TOOL_RETRIEVER_VERSION,
        "evaluationSeed": args.seed,
        "evaluatorSha256": _evaluator_sha256(),
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
            args.workflow_catalog,
        ),
        **_registry_binding(args.registry_snapshot),
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


def _evaluator_sha256() -> str:
    root = Path(__file__).parents[1]
    digest = hashlib.sha256()
    for relative_path in _EVALUATOR_SOURCE_PATHS:
        digest.update(relative_path.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update((root / relative_path).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _registry_binding(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        inventory = value["inventory"]
        hashes = {
            "registryInventorySha256": inventory["sha256"],
            "registryCatalogSha256": inventory["catalogSha256"],
            "registryEligibleSnapshotSha256": value["eligibleSnapshotSha256"],
        }
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise SystemExit("--registry-snapshot is invalid") from error
    if any(not isinstance(item, str) or len(item) != 64 for item in hashes.values()):
        raise SystemExit("--registry-snapshot does not contain valid SHA-256 values")
    return hashes


if __name__ == "__main__":
    main()
