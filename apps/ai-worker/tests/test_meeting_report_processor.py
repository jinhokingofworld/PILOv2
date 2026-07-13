import json
from types import SimpleNamespace

import pytest

from app.meeting_report_processor import (
    AudioObjectMetadata,
    GeneratedMeetingReport,
    InfrastructureError,
    MeetingReportContext,
    MeetingReportProcessor,
    PermanentStorageError,
    ProviderBusinessError,
    TranscriptSegment,
    parse_generated_report_json,
    parse_meeting_report_job,
    serialize_action_items,
)
from app.meeting_report_runtime import (
    HttpMeetingReportEventPublisher,
    OpenAiMeetingReportClient,
    PgMeetingReportRepository,
    RuntimeSettings,
    S3RecordingStorage,
)

REPORT_ID = "77777777-7777-7777-7777-777777777777"
MEETING_ID = "33333333-3333-3333-3333-333333333333"
RECORDING_ID = "55555555-5555-5555-5555-555555555555"
AUDIO_FILE_KEY = "recordings/meetings/workspaces/ws/meetings/mt/recordings/rec.m4a"


@pytest.fixture(autouse=True)
def agent_execution_handoff_env(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_EXECUTION_HANDOFF_BASE_URL", "http://localhost:4000")
    monkeypatch.setenv("AGENT_EXECUTION_HANDOFF_TOKEN", "test-handoff-token")


def meeting_report_job_payload(**overrides: object) -> str:
    payload = {
        "jobType": "meeting_report",
        "reportId": REPORT_ID,
        "meetingId": MEETING_ID,
        "recordingId": RECORDING_ID,
        "audioFileKey": AUDIO_FILE_KEY,
        "retryCount": 0,
        **overrides,
    }
    return json.dumps(payload)


def report_context(**overrides: object) -> MeetingReportContext:
    values = {
        "report_id": REPORT_ID,
        "meeting_id": MEETING_ID,
        "recording_id": RECORDING_ID,
        "report_status": "PROCESSING",
        "recording_status": "COMPLETED",
        "recording_audio_file_key": AUDIO_FILE_KEY,
        **overrides,
    }
    return MeetingReportContext(**values)


class FakeRepository:
    def __init__(self, context: MeetingReportContext | None = None, lock: bool = True) -> None:
        self.context = context if context is not None else report_context()
        self.lock = lock
        self.lock_calls: list[str] = []
        self.release_calls: list[str] = []
        self.failed_updates: list[tuple[str, str, str]] = []
        self.completed_updates: list[tuple[str, GeneratedMeetingReport]] = []
        self.progress_updates: list[tuple[str, str]] = []

    def try_acquire_report_lock(self, report_id: str) -> bool:
        self.lock_calls.append(report_id)
        return self.lock

    def release_report_lock(self, report_id: str) -> None:
        self.release_calls.append(report_id)

    def get_report_context(self, _job):
        return self.context

    def mark_failed(self, report_id: str, failed_step: str, error_message: str) -> None:
        self.failed_updates.append((report_id, failed_step, error_message))

    def mark_progress(self, report_id: str, status: str) -> None:
        self.progress_updates.append((report_id, status))

    def mark_completed(self, report_id: str, report: GeneratedMeetingReport) -> None:
        self.completed_updates.append((report_id, report))


class FakeCompletedReportCursor:
    rowcount = 1

    def fetchone(self):
        return {"id": "segment-id"}


class FakeCompletedReportTransaction:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class FakeCompletedReportConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    def transaction(self):
        return FakeCompletedReportTransaction()

    def execute(self, query: str, values: tuple[object, ...]):
        self.calls.append((query, values))
        return FakeCompletedReportCursor()


class FakeStorage:
    def __init__(
        self,
        size: int = 1024,
        fail_head: bool = False,
        permanent_head_failure: bool = False,
        permanent_download_failure: bool = False,
    ) -> None:
        self.size = size
        self.fail_head = fail_head
        self.permanent_head_failure = permanent_head_failure
        self.permanent_download_failure = permanent_download_failure
        self.head_calls: list[str] = []
        self.download_calls: list[str] = []

    def head_audio(self, audio_file_key: str) -> AudioObjectMetadata:
        self.head_calls.append(audio_file_key)
        if self.permanent_head_failure:
            raise PermanentStorageError("missing object")
        if self.fail_head:
            raise InfrastructureError("S3 unavailable")
        return AudioObjectMetadata(file_size_bytes=self.size)

    def download_audio(self, audio_file_key: str) -> str:
        self.download_calls.append(audio_file_key)
        if self.permanent_download_failure:
            raise PermanentStorageError("missing object")
        return "/tmp/pilo-ai-worker-test-missing-file.m4a"


class FakeAiClient:
    def __init__(self, stt_failure=None, llm_failure=None) -> None:
        self.stt_failure = stt_failure
        self.llm_failure = llm_failure
        self.transcribe_calls: list[str] = []
        self.generate_calls: list[str] = []

    def transcribe(self, audio_file_path: str) -> list[TranscriptSegment]:
        self.transcribe_calls.append(audio_file_path)
        if self.stt_failure:
            raise self.stt_failure
        return [TranscriptSegment(0, 0, 1_000, "진호: 회의록 조회 API와 worker 처리를 정리합니다.")]

    def generate_report(self, transcript_text: str, transcript_segments) -> GeneratedMeetingReport:
        self.generate_calls.append(transcript_text)
        if self.llm_failure:
            raise self.llm_failure
        return parse_generated_report_json(
            json.dumps(
                {
                    "summary": "회의록 조회 API와 worker 처리 방향을 정리했다.",
                    "discussionPoints": "1. 조회 API\n2. Worker 처리",
                    "decisions": "Worker는 DB를 직접 갱신한다.",
                    "actionItemCandidates": [
                        {
                            "title": "Worker 구현",
                            "description": "meeting_report job processor를 구현한다.",
                            "assigneeUserId": "ignored-user",
                            "priority": "HIGH",
                        }
                    ],
                    "evidence": [
                        {"sourceType": "decision", "sourceIndex": 0, "segmentIndexes": [0]},
                        {"sourceType": "action_item", "sourceIndex": 0, "segmentIndexes": [0]},
                    ],
                }
            ),
            transcript_text,
            transcript_segments,
        )


class FakeEventPublisher:
    def __init__(self, should_fail: bool = False) -> None:
        self.should_fail = should_fail
        self.report_ids: list[str] = []

    def publish(self, report_id: str) -> None:
        self.report_ids.append(report_id)
        if self.should_fail:
            raise RuntimeError("event unavailable")


class FakeHttpResponse:
    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc_value, _traceback) -> None:
        return None


