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
