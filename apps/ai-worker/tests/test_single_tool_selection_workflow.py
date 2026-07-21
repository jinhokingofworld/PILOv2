from pathlib import Path

WORKFLOW_PATH = (
    Path(__file__).resolve().parents[3]
    / ".github"
    / "workflows"
    / "evaluate-agent-single-tool-selection-snapshot.yml"
)


def test_compare_registry_heredoc_delimiter_has_only_yaml_block_indentation():
    lines = WORKFLOW_PATH.read_text(encoding="utf-8").splitlines()
    heredoc_start = next(index for index, line in enumerate(lines) if "<<'PY'" in line)
    heredoc_end = next(line for line in lines[heredoc_start + 1 :] if line.strip() == "PY")

    assert heredoc_end == "          PY"