def test_parse_meeting_report_job_validates_required_payload() -> None:
    job = parse_meeting_report_job(meeting_report_job_payload())

    assert job.report_id == REPORT_ID
    assert job.audio_file_key == AUDIO_FILE_KEY
    assert job.retry_count == 0

    with pytest.raises(ValueError):
        parse_meeting_report_job(meeting_report_job_payload(jobType="pr_analysis"))


def test_processor_deletes_unsupported_job_type() -> None:
    repository = FakeRepository()
    processor = MeetingReportProcessor(repository, FakeStorage(), FakeAiClient())

    result = processor.process_message(
        json.dumps(
            {
                "jobType": "agent_run_requested",
                "runId": "33333333-3333-3333-3333-333333333333",
                "workspaceId": "22222222-2222-2222-2222-222222222222",
                "requestedByUserId": "11111111-1111-1111-1111-111111111111",
            }
        )
    )

    assert result.delete_message is True
    assert result.reason == "invalid_job"
    assert result.report_id is None
    assert repository.lock_calls == []
    assert repository.release_calls == []


def test_processor_completes_processing_report() -> None:
    repository = FakeRepository()
    storage = FakeStorage()
    ai_client = FakeAiClient()
    processor = MeetingReportProcessor(repository, storage, ai_client)

    result = processor.process_message(meeting_report_job_payload())

    assert result.delete_message is True
    assert result.reason == "completed"
    assert repository.failed_updates == []
    assert repository.progress_updates == [
        (REPORT_ID, "TRANSCRIBING"),
        (REPORT_ID, "SUMMARIZING"),
    ]
    assert len(repository.completed_updates) == 1
    completed_report_id, completed = repository.completed_updates[0]
    assert completed_report_id == REPORT_ID
    assert completed.transcript_text.startswith("진호:")
    assert completed.action_item_candidates[0].assignee_user_id is None
    assert repository.release_calls == [REPORT_ID]


