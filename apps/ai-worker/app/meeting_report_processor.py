from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

MAX_TRANSCRIPTION_FILE_BYTES = 25_000_000
MAX_ACTION_ITEM_TITLE_BYTES = 500
MAX_ACTION_ITEM_DESCRIPTION_BYTES = 5_000
LOGGER = logging.getLogger(__name__)

TERMINAL_REPORT_STATUSES = {"COMPLETED", "FAILED"}
REPORT_IN_PROGRESS_STATUSES = {"PROCESSING", "QUEUED", "TRANSCRIBING", "SUMMARIZING"}
REPORT_FAILED_STEP_STT = "STT"
REPORT_FAILED_STEP_LLM = "LLM"

SAFE_STT_ERROR = "Meeting recording could not be transcribed."
SAFE_LLM_ERROR = "Meeting report could not be generated."
SAFE_AUDIO_MISSING_ERROR = "Meeting recording audio file is unavailable."
SAFE_AUDIO_TOO_LARGE_ERROR = "Meeting recording audio file exceeds the 25 MB transcription limit."


@dataclass(frozen=True)
class MeetingReportJob:
    report_id: str
    meeting_id: str
    recording_id: str
    audio_file_key: str
    retry_count: int


@dataclass(frozen=True)
class MeetingReportContext:
    report_id: str
    meeting_id: str
    recording_id: str
    report_status: str
    recording_status: str
    recording_audio_file_key: str | None


@dataclass(frozen=True)
class AudioObjectMetadata:
    file_size_bytes: int


@dataclass(frozen=True)
class ActionItemCandidate:
    title: str
    description: str
    assignee_user_id: None
    priority: str


@dataclass(frozen=True)
class TranscriptSegment:
    segment_index: int
    started_at_ms: int
    ended_at_ms: int
    text: str


@dataclass(frozen=True)
class EvidenceReference:
    source_type: str
    source_index: int
    segment_indexes: list[int]


@dataclass(frozen=True)
class GeneratedMeetingReport:
    transcript_text: str
    summary: str
    discussion_points: str
    decisions: str
    action_item_candidates: list[ActionItemCandidate]
    transcript_segments: list[TranscriptSegment]
    evidence: list[EvidenceReference]


@dataclass(frozen=True)
class ProcessResult:
    delete_message: bool
    reason: str
    report_id: str | None = None


class InfrastructureError(Exception):
    """Retryable failure owned by infrastructure or external service availability."""


class PermanentStorageError(Exception):
    """Non-retryable recording storage failure such as a missing object."""


class ProviderBusinessError(Exception):
    """Non-retryable provider failure that should be saved on the MeetingReport."""


class MeetingReportRepository(Protocol):
    def try_acquire_report_lock(self, report_id: str) -> bool: ...

    def release_report_lock(self, report_id: str) -> None: ...

    def get_report_context(self, job: MeetingReportJob) -> MeetingReportContext | None: ...

    def mark_progress(self, report_id: str, status: str) -> None: ...

    def mark_failed(self, report_id: str, failed_step: str, error_message: str) -> None: ...

    def mark_completed(self, report_id: str, report: GeneratedMeetingReport) -> None: ...


class RecordingStorage(Protocol):
    def head_audio(self, audio_file_key: str) -> AudioObjectMetadata: ...

    def download_audio(self, audio_file_key: str) -> str: ...


class MeetingReportAiClient(Protocol):
    def transcribe(self, audio_file_path: str) -> list[TranscriptSegment]: ...

    def generate_report(
        self, transcript_text: str, transcript_segments: list[TranscriptSegment]
    ) -> GeneratedMeetingReport: ...


class MeetingReportEventPublisher(Protocol):
    def publish(self, report_id: str) -> None: ...


def parse_meeting_report_job(message_body: str) -> MeetingReportJob:
    try:
        payload = json.loads(message_body)
    except json.JSONDecodeError as error:
        raise ValueError("Invalid meeting report job JSON") from error

    if not isinstance(payload, dict):
        raise ValueError("Invalid meeting report job payload")

    return parse_meeting_report_payload(payload)


def parse_meeting_report_payload(payload: dict[str, object]) -> MeetingReportJob:
    if payload.get("jobType") != "meeting_report":
        raise ValueError("Unsupported job type")

    report_id = _require_uuid_string(payload, "reportId")
    meeting_id = _require_uuid_string(payload, "meetingId")
    recording_id = _require_uuid_string(payload, "recordingId")
    audio_file_key = _require_string(payload, "audioFileKey")
    retry_count = payload.get("retryCount", 0)

    if not isinstance(retry_count, int) or isinstance(retry_count, bool) or retry_count < 0:
        raise ValueError("Invalid retryCount")

    return MeetingReportJob(
        report_id=report_id,
        meeting_id=meeting_id,
        recording_id=recording_id,
        audio_file_key=audio_file_key,
        retry_count=retry_count,
    )


