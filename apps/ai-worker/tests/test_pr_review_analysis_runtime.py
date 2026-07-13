import pytest

import app.pr_review_analysis_runtime as runtime
from app.pr_review_analysis_runtime import PrReviewWorkerSettings


def test_pr_review_worker_settings_use_dedicated_queue_and_contract_env(monkeypatch) -> None:
    monkeypatch.setenv("SQS_PR_REVIEW_ANALYSIS_QUEUE_URL", "http://localhost:4566/pr-review")
    monkeypatch.setenv("PR_REVIEW_ANALYSIS_HANDOFF_BASE_URL", "http://localhost:3000")
    monkeypatch.setenv("PR_REVIEW_ANALYSIS_WORKER_TOKEN", "worker-token")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_PR_REVIEW_MODEL", "gpt-5.1-mini")
    monkeypatch.setenv("OPENAI_PR_REVIEW_TIMEOUT_MS", "45000")

    settings = PrReviewWorkerSettings.from_env()

    assert settings.sqs_queue_url == "http://localhost:4566/pr-review"
    assert settings.handoff_base_url == "http://localhost:3000"
    assert settings.handoff_token == "worker-token"
    assert settings.openai_model == "gpt-5.1-mini"
    assert settings.openai_timeout_seconds == 45
    assert settings.wait_time_seconds == 20
    assert settings.visibility_timeout_seconds == 900


def test_pr_review_worker_settings_use_180_second_openai_timeout_by_default(
    monkeypatch,
) -> None:
    monkeypatch.setenv("SQS_PR_REVIEW_ANALYSIS_QUEUE_URL", "http://localhost:4566/pr-review")
    monkeypatch.setenv("PR_REVIEW_ANALYSIS_HANDOFF_BASE_URL", "http://localhost:3000")
    monkeypatch.setenv("PR_REVIEW_ANALYSIS_WORKER_TOKEN", "worker-token")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("OPENAI_PR_REVIEW_TIMEOUT_MS", raising=False)

    settings = PrReviewWorkerSettings.from_env()

    assert settings.openai_timeout_seconds == 180


def test_pr_review_worker_fails_fast_when_processor_initialization_fails(monkeypatch) -> None:
    def fail_initialization():
        raise RuntimeError("missing worker configuration")

    monkeypatch.setattr(runtime, "create_pr_review_worker", fail_initialization)

    with pytest.raises(RuntimeError, match="missing worker configuration"):
        runtime.run_pr_review_worker()


def test_pr_review_worker_propagates_consumer_runtime_failure(monkeypatch) -> None:
    class FailingWorker:
        def run_forever(self):
            raise RuntimeError("SQS receive failed")

    monkeypatch.setattr(runtime, "create_pr_review_worker", FailingWorker)

    with pytest.raises(RuntimeError, match="SQS receive failed"):
        runtime.run_pr_review_worker()
