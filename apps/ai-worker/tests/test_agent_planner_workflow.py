from pathlib import Path

WORKFLOW_PATH = Path(__file__).parents[3] / ".github" / "workflows" / "evaluate-agent-planner.yml"
EVALUATOR_SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "evaluate_agent_planner.py"


def test_evaluation_workflow_reuses_prepare_job_revision_shas() -> None:
    workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

    assert 'echo "baseline_sha=$(git -C baseline rev-parse HEAD)"' in workflow
    assert 'echo "candidate_sha=$(git -C candidate rev-parse HEAD)"' in workflow
    assert workflow.count("ref: ${{ inputs.baseline_ref }}") == 1
    assert workflow.count("ref: ${{ inputs.candidate_ref }}") == 1
    assert workflow.count("needs.prepare.outputs.baseline_sha") == 2
    assert workflow.count("needs.prepare.outputs.candidate_sha") == 2


def test_multi_tool_variant_uses_sequential_workflow_evaluator() -> None:
    script = EVALUATOR_SCRIPT_PATH.read_text(encoding="utf-8")

    assert 'args.meeting_variant == "multi_tool"' in script
    assert "evaluate_workflow_suite(" in script
    assert "build_workflow_evaluation_report(" in script
