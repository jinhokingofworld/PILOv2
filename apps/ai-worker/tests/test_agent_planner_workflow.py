from pathlib import Path

WORKFLOW_PATH = Path(__file__).parents[3] / ".github" / "workflows" / "evaluate-agent-planner.yml"


def test_evaluation_workflow_reuses_prepare_job_revision_shas() -> None:
    workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

    assert 'echo "baseline_sha=$(git -C baseline rev-parse HEAD)"' in workflow
    assert 'echo "candidate_sha=$(git -C candidate rev-parse HEAD)"' in workflow
    assert workflow.count("ref: ${{ inputs.baseline_ref }}") == 1
    assert workflow.count("ref: ${{ inputs.candidate_ref }}") == 1
    assert workflow.count("needs.prepare.outputs.baseline_sha") == 2
    assert workflow.count("needs.prepare.outputs.candidate_sha") == 2
