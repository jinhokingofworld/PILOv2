from pathlib import Path

WORKFLOW_PATH = Path(__file__).parents[3] / ".github" / "workflows" / "evaluate-agent-planner.yml"
EVALUATOR_SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "evaluate_agent_planner.py"
COMPARISON_SCRIPT_PATH = (
    Path(__file__).parents[1] / "scripts" / "compare_agent_planner_evaluations.py"
)


def test_evaluation_workflow_accepts_unmerged_candidate_descending_from_dev_baseline() -> None:
    workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

    assert "baseline_ref:" not in workflow
    assert "candidate_ref:" not in workflow
    assert workflow.count("ref: ${{ inputs.baseline_sha }}") == 1
    assert workflow.count("ref: ${{ inputs.candidate_sha }}") == 1
    assert "must be distinct" in workflow
    assert '[[ "$sha" =~ ^[0-9a-f]{40}$ ]]' in workflow
    assert "merge-base --is-ancestor" in workflow
    assert "refs/remotes/origin/dev" in workflow
    assert '"$BASELINE_SHA" "$CANDIDATE_SHA"' in workflow
    assert "candidate SHA does not descend from baseline SHA" in workflow
    assert workflow.count("needs.prepare.outputs.baseline_sha") == 2
    assert workflow.count("needs.prepare.outputs.candidate_sha") == 2
    assert "fail-fast: false" in workflow
    assert "always() && inputs.mode == 'compare' && needs.prepare.result == 'success'" in workflow
    assert workflow.count("if: always()") >= 2


def test_multi_tool_variant_uses_sequential_workflow_evaluator() -> None:
    script = EVALUATOR_SCRIPT_PATH.read_text(encoding="utf-8")

    assert 'args.meeting_variant == "multi_tool"' in script
    assert "evaluate_workflow_suite(" in script
    assert "build_workflow_evaluation_report(" in script
    assert '"evaluatorSha256": _evaluator_sha256()' in script
    assert 'Path("app/agent_workflow_evaluation.py")' in script
    assert 'Path("app/agent_planner_comparison.py")' in script


def test_agent_workflow_variant_is_compared_without_entering_meeting_readiness() -> None:
    workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
    script = EVALUATOR_SCRIPT_PATH.read_text(encoding="utf-8")

    assert '"agent_workflow"' in script
    assert "--workflow-catalog" in script
    assert '"agent_workflow"' in workflow
    assert "agent-workflow-catalog.json" in workflow
    assert "baseline-meeting-agent_workflow-evaluation.json" in workflow
    assert "candidate-meeting-agent_workflow-evaluation.json" in workflow
    readiness_command = workflow.split("check_phase4e_dev_readiness.py", 1)[1].split(
        "- name: Upload evaluation result", 1
    )[0]
    assert "agent_workflow" not in readiness_command


def test_comparison_command_fails_without_improvement_evidence() -> None:
    script = COMPARISON_SCRIPT_PATH.read_text(encoding="utf-8")

    assert 'comparison["improvementEvidence"]["passed"] is True' in script


def test_evaluation_workflow_supports_main_snapshot_without_comparison_gate() -> None:
    workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

    assert "mode:" in workflow
    assert "target_sha:" in workflow
    assert "snapshot_agent_planner_evaluations.py" in workflow
    assert "agent-performance-snapshot-${{ needs.prepare.outputs.target_sha }}" in workflow
    assert "inputs.mode == 'snapshot'" in workflow
    assert "inputs.mode == 'compare'" in workflow
    assert "agent-evaluation-target-agent_workflow" in workflow
    assert "inputs.target_sha || github.sha" in workflow
    assert "target SHA must match the current main revision" in workflow
