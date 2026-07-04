from fastapi import FastAPI

from app.worker import WorkerSettings


def create_app() -> FastAPI:
    app = FastAPI(title="PILO AI Worker", version="0.1.0")

    @app.get("/health")
    def health() -> dict[str, str]:
        settings = WorkerSettings.from_env()
        return {
            "service": "pilo-ai-worker",
            "status": "ok",
            "environment": settings.app_env,
        }

    @app.get("/")
    def root() -> dict[str, str]:
        return {
            "service": "pilo-ai-worker",
            "status": "ready",
        }

    return app


app = create_app()
