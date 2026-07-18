import json
import logging

from app.agent_processor import AGENT_TOOL_SCHEMA_VERSION, parse_agent_run_job_payload
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
        self.calls: list[tuple[str, int]] = []

    def fail_planning_after_retry_exhaustion(self, run_id: str, turn_sequence: int) -> bool:
        self.calls.append((run_id, turn_sequence))
        if self.error:
            raise self.error
        return self.result


class FakeGroundedAnswerRetryExhaustionRecovery:
    def __init__(self, result: bool = True, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[str] = []

    def fail_grounded_answer_after_retry_exhaustion(self, run_id: str) -> bool:
        self.calls.append(run_id)
        if self.error:
            raise self.error
        return self.result


class FakeCanvasAgentRetryExhaustionRecovery:
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


class FakeMeetingTranscriptEmbeddingProcessor(FakeCanvasEmbeddingProcessor):
    pass


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


class FakeTransaction:
    def __enter__(self) -> "FakeTransaction":
        return self

    def __exit__(self, _type, _value, _traceback) -> None:
        return None


class FakeRecoveryCursor:
    def __init__(self, row: object | None = None) -> None:
        self.row = row

    def fetchone(self) -> object | None:
        return self.row


class FakeGroundedAnswerRecoveryConnection:
    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, values: tuple[object, ...]) -> FakeRecoveryCursor:
        self.executed.append((query, values))
        if "pg_try_advisory_lock" in query:
            return FakeRecoveryCursor(FakeLockRow(True))
        if "RETURNING workspace_id" in query:
            return FakeRecoveryCursor({"workspace_id": "workspace-1"})
        return FakeRecoveryCursor()

    def transaction(self) -> FakeTransaction:
        return FakeTransaction()


class FakeAgentRetryRecoveryConnection:
    def __init__(self, current_turn_sequence: int) -> None:
        self.current_turn_sequence = current_turn_sequence
        self.executed: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, values: tuple[object, ...]) -> FakeRecoveryCursor:
        self.executed.append((query, values))
        if "pg_try_advisory_lock" in query:
            return FakeRecoveryCursor(FakeLockRow(True))
        if "UPDATE agent_runs AS run" in query:
            requested_turn_sequence = values[-1]
            if requested_turn_sequence == self.current_turn_sequence:
                return FakeRecoveryCursor({"workspace_id": "workspace-1"})
            return FakeRecoveryCursor()
        return FakeRecoveryCursor()

    def transaction(self) -> FakeTransaction:
        return FakeTransaction()


class FakeAgentContextCursor:
    def __init__(
        self,
        *,
        row: dict[str, object] | None = None,
        rows: list[dict[str, object]] | None = None,
    ) -> None:
        self.row = row
        self.rows = rows or []

    def fetchone(self) -> dict[str, object] | None:
        return self.row

    def fetchall(self) -> list[dict[str, object]]:
        return self.rows


class FakeAgentContextConnection:
    def __init__(
        self,
        run_row: dict[str, object] | None,
        timeline_rows: list[dict[str, object]] | None = None,
        thread_runs: list[dict[str, object]] | None = None,
        resource_refs_by_run: dict[str, list[dict[str, object]]] | None = None,
        selected_candidate: dict[str, object] | None = None,
    ) -> None:
        self.run_row = run_row
        self.timeline_rows = timeline_rows or []
        self.thread_runs = thread_runs or []
        self.resource_refs_by_run = resource_refs_by_run or {}
        self.selected_candidate = selected_candidate
        self.executed: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, values: tuple[object, ...]) -> FakeAgentContextCursor:
        self.executed.append((query, values))
        if "INNER JOIN agent_run_outbox" in query:
            return FakeAgentContextCursor(row=self.run_row)
        if "WITH timeline AS" in query:
            return FakeAgentContextCursor(rows=self.timeline_rows)
        if "SELECT resource_refs" in query:
            return FakeAgentContextCursor(rows=self.resource_refs_by_run.get(str(values[0]), []))
        if "FROM agent_candidate_selections" in query:
            return FakeAgentContextCursor(row=self.selected_candidate)
        if "AND status = 'completed'" in query:
            return FakeAgentContextCursor(rows=self.thread_runs)
        raise AssertionError(f"Unexpected query: {query}")


