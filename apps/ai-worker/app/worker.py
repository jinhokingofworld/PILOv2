import os
from dataclasses import dataclass

from app.meeting_report_runtime import run_worker


@dataclass(frozen=True)
class WorkerSettings:
    app_env: str
    aws_region: str
    concurrency: int

    @classmethod
    def from_env(cls) -> "WorkerSettings":
        return cls(
            app_env=os.getenv("APP_ENV", "local"),
            aws_region=os.getenv("AWS_REGION", "ap-northeast-2"),
            concurrency=int(os.getenv("AI_WORKER_CONCURRENCY", "1")),
        )


def supported_jobs() -> list[str]:
    return [
        "pr_analysis",
        "review_summary",
        "meeting_transcription",
        "meeting_report",
        "agent_run_requested",
        "canvas_agent_step_requested",
    ]


def main() -> None:
    run_worker()


if __name__ == "__main__":
    main()