def test_processor_publishes_each_progress_and_completed_state_without_affecting_result() -> None:
    publisher = FakeEventPublisher()
    processor = MeetingReportProcessor(FakeRepository(), FakeStorage(), FakeAiClient(), publisher)

    result = processor.process_message(meeting_report_job_payload())

    assert result.reason == "completed"
    assert publisher.report_ids == [REPORT_ID, REPORT_ID, REPORT_ID]


def test_processor_keeps_terminal_result_when_event_publish_fails() -> None:
    publisher = FakeEventPublisher(should_fail=True)
    processor = MeetingReportProcessor(FakeRepository(), FakeStorage(), FakeAiClient(), publisher)

    result = processor.process_message(meeting_report_job_payload())

    assert result.delete_message is True
    assert result.reason == "completed"


def test_processor_publishes_stt_failure_state_after_storage_failure() -> None:
    publisher = FakeEventPublisher()
    processor = MeetingReportProcessor(
        FakeRepository(),
        FakeStorage(permanent_head_failure=True),
        FakeAiClient(),
        publisher,
    )

    result = processor.process_message(meeting_report_job_payload())

    assert result.reason == "audio_unavailable"
    assert publisher.report_ids == [REPORT_ID, REPORT_ID]


def test_processor_publishes_llm_failure_state() -> None:
    publisher = FakeEventPublisher()
    processor = MeetingReportProcessor(
        FakeRepository(),
        FakeStorage(),
        FakeAiClient(llm_failure=ProviderBusinessError("invalid schema")),
        publisher,
    )

    result = processor.process_message(meeting_report_job_payload())

    assert result.reason == "llm_failed"
    assert publisher.report_ids == [REPORT_ID, REPORT_ID, REPORT_ID]


def test_http_event_publisher_posts_callback_with_token_and_retries(monkeypatch) -> None:
    calls = []

    def fake_urlopen(request, timeout):
        calls.append((request, timeout))
        if len(calls) < 3:
            raise OSError("temporary network failure")
        return FakeHttpResponse()

    monkeypatch.setattr("app.meeting_report_runtime.urlopen", fake_urlopen)
    monkeypatch.setattr("app.meeting_report_runtime.time.sleep", lambda _delay: None)
    publisher = HttpMeetingReportEventPublisher(
        "https://api.example.test/",
        "event-token",
        timeout_seconds=7,
        max_attempts=3,
    )

    publisher.publish(REPORT_ID)

    assert len(calls) == 3
    request, timeout = calls[0]
    assert request.full_url == "https://api.example.test/api/v1/internal/meeting-reports/events"
    assert request.get_header("X-meeting-report-event-token") == "event-token"
    assert request.data == json.dumps({"reportId": REPORT_ID}).encode("utf-8")
    assert timeout == 7


def test_processor_deletes_terminal_report_without_processing() -> None:
    repository = FakeRepository(context=report_context(report_status="COMPLETED"))
    storage = FakeStorage()
    ai_client = FakeAiClient()
    publisher = FakeEventPublisher()
    processor = MeetingReportProcessor(repository, storage, ai_client, publisher)

    result = processor.process_message(meeting_report_job_payload())

    assert result.delete_message is True
    assert result.reason == "terminal_report"
    assert storage.head_calls == []
    assert ai_client.transcribe_calls == []
    assert repository.completed_updates == []
    assert publisher.report_ids == []


def test_processor_marks_large_audio_as_stt_failure() -> None:
    repository = FakeRepository()
    storage = FakeStorage(size=25_000_001)
    ai_client = FakeAiClient()
    processor = MeetingReportProcessor(repository, storage, ai_client)

    result = processor.process_message(meeting_report_job_payload())

    assert result.delete_message is True
    assert result.reason == "audio_too_large"
    assert repository.failed_updates == [
        (
            REPORT_ID,
            "STT",
            "Meeting recording audio file exceeds the 25 MB transcription limit.",
        )
    ]
    assert storage.download_calls == []
    assert ai_client.transcribe_calls == []