class MeetingReportProcessor:
    def __init__(
        self,
        repository: MeetingReportRepository,
        storage: RecordingStorage,
        ai_client: MeetingReportAiClient,
        event_publisher: MeetingReportEventPublisher | None = None,
    ) -> None:
        self.repository = repository
        self.storage = storage
        self.ai_client = ai_client
        self.event_publisher = event_publisher

    def process_message(self, message_body: str) -> ProcessResult:
        try:
            job = parse_meeting_report_job(message_body)
        except ValueError:
            return ProcessResult(delete_message=True, reason="invalid_job")

        return self.process_job(job)

    def process_payload(self, payload: dict[str, object]) -> ProcessResult:
        try:
            job = parse_meeting_report_payload(payload)
        except ValueError:
            return ProcessResult(delete_message=True, reason="invalid_job")

        return self.process_job(job)

    def process_job(self, job: MeetingReportJob) -> ProcessResult:
        lock_acquired = self.repository.try_acquire_report_lock(job.report_id)
        if not lock_acquired:
            return self._result(job, delete_message=False, reason="duplicate_in_progress")

        downloaded_path: str | None = None
        try:
            context = self.repository.get_report_context(job)
            if context is None:
                return self._result(job, delete_message=True, reason="report_not_found")

            if context.report_status in TERMINAL_REPORT_STATUSES:
                return self._result(job, delete_message=True, reason="terminal_report")

            if context.report_status not in {"PROCESSING", "QUEUED"}:
                return self._result(job, delete_message=True, reason="unsupported_report_status")

            self.repository.mark_progress(job.report_id, "TRANSCRIBING")
            self._publish_report_updated(job.report_id)

            if context.recording_status != "COMPLETED":
                self.repository.mark_failed(
                    job.report_id,
                    REPORT_FAILED_STEP_STT,
                    SAFE_AUDIO_MISSING_ERROR,
                )
                self._publish_report_updated(job.report_id)
                return self._result(job, delete_message=True, reason="recording_not_completed")

            if context.recording_audio_file_key != job.audio_file_key:
                self.repository.mark_failed(
                    job.report_id,
                    REPORT_FAILED_STEP_STT,
                    SAFE_AUDIO_MISSING_ERROR,
                )
                self._publish_report_updated(job.report_id)
                return self._result(job, delete_message=True, reason="audio_key_mismatch")

            try:
                metadata = self.storage.head_audio(job.audio_file_key)
            except PermanentStorageError:
                self.repository.mark_failed(
                    job.report_id,
                    REPORT_FAILED_STEP_STT,
                    SAFE_AUDIO_MISSING_ERROR,
                )
                self._publish_report_updated(job.report_id)
                return self._result(job, delete_message=True, reason="audio_unavailable")

            if metadata.file_size_bytes > MAX_TRANSCRIPTION_FILE_BYTES:
                self.repository.mark_failed(
                    job.report_id,
                    REPORT_FAILED_STEP_STT,
                    SAFE_AUDIO_TOO_LARGE_ERROR,
                )
                self._publish_report_updated(job.report_id)
                return self._result(job, delete_message=True, reason="audio_too_large")

            try:
                downloaded_path = self.storage.download_audio(job.audio_file_key)
            except PermanentStorageError:
                self.repository.mark_failed(
                    job.report_id,
                    REPORT_FAILED_STEP_STT,
                    SAFE_AUDIO_MISSING_ERROR,
                )
                self._publish_report_updated(job.report_id)
                return self._result(job, delete_message=True, reason="audio_unavailable")

            try:
                transcript_segments = self.ai_client.transcribe(downloaded_path)
            except ProviderBusinessError:
                self.repository.mark_failed(
                    job.report_id,
                    REPORT_FAILED_STEP_STT,
                    SAFE_STT_ERROR,
                )
                self._publish_report_updated(job.report_id)
                return self._result(job, delete_message=True, reason="stt_failed")

            self.repository.mark_progress(job.report_id, "SUMMARIZING")
            self._publish_report_updated(job.report_id)

            try:
                transcript_text = "\n".join(segment.text for segment in transcript_segments)
                report = self.ai_client.generate_report(transcript_text, transcript_segments)
            except ProviderBusinessError:
                self.repository.mark_failed(
                    job.report_id,
                    REPORT_FAILED_STEP_LLM,
                    SAFE_LLM_ERROR,
                )
                self._publish_report_updated(job.report_id)
                return self._result(job, delete_message=True, reason="llm_failed")

            self.repository.mark_completed(job.report_id, report)
            self._publish_report_updated(job.report_id)
            return self._result(job, delete_message=True, reason="completed")
        except InfrastructureError:
            return self._result(job, delete_message=False, reason="infrastructure_failure")
        finally:
            if downloaded_path is not None:
                _unlink_if_exists(downloaded_path)
            self.repository.release_report_lock(job.report_id)

    def _publish_report_updated(self, report_id: str) -> None:
        if self.event_publisher is None:
            return
        try:
            self.event_publisher.publish(report_id)
        except Exception:
            LOGGER.warning("MeetingReport realtime event delivery failed report_id=%s", report_id)

    def _result(self, job: MeetingReportJob, delete_message: bool, reason: str) -> ProcessResult:
        return ProcessResult(
            delete_message=delete_message,
            reason=reason,
            report_id=job.report_id,
        )


