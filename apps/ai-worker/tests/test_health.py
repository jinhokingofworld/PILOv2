from app.main import create_app
from app.worker import WorkerSettings, supported_jobs


def test_health_route_is_registered() -> None:
    app = create_app()
    paths = {route.path for route in app.routes}

    assert "/health" in paths


def test_worker_settings_defaults() -> None:
    settings = WorkerSettings.from_env()

    assert settings.app_env
    assert settings.aws_region == "ap-northeast-2"


def test_supported_jobs_match_mvp_scope() -> None:
    jobs = supported_jobs()

    assert "pr_analysis" in jobs
    assert "meeting_report" in jobs
    assert "agent_run_requested" in jobs
    assert "kanban_agent" not in jobs