def test_processor_marks_stt_business_failure_and_deletes_message() -> None:
    repository = FakeRepository()
    publisher = FakeEventPublisher()
    processor = MeetingReportProcessor(
        repository,
        FakeStorage(),
        FakeAiClient(stt_failure=ProviderBusinessError("invalid audio")),
        publisher,
    )

    result = processor.process_message(meeting_report_job_payload())

    assert result.delete_message is True
    assert result.reason == "stt_failed"
    assert repository.failed_updates == [
        (REPORT_ID, "STT", "Meeting recording could not be transcribed.")
    ]
    assert publisher.report_ids == [REPORT_ID, REPORT_ID]


def test_processor_marks_llm_business_failure_and_deletes_message() -> None:
    repository = FakeRepository()
    processor = MeetingReportProcessor(
        repository,
        FakeStorage(),
        FakeAiClient(llm_failure=ProviderBusinessError("invalid schema")),
    )

    result = processor.process_message(meeting_report_job_payload())

    assert result.delete_message is True
    assert result.reason == "llm_failed"
    assert repository.failed_updates == [
        (REPORT_ID, "LLM", "Meeting report could not be generated.")
    ]


@pytest.mark.parametrize(
    ("title", "description"),
    [
        ("   ", "유효한 설명"),
        ("a" * 501, "유효한 설명"),
        ("유효한 제목", "a" * 5_001),
    ],
)
def test_parse_generated_report_rejects_action_items_that_violate_db_text_constraints(
    title: str, description: str
) -> None:
    with pytest.raises(ProviderBusinessError, match="Invalid action item"):
        parse_generated_report_json(
            json.dumps(
                {
                    "summary": "요약",
                    "discussionPoints": "논의",
                    "decisions": "결정",
                    "actionItemCandidates": [
                        {
                            "title": title,
                            "description": description,
                            "assigneeUserId": None,
                            "priority": "MEDIUM",
                        }
                    ],
                    "evidence": [
                        {"sourceType": "decision", "sourceIndex": 0, "segmentIndexes": [0]},
                        {"sourceType": "action_item", "sourceIndex": 0, "segmentIndexes": [0]},
                    ],
                }
            ),
            "원문",
            [TranscriptSegment(0, 0, 1_000, "원문")],
        )


def test_processor_marks_invalid_action_item_payload_as_llm_failure() -> None:
    class InvalidActionItemAiClient(FakeAiClient):
        def generate_report(
            self, transcript_text: str, transcript_segments: list[TranscriptSegment]
        ) -> GeneratedMeetingReport:
            self.generate_calls.append(transcript_text)
            return parse_generated_report_json(
                json.dumps(
                    {
                        "summary": "요약",
                        "discussionPoints": "논의",
                        "decisions": "결정",
                        "actionItemCandidates": [
                            {
                                "title": " ",
                                "description": "설명",
                                "assigneeUserId": None,
                                "priority": "MEDIUM",
                            }
                        ],
                        "evidence": [
                            {"sourceType": "decision", "sourceIndex": 0, "segmentIndexes": [0]},
                            {"sourceType": "action_item", "sourceIndex": 0, "segmentIndexes": [0]},
                        ],
                    }
                ),
                transcript_text,
                transcript_segments,
            )

    repository = FakeRepository()
    processor = MeetingReportProcessor(repository, FakeStorage(), InvalidActionItemAiClient())

    result = processor.process_message(meeting_report_job_payload())

    assert result.delete_message is True
    assert result.reason == "llm_failed"
    assert repository.completed_updates == []
    assert repository.failed_updates == [
        (REPORT_ID, "LLM", "Meeting report could not be generated.")
    ]


def test_processor_leaves_infrastructure_failure_for_sqs_retry() -> None:
    repository = FakeRepository()
    processor = MeetingReportProcessor(repository, FakeStorage(fail_head=True), FakeAiClient())

    result = processor.process_message(meeting_report_job_payload())

    assert result.delete_message is False
    assert result.reason == "infrastructure_failure"
    assert repository.failed_updates == []
    assert repository.completed_updates == []
    assert repository.release_calls == [REPORT_ID]


def test_processor_marks_permanent_storage_failure_and_deletes_message() -> None:
    repository = FakeRepository()
    processor = MeetingReportProcessor(
        repository,
        FakeStorage(permanent_head_failure=True),
        FakeAiClient(),
    )

    result = processor.process_message(meeting_report_job_payload())

    assert result.delete_message is True
    assert result.reason == "audio_unavailable"
    assert repository.failed_updates == [
        (REPORT_ID, "STT", "Meeting recording audio file is unavailable.")
    ]
    assert repository.completed_updates == []


