import os
from dataclasses import dataclass

from app.shared_ai_worker_runtime import run_shared_ai_worker


@dataclass(frozen=True)
class WorkerSettings:
    app_env: str
    aws_region: str

    @classmethod
    def from_env(cls) -> "WorkerSettings":
        return cls(
            app_env=os.getenv("APP_ENV", "local"),
            aws_region=os.getenv("AWS_REGION", "ap-northeast-2"),
        )


def supported_jobs() -> list[str]:
    return [
        "pr_analysis",
        "review_summary",
        "meeting_transcription",
        "meeting_report",
        "agent_run_requested",
        "canvas_agent_step_requested",
        "pr_review_analysis_requested",
    ]


def main() -> None:
    run_shared_ai_worker()


if __name__ == "__main__":
    main()
