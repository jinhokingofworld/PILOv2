from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from app.agent_multiturn_context_evaluation import (
    KOREAN_MULTITURN_DOMAINS,
    MultiTurnCatalog,
)

CALIBRATION_FORMAT = "pilo-agent-multiturn-calibration:v1"
CALIBRATION_LABELS = ("pass", "partial", "fail", "inconclusive")


@dataclass(frozen=True)
class JudgeCalibrationResult:
    status: str
    reviewer_agreement: float
    judge_agreement: float
    kappa: float
    sha256: str
    record_count: int


def load_multiturn_judge_calibration(
    path: Path,
    *,
    catalog: MultiTurnCatalog,
    catalog_sha256: str,
    judge_model: str,
    judge_prompt_version: str,
) -> JudgeCalibrationResult:
    raw_bytes = path.read_bytes()
    try:
        payload = json.loads(raw_bytes.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Multi-turn calibration must contain valid UTF-8 JSON") from error
    if not isinstance(payload, dict) or payload.get("format") != CALIBRATION_FORMAT:
        raise ValueError("Multi-turn calibration format is invalid")
    if payload.get("catalogSha256") != catalog_sha256:
        raise ValueError("Multi-turn calibration catalog SHA does not match")
    if payload.get("judgeModel") != judge_model:
        raise ValueError("Multi-turn calibration Judge model does not match")
    if payload.get("judgePromptVersion") != judge_prompt_version:
        raise ValueError("Multi-turn calibration Judge prompt version does not match")

    raw_records = payload.get("records")
    if not isinstance(raw_records, list) or len(raw_records) != 30:
        raise ValueError("Multi-turn calibration requires exactly 30 records")
    conversations = {item.conversation_id: item for item in catalog.conversations}
    domain_counts = {domain: 0 for domain in KOREAN_MULTITURN_DOMAINS}
    seen_ids: set[str] = set()
    reviewer_a: list[str] = []
    reviewer_b: list[str] = []
    adjudicated: list[str] = []
    judge: list[str] = []
    for raw_record in raw_records:
        if not isinstance(raw_record, dict):
            raise ValueError("Multi-turn calibration record must be an object")
        conversation_id = raw_record.get("conversationId")
        domain = raw_record.get("domain")
        if not isinstance(conversation_id, str) or conversation_id not in conversations:
            raise ValueError("Multi-turn calibration conversation is absent from catalog")
        if conversation_id in seen_ids:
            raise ValueError("Multi-turn calibration conversation ids must be unique")
        conversation = conversations[conversation_id]
        if domain != conversation.domain or domain not in domain_counts:
            raise ValueError("Multi-turn calibration domain does not match catalog")
        labels = tuple(
            raw_record.get(key) for key in ("reviewerA", "reviewerB", "adjudicated", "judge")
        )
        if any(label not in CALIBRATION_LABELS for label in labels):
            raise ValueError("Multi-turn calibration label is invalid")
        seen_ids.add(conversation_id)
        domain_counts[domain] += 1
        reviewer_a.append(labels[0])
        reviewer_b.append(labels[1])
        adjudicated.append(labels[2])
        judge.append(labels[3])

    if any(count != 5 for count in domain_counts.values()):
        raise ValueError("Multi-turn calibration requires five records per domain")
    pass_count = adjudicated.count("pass")
    if pass_count < 5 or len(adjudicated) - pass_count < 5:
        raise ValueError(
            "Multi-turn calibration requires at least five pass and five non-pass records"
        )

    reviewer_agreement = _agreement(reviewer_a, reviewer_b)
    judge_agreement = _agreement(judge, adjudicated)
    kappa = _cohens_kappa(judge, adjudicated)
    status = (
        "passed"
        if reviewer_agreement >= 0.9 and judge_agreement >= 0.9 and kappa >= 0.8
        else "pending"
    )
    return JudgeCalibrationResult(
        status=status,
        reviewer_agreement=round(reviewer_agreement, 4),
        judge_agreement=round(judge_agreement, 4),
        kappa=round(kappa, 4),
        sha256=hashlib.sha256(raw_bytes).hexdigest(),
        record_count=len(raw_records),
    )


def _agreement(left: list[str], right: list[str]) -> float:
    if len(left) != len(right) or not left:
        raise ValueError("Calibration agreement requires paired labels")
    return sum(a == b for a, b in zip(left, right, strict=True)) / len(left)


def _cohens_kappa(left: list[str], right: list[str]) -> float:
    observed = _agreement(left, right)
    expected = sum(
        (left.count(label) / len(left)) * (right.count(label) / len(right))
        for label in CALIBRATION_LABELS
    )
    if expected == 1:
        return 1.0 if observed == 1 else 0.0
    return (observed - expected) / (1 - expected)