def test_lock_contention_message_is_left_for_sqs_retry() -> None:
    repository = FakeRepository(lock=False)
    processor = MeetingReportProcessor(repository, FakeStorage(), FakeAiClient())

    result = processor.process_message(meeting_report_job_payload())

    assert result.delete_message is False
    assert result.reason == "duplicate_in_progress"
    assert repository.release_calls == []


def test_runtime_settings_default_meeting_report_model(monkeypatch) -> None:
    monkeypatch.setenv("SQS_AI_JOBS_QUEUE_URL", "https://sqs.example.com/jobs")
    monkeypatch.setenv("S3_RECORDINGS_BUCKET", "recordings")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("OPENAI_STT_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_MEETING_REPORT_MODEL", raising=False)

    settings = RuntimeSettings.from_env()

    assert settings.openai_stt_model == "whisper-1"
    assert settings.openai_meeting_report_model == "gpt-5.4-mini"
    assert settings.openai_agent_planner_model == "gpt-5.4-mini"


def test_runtime_settings_reads_agent_planner_model(monkeypatch) -> None:
    monkeypatch.setenv("SQS_AI_JOBS_QUEUE_URL", "https://sqs.example.com/jobs")
    monkeypatch.setenv("S3_RECORDINGS_BUCKET", "recordings")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_AGENT_PLANNER_MODEL", "gpt-agent-planner")

    settings = RuntimeSettings.from_env()

    assert settings.openai_agent_planner_model == "gpt-agent-planner"


def test_runtime_settings_reads_agent_planner_timeout(monkeypatch) -> None:
    monkeypatch.setenv("SQS_AI_JOBS_QUEUE_URL", "https://sqs.example.com/jobs")
    monkeypatch.setenv("S3_RECORDINGS_BUCKET", "recordings")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_AGENT_PLANNER_TIMEOUT_MS", "45000")

    settings = RuntimeSettings.from_env()

    assert settings.openai_agent_planner_timeout_seconds == 45


def test_runtime_settings_reads_database_ssl(monkeypatch) -> None:
    monkeypatch.setenv("SQS_AI_JOBS_QUEUE_URL", "https://sqs.example.com/jobs")
    monkeypatch.setenv("S3_RECORDINGS_BUCKET", "recordings")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_SSL", "true")

    settings = RuntimeSettings.from_env()

    assert settings.database_ssl is True


def test_runtime_settings_allows_local_database_fallback(monkeypatch) -> None:
    monkeypatch.setenv("SQS_AI_JOBS_QUEUE_URL", "https://sqs.example.com/jobs")
    monkeypatch.setenv("S3_RECORDINGS_BUCKET", "recordings")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.delenv("DATABASE_URL", raising=False)

    settings = RuntimeSettings.from_env()

    assert settings.database_url == "postgresql://pilo:pilo@localhost:5432/pilo"


def test_runtime_settings_requires_database_url_in_deployed_env(monkeypatch) -> None:
    monkeypatch.setenv("SQS_AI_JOBS_QUEUE_URL", "https://sqs.example.com/jobs")
    monkeypatch.setenv("S3_RECORDINGS_BUCKET", "recordings")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("APP_ENV", "dev")
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(
        RuntimeError,
        match="DATABASE_URL is required outside local ai-worker environments",
    ):
        RuntimeSettings.from_env()


def test_openai_transcribe_uses_timestamped_segment_format(tmp_path) -> None:
    audio_path = tmp_path / "recording.m4a"
    audio_path.write_bytes(b"audio")
    transcriptions = FakeOpenAiTranscriptions()
    ai_client = OpenAiMeetingReportClient.__new__(OpenAiMeetingReportClient)
    ai_client.client = SimpleNamespace(audio=SimpleNamespace(transcriptions=transcriptions))
    ai_client.stt_model = "whisper-1"
    ai_client.meeting_report_model = "gpt-5.4-mini"

    transcript = ai_client.transcribe(str(audio_path))

    assert transcript == [TranscriptSegment(0, 0, 1_000, "회의 내용을 정리합니다.")]
    assert transcriptions.kwargs["model"] == "whisper-1"
    assert transcriptions.kwargs["response_format"] == "verbose_json"
    assert transcriptions.kwargs["timestamp_granularities"] == ["segment"]


