from __future__ import annotations

import json

from app.meeting_action_item_extraction_processor import (
    MEETING_ACTION_ITEM_EXTRACTION_JOB_TYPE,
    GeneratedActionItemExtraction,
    MeetingActionItemExtractionContext,
    MeetingActionItemExtractionProcessor,
    parse_generated_action_item_extraction_json,
)
from app.meeting_report_processor import ActivityEvidence, TranscriptSegment

REPORT_ID = "11111111-1111-4111-8111-111111111111"


class FakeRepository:
    def __init__(self) -> None:
        self.context = MeetingActionItemExtractionContext(
            report_id=REPORT_ID,
            report_status="COMPLETED",
            extraction_status="queued",
            transcript_segments=[TranscriptSegment(0, 0, 1_000, "다음 주에 배포한다.")],
        )
        self.completed: list[GeneratedActionItemExtraction] = []
        self.failed: list[str] = []

    def try_acquire_action_item_extraction_lock(self, _report_id: str) -> bool:
        return True

    def release_action_item_extraction_lock(self, _report_id: str) -> None:
        return None

    def get_action_item_extraction_context(
        self, _job: object
    ) -> MeetingActionItemExtractionContext:
        return self.context

    def mark_action_item_extraction_processing(self, _report_id: str) -> None:
        return None

    def mark_action_item_extraction_failed(
        self, _report_id: str, failure_code: str, _failure_detail: dict[str, object]
    ) -> None:
        self.failed.append(failure_code)

    def mark_action_item_extraction_completed(
        self, _report_id: str, extraction: GeneratedActionItemExtraction
    ) -> None:
        self.completed.append(extraction)


class FakeAiClient:
    def generate_action_item_extraction(
        self,
        transcript_segments: list[TranscriptSegment],
        activity_evidence: list[ActivityEvidence],
    ) -> GeneratedActionItemExtraction:
        return parse_generated_action_item_extraction_json(
            json.dumps(
                {
                    "actionItemCandidates": [
                        {
                            "title": "배포 준비",
                            "description": "다음 주 배포를 준비합니다.",
                            "assigneeUserId": None,
                            "priority": "MEDIUM",
                        }
                    ],
                    "evidence": [
                        {
                            "sourceType": "action_item",
                            "sourceIndex": 0,
                            "segmentIndexes": [0],
                        }
                    ],
                    "activityEvidenceReferences": [],
                }
            ),
            transcript_segments,
            activity_evidence,
        )


def test_action_item_extraction_processor_completes_without_changing_report_status() -> None:
    repository = FakeRepository()
    processor = MeetingActionItemExtractionProcessor(repository, FakeAiClient())

    result = processor.process_payload(
        {"jobType": MEETING_ACTION_ITEM_EXTRACTION_JOB_TYPE, "reportId": REPORT_ID}
    )

    assert result.delete_message is True
    assert result.reason == "completed"
    assert len(repository.completed) == 1
    assert repository.failed == []


def test_action_item_extraction_rejects_missing_action_item_evidence() -> None:
    try:
        parse_generated_action_item_extraction_json(
            json.dumps(
                {
                    "actionItemCandidates": [
                        {
                            "title": "배포 준비",
                            "description": "다음 주 배포를 준비합니다.",
                            "assigneeUserId": None,
                            "priority": "MEDIUM",
                        }
                    ],
                    "evidence": [],
                    "activityEvidenceReferences": [],
                }
            ),
            [TranscriptSegment(0, 0, 1_000, "다음 주에 배포한다.")],
            [],
        )
    except Exception as error:
        assert getattr(error, "code", None) == "MISSING_ACTION_ITEM_EVIDENCE"
    else:
        raise AssertionError("missing evidence must be rejected")
