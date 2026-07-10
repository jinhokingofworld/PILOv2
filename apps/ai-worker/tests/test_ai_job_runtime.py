from app.job_dispatcher import JobProcessResult
from app.meeting_report_runtime import RuntimeSettings, SqsAiJobWorker


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

    def receive_message(self, **_kwargs):
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
        concurrency=2,
        wait_time_seconds=1,
        visibility_timeout_seconds=30,
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