def parse_generated_report_json(
    raw_text: str, transcript_text: str, transcript_segments: list[TranscriptSegment]
) -> GeneratedMeetingReport:
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as error:
        raise ProviderBusinessError("Invalid meeting report JSON") from error

    if not isinstance(payload, dict):
        raise ProviderBusinessError("Invalid meeting report payload")

    summary = _require_payload_string(payload, "summary")
    discussion_points = _require_payload_string(payload, "discussionPoints")
    decisions = _require_payload_string(payload, "decisions")
    raw_action_items = payload.get("actionItemCandidates")

    if not isinstance(raw_action_items, list):
        raise ProviderBusinessError("Invalid action item candidates")

    action_items = [_parse_action_item(item) for item in raw_action_items]
    evidence = _parse_evidence(payload.get("evidence"), transcript_segments, len(action_items))

    return GeneratedMeetingReport(
        transcript_text=transcript_text,
        summary=summary,
        discussion_points=discussion_points,
        decisions=decisions,
        action_item_candidates=action_items,
        transcript_segments=transcript_segments,
        evidence=evidence,
    )


def serialize_action_items(action_items: list[ActionItemCandidate]) -> str:
    return json.dumps(
        [
            {
                "title": item.title,
                "description": item.description,
                "assigneeUserId": item.assignee_user_id,
                "priority": item.priority,
            }
            for item in action_items
        ],
        ensure_ascii=False,
    )


def _parse_action_item(value: object) -> ActionItemCandidate:
    if not isinstance(value, dict):
        raise ProviderBusinessError("Invalid action item")

    title = _require_action_item_text(value, "title", MAX_ACTION_ITEM_TITLE_BYTES)
    description = _require_action_item_text(value, "description", MAX_ACTION_ITEM_DESCRIPTION_BYTES)
    priority = _require_payload_string(value, "priority")
    if "assigneeUserId" not in value:
        raise ProviderBusinessError("Invalid action item assignee")

    if priority not in {"LOW", "MEDIUM", "HIGH"}:
        raise ProviderBusinessError("Invalid action item priority")

    return ActionItemCandidate(
        title=title,
        description=description,
        assignee_user_id=None,
        priority=priority,
    )


def _parse_evidence(
    value: object, segments: list[TranscriptSegment], action_item_count: int
) -> list[EvidenceReference]:
    if not isinstance(value, list):
        raise ProviderBusinessError("Invalid evidence")
    valid_indexes = {segment.segment_index for segment in segments}
    segment_indexes_by_source: dict[tuple[str, int], list[int]] = {}
    for item in value:
        if not isinstance(item, dict):
            raise ProviderBusinessError("Invalid evidence reference")
        source_type = _require_payload_string(item, "sourceType")
        source_index = item.get("sourceIndex")
        segment_indexes = item.get("segmentIndexes")
        if (
            source_type not in {"summary", "discussion", "decision", "action_item"}
            or not isinstance(source_index, int)
            or not isinstance(segment_indexes, list)
        ):
            raise ProviderBusinessError("Invalid evidence reference")
        if source_type == "action_item" and not 0 <= source_index < action_item_count:
            raise ProviderBusinessError("Invalid action item evidence")
        if not all(isinstance(index, int) and index in valid_indexes for index in segment_indexes):
            raise ProviderBusinessError("Invalid evidence segment")
        if source_type in {"decision", "action_item"} and not segment_indexes:
            raise ProviderBusinessError("Missing required evidence")
        source = (source_type, source_index)
        unique_segment_indexes = segment_indexes_by_source.setdefault(source, [])
        for segment_index in segment_indexes:
            if segment_index not in unique_segment_indexes:
                unique_segment_indexes.append(segment_index)
    references = [
        EvidenceReference(source_type, source_index, segment_indexes)
        for (source_type, source_index), segment_indexes in segment_indexes_by_source.items()
    ]
    required_sources = {("decision", 0)} | {
        ("action_item", index) for index in range(action_item_count)
    }
    provided_sources = {
        (reference.source_type, reference.source_index)
        for reference in references
        if reference.segment_indexes
    }
    if not required_sources.issubset(provided_sources):
        raise ProviderBusinessError("Missing required evidence")
    return references


def _require_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Invalid {key}")
    return value


def _require_uuid_string(payload: dict[str, object], key: str) -> str:
    value = _require_string(payload, key)
    try:
        UUID(value)
    except ValueError as error:
        raise ValueError(f"Invalid {key}") from error
    return value


def _require_payload_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise ProviderBusinessError(f"Invalid {key}")
    return value


def _require_action_item_text(payload: dict[str, object], key: str, max_bytes: int) -> str:
    value = _require_payload_string(payload, key).strip()
    if not value or len(value.encode("utf-8")) > max_bytes:
        raise ProviderBusinessError(f"Invalid action item {key}")
    return value


def _unlink_if_exists(path: str) -> None:
    try:
        os.unlink(path)
    except FileNotFoundError:
        return
