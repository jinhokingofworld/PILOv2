from app.job_dispatcher import JobProcessResult
from app.meeting_report_runtime import (
    PgAgentRunRepository,
    RuntimeSettings,
    SqsAiJobWorker,
)


class FakeDispatcher:
    def __init__(self, results: list[JobProcessResult]) -> None:
        self.results = results
        self.bodies: list[str] = []

    def process_message(self, body: str) -> JobProcessResult:
        self.bodies.append(body)
        return self.results.pop(0)


class FakeSqsClient:
    def __init__(self) -> None:
        self.deleted: list[dict[str, str]] = []
        self.receive_calls: list[dict[str, object]] = []

    def receive_message(self, **kwargs):
        self.receive_calls.append(kwargs)
        return {
            "Messages": [
                {
                    "Body": '{"jobType":"meeting_report"}',
                    "ReceiptHandle": "receipt-delete",
                    "MessageId": "message-delete",
                },
                {
                    "Body": '{"jobType":"agent_run_requested"}',
                    "ReceiptHandle": "receipt-retry",
                    "MessageId": "message-retry",
                },
            ]
        }

    def delete_message(self, **kwargs) -> None:
        self.deleted.append(kwargs)


class FakeStaleExecutionRecovery:
    def __init__(self) -> None:
        self.calls = 0

    def recover_stale_executions(self) -> None:
        self.calls += 1


