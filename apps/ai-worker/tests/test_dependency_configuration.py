from pathlib import Path

REQUIREMENTS_PATH = Path(__file__).resolve().parents[1] / "requirements.txt"


def test_requirements_use_cpu_only_pytorch() -> None:
    requirements = REQUIREMENTS_PATH.read_text(encoding="utf-8").splitlines()

    assert "--extra-index-url https://download.pytorch.org/whl/cpu" in requirements
    assert "torch==2.13.0+cpu" in requirements
