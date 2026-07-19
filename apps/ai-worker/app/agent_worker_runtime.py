from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from app.agent_processor import AgentRunProcessor, OpenAiAgentPlannerClient
from app.job_dispatcher import JobDispatcher
from app.meeting_report_runtime import (
    DEFAULT_AGENT_EXECUTION_HANDOFF_TIMEOUT_SECONDS,
    DEFAULT_AGENT_STALE_EXECUTION_SWEEP_INTERVAL_SECONDS,
    DEFAULT_OPENAI_AGENT_PLANNER_TIMEOUT_MS,
    DEFAULT_WAIT_TIME_SECONDS,
    HttpAgentExecutionHandoffClient,
    PgAgentRunRepository,
    SqsAiJobWorker,
    _database_url,
    _env,
    _optional_env,
    _positive_int_env,
    _positive_ms_env,
    _require_env,
)

LOGGER = logging.getLogger(__name__)

DEFAULT_AGENT_WORKER_VISIBILITY_TIMEOUT_SECONDS = 90


@dataclass(frozen=True)
class AgentWorkerSettings:
    aws_region: str
    sqs_queue_url: str
    sqs_endpoint: str | None
    database_url: str
    database_ssl: bool
    openai_api_key: str
    openai_agent_planner_model: str
    openai_agent_planner_timeout_seconds: float
    agent_execution_handoff_base_url: str
    agent_execution_handoff_token: str
    agent_execution_handoff_timeout_seconds: int
    agent_stale_execution_sweep_interval_seconds: int
    wait_time_seconds: int
    visibility_timeout_seconds: int
    canvas_embedding_jobs_per_tick: int = 0

    @classmethod
    def from_env(cls) -> AgentWorkerSettings:
        return cls(
            aws_region=_env("AWS_REGION", "ap-northeast-2"),
            sqs_queue_url=_require_env("SQS_AGENT_JOBS_QUEUE_URL"),
            sqs_endpoint=_optional_env("SQS_ENDPOINT"),
            database_url=_database_url(),
            database_ssl=_env("DATABASE_SSL", "false").lower() == "true",
            openai_api_key=_require_env("OPENAI_API_KEY"),
            openai_agent_planner_model=_env("OPENAI_AGENT_PLANNER_MODEL", "gpt-5.4-mini"),
            openai_agent_planner_timeout_seconds=_positive_ms_env(
                "OPENAI_AGENT_PLANNER_TIMEOUT_MS",
                DEFAULT_OPENAI_AGENT_PLANNER_TIMEOUT_MS,
            ),
            agent_execution_handoff_base_url=_require_env("AGENT_EXECUTION_HANDOFF_BASE_URL"),
            agent_execution_handoff_token=_require_env("AGENT_EXECUTION_HANDOFF_TOKEN"),
            agent_execution_handoff_timeout_seconds=_positive_int_env(
                "AGENT_EXECUTION_HANDOFF_TIMEOUT_SECONDS",
                DEFAULT_AGENT_EXECUTION_HANDOFF_TIMEOUT_SECONDS,
            ),
            agent_stale_execution_sweep_interval_seconds=_positive_int_env(
                "AGENT_STALE_EXECUTION_SWEEP_INTERVAL_SECONDS",
                DEFAULT_AGENT_STALE_EXECUTION_SWEEP_INTERVAL_SECONDS,
            ),
            wait_time_seconds=_positive_int_env(
                "AI_WORKER_SQS_WAIT_TIME_SECONDS", DEFAULT_WAIT_TIME_SECONDS
            ),
            visibility_timeout_seconds=_positive_int_env(
                "AI_WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS",
                DEFAULT_AGENT_WORKER_VISIBILITY_TIMEOUT_SECONDS,
            ),
        )


def create_agent_worker(settings: AgentWorkerSettings | None = None) -> SqsAiJobWorker:
    import boto3

    resolved_settings = settings or AgentWorkerSettings.from_env()
    boto_kwargs = {"region_name": resolved_settings.aws_region}
    if resolved_settings.sqs_endpoint:
        boto_kwargs["endpoint_url"] = resolved_settings.sqs_endpoint

    repository = PgAgentRunRepository(
        resolved_settings.database_url, resolved_settings.database_ssl
    )
    handoff_client = HttpAgentExecutionHandoffClient(
        resolved_settings.agent_execution_handoff_base_url,
        resolved_settings.agent_execution_handoff_token,
        resolved_settings.agent_execution_handoff_timeout_seconds,
    )
    processor = AgentRunProcessor(
        repository,
        OpenAiAgentPlannerClient(
            resolved_settings.openai_api_key,
            resolved_settings.openai_agent_planner_model,
            resolved_settings.openai_agent_planner_timeout_seconds,
        ),
        handoff_client,
    )
    return SqsAiJobWorker(
        resolved_settings,
        create_agent_dispatcher(processor),
        boto3.client("sqs", **boto_kwargs),
        stale_execution_recovery=handoff_client,
        agent_retry_exhaustion_recovery=repository,
    )


def create_agent_dispatcher(processor: AgentRunProcessor) -> JobDispatcher:
    return JobDispatcher(agent_run_processor=processor)


def run_agent_worker() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    worker = create_agent_worker()
    LOGGER.info("agent-worker initialized")
    worker.run_forever()


if __name__ == "__main__":
    run_agent_worker()
