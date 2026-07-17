from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Protocol
from uuid import UUID

from app.meeting_report_processor import (
    ActionItemCandidate,
    ActivityEvidence,
    ActivityEvidenceReference,
    EvidenceReference,
    InfrastructureError,
    ProcessResult,
    ProviderBusinessError,
    TranscriptSegment,
    _parse_action_item,
    _parse_activity_evidence_references,
    _parse_evidence,
    _require_action_item_evidence,
)

LOGGER = logging.getLogger(__name__)

MEETING_ACTION_ITEM_EXTRACTION_JOB_TYPE = "meeting_action_item_extraction"
SAFE_ACTION_ITEM_EXTRACTION_ERROR = "Meeting report follow-up tasks could not be generated."


@dataclass(frozen=True)
class MeetingActionItemExtractionJob:
    report_id: str


@dataclass(frozen=True)
class MeetingActionItemExtractionContext:
    report_id: str
    report_status: str
    extraction_status: str
    transcript_segments: list[TranscriptSegment]
    activity_evidence: list[ActivityEvidence] = field(default_factory=list)


@dataclass(frozen=True)
class GeneratedActionItemExtraction:
    action_item_candidates: list[ActionItemCandidate]
    evidence: list[EvidenceReference]
    activity_evidence_references: list[ActivityEvidenceReference]


class ActionItemExtractionRepository(Protocol):
    def try_acquire_action_item_extraction_lock(self, report_id: str) -> bool: ...

    def release_action_item_extraction_lock(self, report_id: str) -> None: ...

    def get_action_item_extraction_context(
        self, job: MeetingActionItemExtractionJob
    ) -> MeetingActionItemExtractionContext | None: ...

    def mark_action_item_extraction_processing(self, report_id: str) -> None: ...

    def mark_action_item_extraction_failed(
        self,
        report_id: str,
        failure_code: str,
        failure_detail: dict[str, str | bool | int | None],
    ) -> None: ...

    def mark_action_item_extraction_completed(
        self, report_id: str, extraction: GeneratedActionItemExtraction
    ) -> None: ...


class ActionItemExtractionAiClient(Protocol):
    def generate_action_item_extraction(
        self,
        transcript_segments: list[TranscriptSegment],
        activity_evidence: list[ActivityEvidence],
    ) -> GeneratedActionItemExtraction: ...


class MeetingReportEventPublisher(Protocol):
    def publish(self, report_id: str) -> None: ...


def parse_action_item_extraction_payload(
    payload: dict[str, object],
) -> MeetingActionItemExtractionJob:
    if payload.get("jobType") != MEETING_ACTION_ITEM_EXTRACTION_JOB_TYPE:
        raise ValueError("Unsupported job type")
    report_id = payload.get("reportId")
    if not isinstance(report_id, str):
        raise ValueError("Invalid reportId")
    try:
        UUID(report_id)
    except ValueError as error:
        raise ValueError("Invalid reportId") from error
    return MeetingActionItemExtractionJob(report_id=report_id)


def parse_generated_action_item_extraction_json(
    raw_text: str,
    transcript_segments: list[TranscriptSegment],
    activity_evidence: list[ActivityEvidence],
) -> GeneratedActionItemExtraction:
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as error:
        raise ProviderBusinessError("Invalid action item extraction JSON") from error
    if not isinstance(payload, dict):
        raise ProviderBusinessError("Invalid action item extraction payload")

    raw_action_items = payload.get("actionItemCandidates")
    if not isinstance(raw_action_items, list):
        raise ProviderBusinessError("Invalid action item candidates")
    action_items = [_parse_action_item(item) for item in raw_action_items]
    evidence = _parse_evidence(payload.get("evidence"), transcript_segments, len(action_items), 0)
    activity_references = _parse_activity_evidence_references(
        payload.get("activityEvidenceReferences", []),
        activity_evidence,
        len(action_items),
        0,
    )
    if any(reference.source_type != "action_item" for reference in evidence):
        raise ProviderBusinessError("Invalid action item evidence source")
    if any(reference.source_type != "action_item" for reference in activity_references):
        raise ProviderBusinessError("Invalid action item Activity evidence source")
    _require_action_item_evidence(action_items, evidence, activity_references)
    return GeneratedActionItemExtraction(action_items, evidence, activity_references)


class MeetingActionItemExtractionProcessor:
    def __init__(
        self,
        repository: ActionItemExtractionRepository,
        ai_client: ActionItemExtractionAiClient,
        event_publisher: MeetingReportEventPublisher | None = None,
    ) -> None:
        self.repository = repository
        self.ai_client = ai_client
        self.event_publisher = event_publisher

    def process_payload(self, payload: dict[str, object]) -> ProcessResult:
        try:
            job = parse_action_item_extraction_payload(payload)
        except ValueError:
            return ProcessResult(delete_message=True, reason="invalid_job")

        if not self.repository.try_acquire_action_item_extraction_lock(job.report_id):
            return ProcessResult(False, "duplicate_in_progress", job.report_id)
        try:
            context = self.repository.get_action_item_extraction_context(job)
            if context is None:
                return ProcessResult(True, "report_not_found", job.report_id)
            if context.extraction_status in {"completed", "failed"}:
                return ProcessResult(True, "terminal_extraction", job.report_id)
            if context.report_status != "COMPLETED":
                return ProcessResult(True, "report_not_completed", job.report_id)

            self.repository.mark_action_item_extraction_processing(job.report_id)
            try:
                extraction = self.ai_client.generate_action_item_extraction(
                    context.transcript_segments, context.activity_evidence
                )
            except ProviderBusinessError as error:
                self.repository.mark_action_item_extraction_failed(
                    job.report_id,
                    (
                        "INVALID_ACTION_ITEM_EVIDENCE"
                        if "evidence" in str(error).lower()
                        else "INVALID_ACTION_ITEM_OUTPUT"
                    ),
                    {"category": "invalid_output", "retryable": False, "providerStatusCode": None},
                )
                self._publish(job.report_id)
                return ProcessResult(True, "action_item_extraction_failed", job.report_id)

            self.repository.mark_action_item_extraction_completed(job.report_id, extraction)
            self._publish(job.report_id)
            return ProcessResult(True, "completed", job.report_id)
        except InfrastructureError:
            return ProcessResult(False, "infrastructure_failure", job.report_id)
        finally:
            self.repository.release_action_item_extraction_lock(job.report_id)

    def _publish(self, report_id: str) -> None:
        if self.event_publisher is None:
            return
        try:
            self.event_publisher.publish(report_id)
        except Exception:
            LOGGER.warning("MeetingReport realtime delivery failed report_id=%s", report_id)