class FakeAgentRetryExhaustionRecovery:
    def __init__(self, result: bool = True, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[str] = []

    def fail_planning_after_retry_exhaustion(self, run_id: str) -> bool:
        self.calls.append(run_id)
        if self.error:
            raise self.error
        return self.result


class FakePrReviewRetryExhaustionRecovery:
    def __init__(self, result: bool = True, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[str] = []

    def terminalize_retry_exhaustion(self, message_body: str) -> bool:
        self.calls.append(message_body)
        if self.error:
            raise self.error
        return self.result


class FakeCanvasEmbeddingProcessor:
    def __init__(self, results: list[str | None]) -> None:
        self.results = results
        self.calls = 0

    def process_next(self) -> str | None:
        self.calls += 1
        return self.results.pop(0)


class FakeLockRow:
    def __init__(self, acquired: bool) -> None:
        self.acquired = acquired

    def __getitem__(self, key: str) -> bool:
        assert key == "acquired"
        return self.acquired


class FakeLockCursor:
    def __init__(self, acquired: bool) -> None:
        self.acquired = acquired

    def fetchone(self) -> FakeLockRow:
        return FakeLockRow(self.acquired)


class FakeLockConnection:
    def __init__(self, acquired: bool) -> None:
        self.acquired = acquired
        self.transaction_calls = 0

    def execute(self, _query: str, _values: tuple[object, ...]) -> FakeLockCursor:
        return FakeLockCursor(self.acquired)

    def transaction(self):
        self.transaction_calls += 1
        raise AssertionError("terminal transaction must not run without the run lock")


def runtime_settings() -> RuntimeSettings:
    return RuntimeSettings(
        aws_region="ap-northeast-2",
        sqs_queue_url="https://sqs.example.com/jobs",
        sqs_endpoint=None,
        database_url="postgresql://pilo:pilo@localhost:5432/pilo",
        database_ssl=False,
        recordings_bucket="recordings",
        openai_api_key="test-key",
        openai_stt_model="gpt-4o-mini-transcribe",
        openai_meeting_report_model="gpt-5.4-mini",
        openai_agent_planner_model="gpt-5.4-mini",
        agent_execution_handoff_base_url="http://localhost:4000",
        agent_execution_handoff_token="test-handoff-token",
        agent_execution_handoff_timeout_seconds=10,
        agent_stale_execution_sweep_interval_seconds=60,
        wait_time_seconds=1,
        visibility_timeout_seconds=30,
        canvas_embedding_jobs_per_tick=10,
    )


def test_sqs_worker_deletes_only_dispatcher_completed_messages() -> None:
    dispatcher = FakeDispatcher(
        [
            JobProcessResult(
                delete_message=True,
                reason="completed",
                job_type="meeting_report",
                resource_id="report-1",
            ),
            JobProcessResult(
                delete_message=False,
                reason="agent_planning_not_implemented",
                job_type="agent_run_requested",
                resource_id="run-1",
            ),
        ]
    )
    sqs_client = FakeSqsClient()
    worker = SqsAiJobWorker(runtime_settings(), dispatcher, sqs_client)

    count = worker.run_once()

    assert count == 2
    assert dispatcher.bodies == [
        '{"jobType":"meeting_report"}',
        '{"jobType":"agent_run_requested"}',
    ]
    assert sqs_client.deleted == [
        {
            "QueueUrl": "https://sqs.example.com/jobs",
            "ReceiptHandle": "receipt-delete",
        }
    ]
    assert sqs_client.receive_calls[0]["AttributeNames"] == ["ApproximateReceiveCount"]
    assert sqs_client.receive_calls[0]["MaxNumberOfMessages"] == 1


def test_sqs_worker_processes_canvas_embedding_jobs_before_sqs_poll() -> None:
    dispatcher = FakeDispatcher([])
    sqs_client = FakeSqsClient()
    sqs_client.receive_message = lambda **_kwargs: {"Messages": []}
    embedding_processor = FakeCanvasEmbeddingProcessor(["completed", "completed", None])
    worker = SqsAiJobWorker(
        runtime_settings(),
        dispatcher,
        sqs_client,
        canvas_embedding_processor=embedding_processor,
    )

    count = worker.run_once()

    assert count == 0
    assert embedding_processor.calls == 3
    assert sqs_client.receive_calls == []


def test_sqs_worker_terminalizes_third_agent_infrastructure_failure() -> None:
    dispatcher = FakeDispatcher(
        [
            JobProcessResult(
                delete_message=False,
                reason="infrastructure_failure",
                job_type="agent_run_requested",
                resource_id="run-1",
            )
        ]
    )
    sqs_client = FakeSqsClient()
    sqs_client.receive_message = lambda **kwargs: {
        "Messages": [
            {
                "Body": '{"jobType":"agent_run_requested"}',
                "ReceiptHandle": "receipt-terminal",
                "MessageId": "message-terminal",
                "Attributes": {"ApproximateReceiveCount": "3"},
            }
        ]
    }
    recovery = FakeAgentRetryExhaustionRecovery()
    worker = SqsAiJobWorker(
        runtime_settings(),
        dispatcher,
        sqs_client,
        agent_retry_exhaustion_recovery=recovery,
    )

    worker.run_once()

    assert recovery.calls == ["run-1"]
    assert sqs_client.deleted == [
        {
            "QueueUrl": "https://sqs.example.com/jobs",
            "ReceiptHandle": "receipt-terminal",
        }
    ]


def test_sqs_worker_preserves_agent_message_when_terminalization_fails() -> None:
    dispatcher = FakeDispatcher(
        [
            JobProcessResult(
                delete_message=False,
                reason="infrastructure_failure",
                job_type="agent_run_requested",
                resource_id="run-1",
            )
        ]
    )
    sqs_client = FakeSqsClient()
    sqs_client.receive_message = lambda **kwargs: {
        "Messages": [
            {
                "Body": '{"jobType":"agent_run_requested"}',
                "ReceiptHandle": "receipt-dlq",
                "MessageId": "message-dlq",
                "Attributes": {"ApproximateReceiveCount": "3"},
            }
        ]
    }
    recovery = FakeAgentRetryExhaustionRecovery(result=False)
    worker = SqsAiJobWorker(
        runtime_settings(),
        dispatcher,
        sqs_client,
        agent_retry_exhaustion_recovery=recovery,
    )

    worker.run_once()

    assert recovery.calls == ["run-1"]
    assert sqs_client.deleted == []


def test_sqs_worker_preserves_agent_message_when_terminalization_errors() -> None:
    dispatcher = FakeDispatcher(
        [
            JobProcessResult(
                delete_message=False,
                reason="infrastructure_failure",
                job_type="agent_run_requested",
                resource_id="run-1",
            )
        ]
    )
    sqs_client = FakeSqsClient()
    sqs_client.receive_message = lambda **kwargs: {
        "Messages": [
            {
                "Body": '{"jobType":"agent_run_requested"}',
                "ReceiptHandle": "receipt-db-error",
                "MessageId": "message-db-error",
                "Attributes": {"ApproximateReceiveCount": "3"},
            }
        ]
    }
    recovery = FakeAgentRetryExhaustionRecovery(error=RuntimeError("database unavailable"))
    worker = SqsAiJobWorker(
        runtime_settings(),
        dispatcher,
        sqs_client,
        agent_retry_exhaustion_recovery=recovery,
    )

    worker.run_once()

    assert recovery.calls == ["run-1"]
    assert sqs_client.deleted == []


def test_sqs_worker_terminalizes_third_pr_review_analysis_infrastructure_failure() -> None:
    dispatcher = FakeDispatcher(
        [
            JobProcessResult(
                delete_message=False,
                reason="infrastructure_failure",
                job_type="pr_review_analysis_requested",
                resource_id="analysis-job-1",
            )
        ]
    )
    sqs_client = FakeSqsClient()
    sqs_client.receive_message = lambda **kwargs: {
        "Messages": [
            {
                "Body": '{"jobType":"pr_review_analysis_requested"}',
                "ReceiptHandle": "receipt-pr-review-terminal",
                "MessageId": "message-pr-review-terminal",
                "Attributes": {"ApproximateReceiveCount": "3"},
            }
        ]
    }
    recovery = FakePrReviewRetryExhaustionRecovery()
    worker = SqsAiJobWorker(
        runtime_settings(),
        dispatcher,
        sqs_client,
        pr_review_retry_exhaustion_recovery=recovery,
    )

    worker.run_once()

    assert recovery.calls == ['{"jobType":"pr_review_analysis_requested"}']
    assert sqs_client.deleted == [
        {
            "QueueUrl": "https://sqs.example.com/jobs",
            "ReceiptHandle": "receipt-pr-review-terminal",
        }
    ]


def test_sqs_worker_preserves_pr_review_message_when_terminalization_fails() -> None:
    dispatcher = FakeDispatcher(
        [
            JobProcessResult(
                delete_message=False,
                reason="infrastructure_failure",
                job_type="pr_review_analysis_requested",
                resource_id="analysis-job-1",
            )
        ]
    )
    sqs_client = FakeSqsClient()
    sqs_client.receive_message = lambda **kwargs: {
        "Messages": [
            {
                "Body": '{"jobType":"pr_review_analysis_requested"}',
                "ReceiptHandle": "receipt-pr-review-dlq",
                "MessageId": "message-pr-review-dlq",
                "Attributes": {"ApproximateReceiveCount": "3"},
            }
        ]
    }
    recovery = FakePrReviewRetryExhaustionRecovery(result=False)
    worker = SqsAiJobWorker(
        runtime_settings(),
        dispatcher,
        sqs_client,
        pr_review_retry_exhaustion_recovery=recovery,
    )

    worker.run_once()

    assert recovery.calls == ['{"jobType":"pr_review_analysis_requested"}']
    assert sqs_client.deleted == []


def test_retry_terminalizer_preserves_message_when_planner_lock_is_held() -> None:
    repository = object.__new__(PgAgentRunRepository)
    connection = FakeLockConnection(acquired=False)
    repository.connection = connection

    assert repository.fail_planning_after_retry_exhaustion("run-1") is False
    assert connection.transaction_calls == 0


def test_sqs_worker_sweeps_stale_agent_executions_on_interval() -> None:
    recovery = FakeStaleExecutionRecovery()
    now = [0.0]
    worker = SqsAiJobWorker(
        runtime_settings(),
        FakeDispatcher([]),
        FakeSqsClient(),
        stale_execution_recovery=recovery,
        monotonic_time=lambda: now[0],
    )

    worker.recover_stale_executions_if_due()
    worker.recover_stale_executions_if_due()
    now[0] = 60.0
    worker.recover_stale_executions_if_due()

    assert recovery.calls == 2
