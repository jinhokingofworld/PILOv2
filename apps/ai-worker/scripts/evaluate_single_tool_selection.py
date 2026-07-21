from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate only the first Agent Tool selection."
    )
    parser.add_argument("--target-root", type=Path, required=True)
    parser.add_argument("--suite", type=Path, required=True)
    parser.add_argument("--tool-capability-catalog", type=Path, required=True)
    parser.add_argument("--registry-snapshot", type=Path, required=True)
    parser.add_argument("--current-date", required=True)
    parser.add_argument("--timezone", default="Asia/Seoul")
    parser.add_argument("--repetitions", type=int, default=5)
    parser.add_argument("--model", required=True)
    parser.add_argument("--router-model", required=True)
    parser.add_argument("--timeout-seconds", type=float, default=60.0)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.repetitions < 1:
        raise SystemExit("--repetitions must be positive")
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required")

    evaluator_root = Path(__file__).parents[1]
    target_ai_worker = args.target_root / "apps" / "ai-worker"
    if not target_ai_worker.is_dir():
        raise SystemExit("--target-root must contain apps/ai-worker")
    sys.path.insert(0, str(target_ai_worker))
    sys.path.insert(1, str(evaluator_root))

    from app.agent_planner_evaluation import (
        attach_tool_capability_catalog,
        load_evaluation_suite,
    )
    from app.agent_processor import OpenAiAgentPlannerClient, OpenAiAgentRouterClient
    from evaluation_harness.single_tool_selection_catalog import (
        load_single_tool_selection_catalog,
        validate_single_tool_selection_catalog,
    )
    from evaluation_harness.single_tool_selection_report import (
        build_single_tool_selection_report,
    )
    from evaluation_harness.single_tool_selection_runtime import (
        evaluate_single_tool_selection_case,
    )

    registry_tool_names, registry_metadata = _registry_binding(args.registry_snapshot)
    catalog_path = evaluator_root / "evals" / "agent_single_tool_selection_v1.json"
    catalog = load_single_tool_selection_catalog(catalog_path)
    validate_single_tool_selection_catalog(catalog, registry_tool_names)
    suite = attach_tool_capability_catalog(
        load_evaluation_suite(args.suite), args.tool_capability_catalog
    )
    if {tool.name for tool in suite.job.tools} != registry_tool_names:
        raise SystemExit(
            "Target suite and registry snapshot do not describe the same Tool set"
        )

    planner = OpenAiAgentPlannerClient(api_key, args.model, args.timeout_seconds)
    router = OpenAiAgentRouterClient(api_key, args.router_model, args.timeout_seconds)
    results = tuple(
        evaluate_single_tool_selection_case(
            planner,
            router,
            suite.job,
            case,
            current_date=args.current_date,
            timezone=args.timezone,
            attempt=attempt,
        )
        for case in catalog.cases
        for attempt in range(1, args.repetitions + 1)
    )
    metadata = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "evaluatorSha256": _evaluator_sha256(evaluator_root),
        "catalogSha256": hashlib.sha256(catalog_path.read_bytes()).hexdigest(),
        "catalogVersion": catalog.version,
        "sourceRevision": _git_revision(args.target_root),
        "model": args.model,
        "routerModel": args.router_model,
        "currentDate": args.current_date,
        "timezone": args.timezone,
        "repetitions": args.repetitions,
        **registry_metadata,
    }
    report = build_single_tool_selection_report(results, metadata)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _registry_binding(path: Path) -> tuple[set[str], dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    schemas = payload.get("eligibleToolSchemas")
    registry = payload.get("inventory")
    if not isinstance(schemas, dict) or not all(
        isinstance(name, str) for name in schemas
    ):
        raise SystemExit("Registry snapshot is missing eligible Tool schemas")
    if not isinstance(registry, dict):
        raise SystemExit("Registry snapshot metadata is required")
    inventory_sha = registry.get("sha256")
    catalog_sha = registry.get("catalogSha256")
    if not isinstance(inventory_sha, str) or not isinstance(catalog_sha, str):
        raise SystemExit("Registry snapshot hashes are required")
    return set(schemas), {
        "registryInventorySha256": inventory_sha,
        "registryCatalogSha256": catalog_sha,
    }


def _evaluator_sha256(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted((root / "evaluation_harness").glob("*.py")) + [
        root / "scripts" / "compare_single_tool_selection.py",
        root / "scripts" / "evaluate_single_tool_selection.py",
        root / "evals" / "agent_single_tool_selection_v1.json",
    ]:
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _git_revision(root: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


if __name__ == "__main__":
    main()
