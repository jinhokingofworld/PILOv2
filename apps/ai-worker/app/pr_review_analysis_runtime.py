from __future__ import annotations

import logging
import os

from app.job_dispatcher import JobDispatcher
from app.meeting_report_runtime import SqsAiJobWorker
from app.pr_review_analysis_processor import (
    DEFAULT_PR_REVIEW_MODEL,
    HttpPrReviewAnalysisHandoffClient,
    OpenAiPrReviewAnalysisClient,
    PrReviewAnalysisProcessor,
)

LOGGER = logging.getLogger(__name__)
DEFAULT_WAIT_TIME_SECONDS = 20
DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 900
DEFAULT_HANDOFF_TIMEOUT_SECONDS = 10
DEFAULT_OPENAI_TIMEOUT_MS = 60_000


class PrReviewWorkerSettings:
    def __init__(
        self,
        *,
        aws_region: str,
        sqs_queue_url: str,
        sqs_endpoint: str | None,
        handoff_base_url: str,
        handoff_token: str,
        handoff_timeout_seconds: int,
        openai_api_key: str,
        openai_model: str,
        openai_timeout_seconds: float,
        wait_time_seconds: int,
        visibility_timeout_seconds: int,
    ) -> None:
        self.aws_region = aws_region
        self.sqs_queue_url = sqs_queue_url
        self.sqs_endpoint = sqs_endpoint
        self.handoff_base_url = handoff_base_url
        self.handoff_token = handoff_token
        self.handoff_timeout_seconds = handoff_timeout_seconds
        self.openai_api_key = openai_api_key
        self.openai_model = openai_model
        self.openai_timeout_seconds = openai_timeout_seconds
        self.wait_time_seconds = wait_time_seconds
        self.visibility_timeout_seconds = visibility_timeout_seconds

    @classmethod
    def from_env(cls) -> PrReviewWorkerSettings:
        return cls(
            aws_region=_env("AWS_REGION", "ap-northeast-2"),
            sqs_queue_url=_require_env("SQS_PR_REVIEW_ANALYSIS_QUEUE_URL"),
            sqs_endpoint=_optional_env("SQS_ENDPOINT"),
            handoff_base_url=_require_env("PR_REVIEW_ANALYSIS_HANDOFF_BASE_URL"),
            handoff_token=_require_env("PR_REVIEW_ANALYSIS_WORKER_TOKEN"),
            handoff_timeout_seconds=_positive_int_env(
                "PR_REVIEW_ANALYSIS_HANDOFF_TIMEOUT_SECONDS",
                DEFAULT_HANDOFF_TIMEOUT_SECONDS,
            ),
            openai_api_key=_require_env("OPENAI_API_KEY"),
            openai_model=_env("OPENAI_PR_REVIEW_MODEL", DEFAULT_PR_REVIEW_MODEL),
            openai_timeout_seconds=_positive_ms_env(
                "OPENAI_PR_REVIEW_TIMEOUT_MS",
                DEFAULT_OPENAI_TIMEOUT_MS,
            ),
            wait_time_seconds=_positive_int_env(
                "AI_WORKER_SQS_WAIT_TIME_SECONDS",
                DEFAULT_WAIT_TIME_SECONDS,
            ),
            visibility_timeout_seconds=_positive_int_env(
                "AI_WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS",
                DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
            ),
        )


def create_pr_review_worker(
    settings: PrReviewWorkerSettings | None = None,
) -> SqsAiJobWorker:
    import boto3

    resolved_settings = settings or PrReviewWorkerSettings.from_env()
    boto_kwargs = {"region_name": resolved_settings.aws_region}
    if resolved_settings.sqs_endpoint:
        boto_kwargs["endpoint_url"] = resolved_settings.sqs_endpoint

    handoff_client = HttpPrReviewAnalysisHandoffClient(
        resolved_settings.handoff_base_url,
        resolved_settings.handoff_token,
        resolved_settings.handoff_timeout_seconds,
    )
    analysis_client = OpenAiPrReviewAnalysisClient(
        resolved_settings.openai_api_key,
        resolved_settings.openai_model,
        resolved_settings.openai_timeout_seconds,
    )
    processor = PrReviewAnalysisProcessor(
        handoff_client,
        analysis_client,
    )
    dispatcher = JobDispatcher(pr_review_analysis_processor=processor)
    return SqsAiJobWorker(
        resolved_settings,
        dispatcher,
        boto3.client("sqs", **boto_kwargs),
        pr_review_retry_exhaustion_recovery=processor,
    )


def run_pr_review_worker() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    worker = create_pr_review_worker()
    LOGGER.info("pr-review ai-worker initialized")
    worker.run_forever()


def _env(key: str, default: str) -> str:
    value = os.getenv(key)
    if value is None or not value.strip():
        return default
    return value.strip()


def _optional_env(key: str) -> str | None:
    value = os.getenv(key)
    if value is None or not value.strip():
        return None
    return value.strip()


def _require_env(key: str) -> str:
    value = os.getenv(key)
    if value is None or not value.strip():
        raise RuntimeError(f"{key} is required")
    return value.strip()


def _positive_int_env(key: str, default: int) -> int:
    value = os.getenv(key)
    if value is None or not value.strip():
        return default
    try:
        return max(int(value), 1)
    except ValueError:
        return default


def _positive_ms_env(key: str, default: int) -> float:
    value = _positive_int_env(key, default)
    return value / 1_000


if __name__ == "__main__":
    run_pr_review_worker()
