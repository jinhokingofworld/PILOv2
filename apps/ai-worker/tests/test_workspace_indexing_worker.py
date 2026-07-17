import json

from app.workspace_indexing_worker_runtime import (
    DocumentEmbeddingProcessor,
    DocumentEmbeddingSource,
    WorkspaceIndexingMessage,
    WorkspaceIndexingWorker,
    WorkspaceIndexingWorkerSettings,
    chunk_document_text,
    parse_workspace_indexing_message,
)


class FakeRepository:
    def __init__(
        self,
        job: dict[str, object] | None,
        source: DocumentEmbeddingSource | None,
    ) -> None:
        self.job = job
        self.source = source
        self.replaced: list[tuple[dict[str, object], list[object], list[list[float]]]] = []
        self.completed: list[str] = []
        self.superseded: list[str] = []
        self.requeued: list[tuple[str, str]] = []
        self.failed: list[tuple[str, str]] = []

    def claim_document_embedding_job(self, job_id: str) -> dict[str, object] | None:
        assert self.job is None or self.job["id"] == job_id
        return self.job

    def get_document_embedding_source(
        self, job: dict[str, object]
    ) -> DocumentEmbeddingSource | None:
        return self.source

    def replace_document_embedding_chunks(
        self,
        job: dict[str, object],
        chunks: list[object],
        embeddings: list[list[float]],
        model_name: str,
        model_version: int,
    ) -> bool:
        assert model_name == "text-embedding-3-small"
        assert model_version == 1
        self.replaced.append((job, chunks, embeddings))
        return True

    def complete_document_embedding_job(self, job_id: str) -> None:
        self.completed.append(job_id)

    def supersede_document_embedding_job(self, job_id: str) -> None:
        self.superseded.append(job_id)

    def requeue_document_embedding_job(self, job_id: str, message: str) -> None:
        self.requeued.append((job_id, message))

    def fail_document_embedding_job(self, job_id: str, message: str) -> None:
        self.failed.append((job_id, message))


class FakeEmbedder:
    model_name = "text-embedding-3-small"
    model_version = 1

    def embed_passages(self, texts: list[str]) -> list[list[float]]:
        assert all(texts)
        return [[0.1] * 1536 for _text in texts]


class FakeSqsClient:
    def __init__(self, message: dict[str, object]) -> None:
        self.message = message
        self.deleted: list[dict[str, str]] = []

    def receive_message(self, **_kwargs: object) -> dict[str, list[dict[str, object]]]:
        return {"Messages": [self.message]}

    def delete_message(self, **kwargs: str) -> None:
        self.deleted.append(kwargs)


def worker_settings() -> WorkspaceIndexingWorkerSettings:
    return WorkspaceIndexingWorkerSettings(
        aws_region="ap-northeast-2",
        sqs_queue_url="https://sqs.example.com/workspace-indexing",
        sqs_endpoint=None,
        database_url="postgresql://pilo:pilo@localhost:5432/pilo",
        database_ssl=False,
        openai_api_key="test-key",
        embedding_model="text-embedding-3-small",
        wait_time_seconds=1,
        visibility_timeout_seconds=900,
    )


def test_workspace_indexing_message_accepts_document_jobs_only() -> None:
    message = parse_workspace_indexing_message(
        json.dumps({"version": 1, "source": "document", "jobId": "job-1"})
    )

    assert message == WorkspaceIndexingMessage(version=1, source="document", job_id="job-1")
    assert parse_workspace_indexing_message("not-json") is None
    assert parse_workspace_indexing_message(
        '{"version":1,"source":"calendar","jobId":"job-1"}'
    ) == (WorkspaceIndexingMessage(version=1, source="calendar", job_id="job-1"))


def test_document_embedding_processor_chunks_and_completes_latest_snapshot() -> None:
    repository = FakeRepository(
        {"id": "job-1", "snapshot_id": "snapshot-1"},
        DocumentEmbeddingSource(
            snapshot_id="snapshot-1",
            plain_text="첫 문단입니다.\n\n둘째 문단입니다.",
        ),
    )
    processor = DocumentEmbeddingProcessor(repository, FakeEmbedder())

    result = processor.process("job-1")

    assert result == "document_embedding_completed"
    assert repository.completed == ["job-1"]
    assert repository.superseded == []
    assert len(repository.replaced) == 1
    assert repository.replaced[0][1][0].chunk_text == "첫 문단입니다.\n\n둘째 문단입니다."


def test_document_embedding_processor_supersedes_stale_snapshot() -> None:
    repository = FakeRepository(
        {"id": "job-1", "snapshot_id": "snapshot-1"},
        DocumentEmbeddingSource(snapshot_id="snapshot-2", plain_text="최신 문서입니다."),
    )
    processor = DocumentEmbeddingProcessor(repository, FakeEmbedder())

    assert processor.process("job-1") == "document_embedding_superseded"
    assert repository.superseded == ["job-1"]
    assert repository.replaced == []


def test_document_chunking_splits_large_paragraph_without_losing_text() -> None:
    chunks = chunk_document_text("가" * 20, max_characters=8)

    assert [chunk.chunk_text for chunk in chunks] == ["가" * 8, "가" * 8, "가" * 4]
    assert [chunk.chunk_index for chunk in chunks] == [0, 1, 2]


def test_worker_keeps_calendar_message_for_its_future_source_handler() -> None:
    sqs = FakeSqsClient(
        {
            "Body": '{"version":1,"source":"calendar","jobId":"job-1"}',
            "ReceiptHandle": "receipt-1",
        }
    )
    processor = DocumentEmbeddingProcessor(FakeRepository(None, None), FakeEmbedder())

    assert WorkspaceIndexingWorker(worker_settings(), processor, sqs).run_once() == 1
    assert sqs.deleted == []


def test_worker_marks_third_retryable_document_failure_as_final() -> None:
    repository = FakeRepository(
        {"id": "job-1", "snapshot_id": "snapshot-1"},
        DocumentEmbeddingSource(snapshot_id="snapshot-1", plain_text="본문"),
    )

    class FailingEmbedder(FakeEmbedder):
        def embed_passages(self, texts: list[str]) -> list[list[float]]:
            raise RuntimeError("OpenAI unavailable")

    sqs = FakeSqsClient(
        {
            "Body": '{"version":1,"source":"document","jobId":"job-1"}',
            "ReceiptHandle": "receipt-1",
            "Attributes": {"ApproximateReceiveCount": "3"},
        }
    )
    worker = WorkspaceIndexingWorker(
        worker_settings(),
        DocumentEmbeddingProcessor(repository, FailingEmbedder()),
        sqs,
    )

    worker.run_once()

    assert repository.requeued == [("job-1", "Document embedding could not be completed")]
    assert repository.failed == [("job-1", "Document embedding retry limit was reached")]
    assert sqs.deleted == [
        {
            "QueueUrl": "https://sqs.example.com/workspace-indexing",
            "ReceiptHandle": "receipt-1",
        }
    ]