class FakeAgentWaitConnection:
    def __init__(self, update_row: dict[str, object] | None) -> None:
        self.update_row = update_row
        self.executed: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, values: tuple[object, ...]) -> FakeAgentContextCursor:
        self.executed.append((query, values))
        if "UPDATE agent_runs" in query:
            return FakeAgentContextCursor(row=self.update_row)
        if "INSERT INTO agent_run_messages" in query:
            return FakeAgentContextCursor()
        raise AssertionError(f"Unexpected query: {query}")

    def transaction(self) -> FakeTransaction:
        return FakeTransaction()


def runtime_settings() -> RuntimeSettings:
    return RuntimeSettings(
        aws_region="ap-northeast-2",
        sqs_queue_url="https://sqs.example.com/jobs",
        sqs_endpoint=None,
        database_url="postgresql://pilo:pilo@localhost:5432/pilo",
        database_ssl=False,
        recordings_bucket="recordings",
        openai_api_key="test-key",
        openai_stt_model="whisper-1",
        openai_meeting_report_model="gpt-5.4-mini",
        openai_meeting_transcript_embedding_model="text-embedding-3-small",
        openai_agent_planner_model="gpt-5.4-mini",
        openai_agent_planner_timeout_seconds=60,
        agent_execution_handoff_base_url="http://localhost:4000",
        agent_execution_handoff_token="test-handoff-token",
        agent_execution_handoff_timeout_seconds=10,
        agent_stale_execution_sweep_interval_seconds=60,
        wait_time_seconds=1,
        visibility_timeout_seconds=30,
        canvas_embedding_jobs_per_tick=10,
        meeting_transcript_embedding_jobs_per_tick=10,
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


def test_sqs_worker_logs_meeting_report_correlation(caplog) -> None:
    report_id = "77777777-7777-7777-7777-777777777777"
    meeting_id = "22222222-2222-2222-2222-222222222222"
    recording_id = "55555555-5555-5555-5555-555555555555"
    dispatcher = FakeDispatcher(
        [
            JobProcessResult(
                delete_message=True,
                reason="llm_failed",
                job_type="meeting_report",
                resource_id=report_id,
            )
        ]
    )
    sqs_client = FakeSqsClient()
    sqs_client.receive_message = lambda **_kwargs: {
        "Messages": [
            {
                "Body": json.dumps(
                    {
                        "jobType": "meeting_report",
                        "reportId": report_id,
                        "meetingId": meeting_id,
                        "recordingId": recording_id,
                        "retryCount": 2,
                    }
                ),
                "ReceiptHandle": "receipt-correlation",
                "MessageId": "message-correlation",
                "Attributes": {"ApproximateReceiveCount": "3"},
            }
        ]
    }
    worker = SqsAiJobWorker(runtime_settings(), dispatcher, sqs_client)

    with caplog.at_level(logging.INFO, logger="app.meeting_report_runtime"):
        worker.run_once()

    assert (
        "meeting report job event=received "
        f"report_id={report_id} meeting_id={meeting_id} recording_id={recording_id} "
        "retry_count=2 sqs_message_id=message-correlation receive_count=3"
    ) in caplog.text
    assert (
        "meeting report job event=processed "
        f"report_id={report_id} meeting_id={meeting_id} recording_id={recording_id} "
        "retry_count=2 reason=llm_failed failure_step=LLM delete_message=True "
        "sqs_message_id=message-correlation receive_count=3"
    ) in caplog.text


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


def test_sqs_worker_processes_meeting_transcript_embedding_jobs_before_sqs_poll() -> None:
    dispatcher = FakeDispatcher([])
    sqs_client = FakeSqsClient()
    sqs_client.receive_message = lambda **_kwargs: {"Messages": []}
    embedding_processor = FakeMeetingTranscriptEmbeddingProcessor(["completed", "completed", None])
    worker = SqsAiJobWorker(
        runtime_settings(),
        dispatcher,
        sqs_client,
        meeting_transcript_embedding_processor=embedding_processor,
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
                "Body": json.dumps(
                    {
                        "jobType": "agent_run_requested",
                        "runId": "run-1",
                        "turnSequence": 4,
                    }
                ),
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

    assert recovery.calls == [("run-1", 4)]
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
                "Body": json.dumps(
                    {
                        "jobType": "agent_run_requested",
                        "runId": "run-1",
                        "turnSequence": 4,
                    }
                ),
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

    assert recovery.calls == [("run-1", 4)]
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
                "Body": json.dumps(
                    {
                        "jobType": "agent_run_requested",
                        "runId": "run-1",
                        "turnSequence": 4,
                    }
                ),
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

    assert recovery.calls == [("run-1", 4)]
    assert sqs_client.deleted == []


def test_sqs_worker_terminalizes_third_grounded_answer_infrastructure_failure() -> None:
    dispatcher = FakeDispatcher(
        [
            JobProcessResult(
                delete_message=False,
                reason="infrastructure_failure",
                job_type="agent_grounded_answer_requested",
                resource_id="run-1",
            )
        ]
    )
    sqs_client = FakeSqsClient()
    sqs_client.receive_message = lambda **kwargs: {
        "Messages": [
            {
                "Body": '{"jobType":"agent_grounded_answer_requested"}',
                "ReceiptHandle": "receipt-grounded-answer-terminal",
                "MessageId": "message-grounded-answer-terminal",
                "Attributes": {"ApproximateReceiveCount": "3"},
            }
        ]
    }
    recovery = FakeGroundedAnswerRetryExhaustionRecovery()
    worker = SqsAiJobWorker(
        runtime_settings(),
        dispatcher,
        sqs_client,
        agent_grounded_answer_retry_exhaustion_recovery=recovery,
    )

    worker.run_once()

    assert recovery.calls == ["run-1"]
    assert sqs_client.deleted == [
        {
            "QueueUrl": "https://sqs.example.com/jobs",
            "ReceiptHandle": "receipt-grounded-answer-terminal",
        }
    ]


def test_sqs_worker_terminalizes_third_canvas_agent_infrastructure_failure() -> None:
    dispatcher = FakeDispatcher(
        [
            JobProcessResult(
                delete_message=False,
                reason="infrastructure_failure",
                job_type="canvas_agent_step_requested",
                resource_id="run-1",
            )
        ]
    )
    sqs_client = FakeSqsClient()
    sqs_client.receive_message = lambda **kwargs: {
        "Messages": [
            {
                "Body": '{"jobType":"canvas_agent_step_requested"}',
                "ReceiptHandle": "receipt-canvas-terminal",
                "MessageId": "message-canvas-terminal",
                "Attributes": {"ApproximateReceiveCount": "3"},
            }
        ]
    }
    recovery = FakeCanvasAgentRetryExhaustionRecovery()
    worker = SqsAiJobWorker(
        runtime_settings(),
        dispatcher,
        sqs_client,
        canvas_agent_retry_exhaustion_recovery=recovery,
    )

    worker.run_once()

    assert recovery.calls == ["run-1"]
    assert sqs_client.deleted == [
        {
            "QueueUrl": "https://sqs.example.com/jobs",
            "ReceiptHandle": "receipt-canvas-terminal",
        }
    ]


def test_sqs_worker_preserves_canvas_agent_message_when_terminalization_fails() -> None:
    dispatcher = FakeDispatcher(
        [
            JobProcessResult(
                delete_message=False,
                reason="infrastructure_failure",
                job_type="canvas_agent_step_requested",
                resource_id="run-1",
            )
        ]
    )
    sqs_client = FakeSqsClient()
    sqs_client.receive_message = lambda **kwargs: {
        "Messages": [
            {
                "Body": '{"jobType":"canvas_agent_step_requested"}',
                "ReceiptHandle": "receipt-canvas-dlq",
                "MessageId": "message-canvas-dlq",
                "Attributes": {"ApproximateReceiveCount": "3"},
            }
        ]
    }
    recovery = FakeCanvasAgentRetryExhaustionRecovery(result=False)
    worker = SqsAiJobWorker(
        runtime_settings(),
        dispatcher,
        sqs_client,
        canvas_agent_retry_exhaustion_recovery=recovery,
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

    assert repository.fail_planning_after_retry_exhaustion("run-1", 1) is False
    assert connection.transaction_calls == 0


def test_retry_terminalizer_does_not_fail_rearmed_newer_planner_turn() -> None:
    repository = object.__new__(PgAgentRunRepository)
    connection = FakeAgentRetryRecoveryConnection(current_turn_sequence=2)
    repository.connection = connection

    assert repository.fail_planning_after_retry_exhaustion("run-1", 1) is False

    run_update_query, run_update_values = next(
        (query, values)
        for query, values in connection.executed
        if "UPDATE agent_runs AS run" in query
    )
    assert "outbox.turn_sequence = %s" in run_update_query
    assert run_update_values[-1] == 1
    assert not any("UPDATE agent_steps" in query for query, _values in connection.executed)
    assert not any("INSERT INTO agent_logs" in query for query, _values in connection.executed)


def test_retry_terminalizer_fails_only_matching_planner_turn_generation() -> None:
    repository = object.__new__(PgAgentRunRepository)
    connection = FakeAgentRetryRecoveryConnection(current_turn_sequence=2)
    repository.connection = connection

    assert repository.fail_planning_after_retry_exhaustion("run-1", 2) is True

    assert any("UPDATE agent_steps" in query for query, _values in connection.executed)
    assert any("INSERT INTO agent_logs" in query for query, _values in connection.executed)
    assert any(
        '"turnSequence": 2' in str(values)
        for query, values in connection.executed
        if "INSERT INTO agent_logs" in query
    )


def test_retry_terminalizer_preserves_message_when_grounded_answer_lock_is_held() -> None:
    repository = object.__new__(PgAgentRunRepository)
    connection = FakeLockConnection(acquired=False)
    repository.connection = connection

    assert repository.fail_grounded_answer_after_retry_exhaustion("run-1") is False
    assert connection.transaction_calls == 0


def test_retry_terminalizer_fails_grounded_answer_run_and_outbox() -> None:
    repository = object.__new__(PgAgentRunRepository)
    connection = FakeGroundedAnswerRecoveryConnection()
    repository.connection = connection

    assert repository.fail_grounded_answer_after_retry_exhaustion("run-1") is True

    executed_queries = "\n".join(query for query, _values in connection.executed)
    assert "UPDATE agent_runs" in executed_queries
    assert "UPDATE agent_steps" in executed_queries
    assert "UPDATE agent_grounded_answer_outbox" in executed_queries
    assert "INSERT INTO agent_logs" in executed_queries
    assert any(
        "AGENT_GROUNDED_ANSWER_RETRY_EXHAUSTED" in values for _query, values in connection.executed
    )


def test_agent_repository_rejects_stale_outbox_turn_generation() -> None:
    repository = object.__new__(PgAgentRunRepository)
    connection = FakeAgentContextConnection(run_row=None)
    repository.connection = connection
    job = parse_agent_run_job_payload(
        {
            "jobType": "agent_run_requested",
            "runId": "33333333-3333-3333-3333-333333333333",
            "workspaceId": "22222222-2222-2222-2222-222222222222",
            "requestedByUserId": "11111111-1111-1111-1111-111111111111",
            "toolSchemaVersion": AGENT_TOOL_SCHEMA_VERSION,
            "turnSequence": 7,
            "tools": [],
        }
    )

    assert repository.get_run_context(job) is None
    assert len(connection.executed) == 1
    query, values = connection.executed[0]
    assert "outbox.turn_sequence = %s" in query
    assert values == (
        7,
        "33333333-3333-3333-3333-333333333333",
        "22222222-2222-2222-2222-222222222222",
        "11111111-1111-1111-1111-111111111111",
    )


def test_agent_repository_builds_bounded_chronological_context() -> None:
    repository = object.__new__(PgAgentRunRepository)
    connection = FakeAgentContextConnection(
        run_row={
            "id": "33333333-3333-3333-3333-333333333333",
            "workspace_id": "22222222-2222-2222-2222-222222222222",
            "requested_by_user_id": "11111111-1111-1111-1111-111111111111",
            "status": "planning",
            "prompt": "그 회의를 다시 연결해줘",
            "timezone": "Asia/Seoul",
            "planner_turn_count": 2,
            "thread_id": None,
        },
        timeline_rows=[
            {
                "item_kind": "message",
                "role": "user",
                "content": "회의방을 찾아줘",
                "tool_name": None,
                "output_json": None,
            },
            {
                "item_kind": "tool_step",
                "role": "tool",
                "content": None,
                "tool_name": "get_active_meeting",
                "output_json": {"meetingId": "meeting-1"},
            },
            {
                "item_kind": "message",
                "role": "user",
                "content": "회의 상태 조회가 끝났나요?",
                "tool_name": None,
                "output_json": None,
            },
            {
                "item_kind": "message",
                "role": "assistant",
                "content": "현재 회의를 찾았습니다.",
                "tool_name": None,
                "output_json": None,
            },
        ],
    )
    repository.connection = connection
    job = parse_agent_run_job_payload(
        {
            "jobType": "agent_run_requested",
            "runId": "33333333-3333-3333-3333-333333333333",
            "workspaceId": "22222222-2222-2222-2222-222222222222",
            "requestedByUserId": "11111111-1111-1111-1111-111111111111",
            "toolSchemaVersion": AGENT_TOOL_SCHEMA_VERSION,
            "turnSequence": 3,
            "tools": [],
        }
    )

    context = repository.get_run_context(job)

    assert context is not None
    assert context.planning_context.splitlines() == [
        "user: 회의방을 찾아줘",
        'tool get_active_meeting: {"meetingId": "meeting-1"}',
        "user: 회의 상태 조회가 끝났나요?",
        "assistant: 현재 회의를 찾았습니다.",
    ]
    timeline_query, timeline_values = connection.executed[-1]
    assert "UNION ALL" in timeline_query
    assert "ORDER BY occurred_at DESC" in timeline_query
    assert "LIMIT 17" in timeline_query
    assert "ORDER BY occurred_at ASC" in timeline_query
    assert timeline_values == (job.run_id, job.run_id)


def test_agent_repository_preserves_large_sql_erd_inspection_as_valid_json() -> None:
    repository = object.__new__(PgAgentRunRepository)
    projection_tables = [
        {
            "ref": f"t{index}",
            "name": f"회의_관련_도메인_테이블_{index:03d}",
            "comment": "회의 관련 기능 설명을 다음 Planner turn까지 온전히 보존합니다.",
            "columns": [
                {"name": "workspace_id", "foreignKey": True},
                {"name": f"회의_속성_{index:03d}"},
            ],
        }
        for index in range(1, 51)
    ]
    inspection_output = {
        "sessionId": "44444444-4444-4444-4444-444444444444",
        "sessionRevision": 7,
        "modelFingerprint": "fnv1a32:1234abcd",
        "projection": {
            "tables": projection_tables,
            "edges": [[f"t{index}", f"t{index + 1}"] for index in range(1, 50)],
            "truncated": False,
        },
    }
    serialized_inspection = json.dumps(inspection_output, ensure_ascii=False)
    assert 3_000 < len(serialized_inspection) < 12_000
    assert len(serialized_inspection.encode("utf-8")) > 12_000
    connection = FakeAgentContextConnection(
        run_row={
            "id": "33333333-3333-3333-3333-333333333333",
            "workspace_id": "22222222-2222-2222-2222-222222222222",
            "requested_by_user_id": "11111111-1111-1111-1111-111111111111",
            "status": "planning",
            "prompt": "회의 관련 테이블만 집중 보기로 보여줘",
            "timezone": "Asia/Seoul",
            "planner_turn_count": 1,
            "thread_id": None,
        },
        timeline_rows=[
            *[
                {
                    "item_kind": "message",
                    "role": "user",
                    "content": f"old context {index} " + "x" * 980,
                    "tool_name": None,
                    "output_json": None,
                }
                for index in range(1, 9)
            ],
            {
                "item_kind": "tool_step",
                "role": "tool",
                "content": None,
                "tool_name": "inspect_sql_erd_schema",
                "output_json": inspection_output,
            },
        ],
    )
    repository.connection = connection
    job = parse_agent_run_job_payload(
        {
            "jobType": "agent_run_requested",
            "runId": "33333333-3333-3333-3333-333333333333",
            "workspaceId": "22222222-2222-2222-2222-222222222222",
            "requestedByUserId": "11111111-1111-1111-1111-111111111111",
            "toolSchemaVersion": AGENT_TOOL_SCHEMA_VERSION,
            "turnSequence": 2,
            "tools": [],
        }
    )

    context = repository.get_run_context(job)

    assert context is not None
    prefix = "tool inspect_sql_erd_schema: "
    inspection_line = next(
        line for line in context.planning_context.splitlines() if line.startswith(prefix)
    )
    restored_output = json.loads(inspection_line[len(prefix) :])
    assert restored_output == inspection_output
    assert restored_output["projection"]["tables"][-1]["ref"] == "t50"
    assert len(context.planning_context) <= 12_000


def test_agent_repository_adds_only_bounded_same_thread_memory() -> None:
    repository = object.__new__(PgAgentRunRepository)
    thread_runs = [
        {"id": f"run-{index}", "prompt": f"prompt-{index}", "final_answer": f"answer-{index}"}
        for index in range(1, 7)
    ]
    connection = FakeAgentContextConnection(
        run_row={
            "id": "33333333-3333-3333-3333-333333333333",
            "workspace_id": "22222222-2222-2222-2222-222222222222",
            "requested_by_user_id": "11111111-1111-1111-1111-111111111111",
            "status": "planning",
            "prompt": "그 회의록을 요약해줘",
            "timezone": "Asia/Seoul",
            "planner_turn_count": 0,
            "thread_id": "thread-1",
        },
        thread_runs=thread_runs,
        resource_refs_by_run={
            "run-6": [
                {
                    "resource_refs": [
                        {
                            "domain": "meeting",
                            "resourceType": "meeting_report",
                            "resourceId": "report-6",
                            "label": "최근 회의",
                        }
                    ]
                }
            ],
        },
    )
    repository.connection = connection
    job = parse_agent_run_job_payload(
        {
            "jobType": "agent_run_requested",
            "runId": "33333333-3333-3333-3333-333333333333",
            "workspaceId": "22222222-2222-2222-2222-222222222222",
            "requestedByUserId": "11111111-1111-1111-1111-111111111111",
            "toolSchemaVersion": AGENT_TOOL_SCHEMA_VERSION,
            "tools": [],
        }
    )

    context = repository.get_run_context(job)

    assert context is not None
    assert "previous user: prompt-1" in context.planning_context
    assert "previous user: prompt-6" in context.planning_context
    assert (
        "previous resource meeting:meeting_report id=report-6 label=최근 회의"
        in context.planning_context
    )
    assert len(context.planning_context.encode()) <= 12000
    thread_query, thread_values = connection.executed[1]
    assert "workspace_id = %s" in thread_query
    assert "requested_by_user_id = %s" in thread_query
    assert "LIMIT 6" in thread_query
    assert thread_values == ("thread-1", job.run_id, job.workspace_id, job.requested_by_user_id)


def test_agent_repository_exposes_only_safe_selected_candidate_context() -> None:
    repository = object.__new__(PgAgentRunRepository)
    connection = FakeAgentContextConnection(
        run_row={
            "id": "33333333-3333-3333-3333-333333333333",
            "workspace_id": "22222222-2222-2222-2222-222222222222",
            "requested_by_user_id": "11111111-1111-1111-1111-111111111111",
            "status": "planning",
            "prompt": "김진호를 선택했어",
            "timezone": "Asia/Seoul",
            "planner_turn_count": 0,
            "thread_id": None,
        },
        selected_candidate={
            "resource_type": "workspace_member",
            "label": "김진호",
            "description": "member · ji***@example.com",
            "status": None,
        },
    )
    repository.connection = connection
    job = parse_agent_run_job_payload(
        {
            "jobType": "agent_run_requested",
            "runId": "33333333-3333-3333-3333-333333333333",
            "workspaceId": "22222222-2222-2222-2222-222222222222",
            "requestedByUserId": "11111111-1111-1111-1111-111111111111",
            "toolSchemaVersion": AGENT_TOOL_SCHEMA_VERSION,
            "tools": [],
        }
    )

    context = repository.get_run_context(job)

    assert context is not None
    assert (
        "selected meeting resource type=workspace_member label=김진호" in context.planning_context
    )
    assert "ji***@example.com" in context.planning_context
    assert "candidateSelectionId" not in context.planning_context
    assert "resource_id" not in context.planning_context


def test_agent_repository_appends_clarification_only_after_state_transition() -> None:
    repository = object.__new__(PgAgentRunRepository)
    rejected_connection = FakeAgentWaitConnection(update_row=None)
    repository.connection = rejected_connection

    assert repository.wait_for_user_input("run-1", "추가 정보가 필요합니다.") is False
    assert len(rejected_connection.executed) == 1

    accepted_connection = FakeAgentWaitConnection(update_row={"id": "run-1"})
    repository.connection = accepted_connection

    assert repository.wait_for_user_input("run-1", "추가 정보가 필요합니다.") is True
    assert len(accepted_connection.executed) == 2
    assert "RETURNING id" in accepted_connection.executed[0][0]
    assert "INSERT INTO agent_run_messages" in accepted_connection.executed[1][0]


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