class FakeOpenAiTranscriptions:
    def __init__(self) -> None:
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            segments=[SimpleNamespace(start=0, end=1, text="회의 내용을 정리합니다.")]
        )


class FakeS3Client:
    def __init__(self, error) -> None:
        self.error = error

    def head_object(self, **_kwargs):
        raise self.error

    def download_file(self, *_args):
        raise self.error


def s3_client_error(code: str, status_code: int):
    from botocore.exceptions import ClientError

    return ClientError(
        {
            "Error": {"Code": code, "Message": "S3 error"},
            "ResponseMetadata": {"HTTPStatusCode": status_code},
        },
        "HeadObject",
    )


def test_s3_404_is_permanent_storage_failure() -> None:
    storage = S3RecordingStorage(FakeS3Client(s3_client_error("NoSuchKey", 404)), "bucket")

    with pytest.raises(PermanentStorageError):
        storage.head_audio(AUDIO_FILE_KEY)


def test_s3_5xx_is_retryable_infrastructure_failure() -> None:
    storage = S3RecordingStorage(
        FakeS3Client(s3_client_error("InternalError", 500)),
        "bucket",
    )

    with pytest.raises(InfrastructureError):
        storage.head_audio(AUDIO_FILE_KEY)


def test_serialize_action_items_uses_api_shape() -> None:
    report = parse_generated_report_json(
        json.dumps(
            {
                "summary": "요약",
                "discussionPoints": "논의",
                "decisions": "결정",
                "actionItemCandidates": [
                    {
                        "title": "작업",
                        "description": "설명",
                        "assigneeUserId": "model-output-is-ignored",
                        "priority": "MEDIUM",
                    }
                ],
                "evidence": [
                    {"sourceType": "decision", "sourceIndex": 0, "segmentIndexes": [0]},
                    {"sourceType": "action_item", "sourceIndex": 0, "segmentIndexes": [0]},
                ],
            }
        ),
        "원문",
        [TranscriptSegment(0, 0, 1_000, "원문")],
    )

    assert json.loads(serialize_action_items(report.action_item_candidates)) == [
        {
            "title": "작업",
            "description": "설명",
            "assigneeUserId": None,
            "priority": "MEDIUM",
        }
    ]


def test_completed_report_materializes_pending_action_items() -> None:
    report = FakeAiClient().generate_report(
        "진호: 회의록 조회 API와 worker 처리 방향을 정리합니다.",
        [TranscriptSegment(0, 0, 1_000, "진호: 회의록 조회 API와 worker 처리 방향을 정리합니다.")],
    )
    repository = object.__new__(PgMeetingReportRepository)
    connection = FakeCompletedReportConnection()
    repository.connection = connection

    repository.mark_completed(REPORT_ID, report)

    inserts = [
        (query, values)
        for query, values in connection.calls
        if "INSERT INTO meeting_report_action_items" in query
    ]
    assert len(inserts) == 1
    query, values = inserts[0]
    assert "ON CONFLICT (meeting_report_id, source_index) DO NOTHING" in query
    assert values == (
        REPORT_ID,
        0,
        "Worker 구현",
        "meeting_report job processor를 구현한다.",
        "HIGH",
    )


def test_parse_generated_report_json_deduplicates_evidence_segments() -> None:
    report = parse_generated_report_json(
        json.dumps(
            {
                "summary": "요약",
                "discussionPoints": "논의",
                "decisions": "결정",
                "actionItemCandidates": [
                    {
                        "title": "작업",
                        "description": "설명",
                        "assigneeUserId": None,
                        "priority": "MEDIUM",
                    }
                ],
                "evidence": [
                    {"sourceType": "decision", "sourceIndex": 0, "segmentIndexes": [0, 0]},
                    {"sourceType": "action_item", "sourceIndex": 0, "segmentIndexes": [0]},
                    {"sourceType": "action_item", "sourceIndex": 0, "segmentIndexes": [0]},
                ],
            }
        ),
        "원문",
        [TranscriptSegment(0, 0, 1_000, "원문")],
    )

    assert [
        (item.source_type, item.source_index, item.segment_indexes) for item in report.evidence
    ] == [
        ("decision", 0, [0]),
        ("action_item", 0, [0]),
    ]
