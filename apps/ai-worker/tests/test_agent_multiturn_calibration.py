import json
from pathlib import Path

from app.agent_multiturn_calibration import load_multiturn_judge_calibration
from app.agent_multiturn_context_evaluation import (
    KOREAN_MULTITURN_DOMAINS,
    MultiTurnCatalog,
    MultiTurnConversation,
)


def test_calibration_passes_only_when_human_and_judge_thresholds_pass(tmp_path: Path) -> None:
    catalog = _catalog()
    path = _write_calibration(tmp_path, catalog)

    result = load_multiturn_judge_calibration(
        path,
        catalog=catalog,
        catalog_sha256="a" * 64,
        judge_model="gpt-5.4-mini",
        judge_prompt_version="agent-multiturn-context-judge:v1",
    )

    assert result.status == "passed"
    assert result.reviewer_agreement == 1.0
    assert result.judge_agreement == 1.0
    assert result.kappa == 1.0
    assert result.record_count == 30


def test_calibration_remains_pending_when_judge_agreement_is_below_threshold(
    tmp_path: Path,
) -> None:
    catalog = _catalog()
    path = _write_calibration(tmp_path, catalog, judge_failures=4)

    result = load_multiturn_judge_calibration(
        path,
        catalog=catalog,
        catalog_sha256="a" * 64,
        judge_model="gpt-5.4-mini",
        judge_prompt_version="agent-multiturn-context-judge:v1",
    )

    assert result.status == "pending"
    assert result.judge_agreement == 0.8667


def _catalog() -> MultiTurnCatalog:
    conversations = tuple(
        MultiTurnConversation(
            conversation_id=f"{domain}_{index}",
            turns=(),
            domain=domain,
            scenario_family="anaphora",
        )
        for domain in KOREAN_MULTITURN_DOMAINS
        for index in range(5)
    )
    return MultiTurnCatalog(
        "agent-korean-multiturn-holdout:v2",
        conversations,
        "ko-KR",
    )


def _write_calibration(
    tmp_path: Path,
    catalog: MultiTurnCatalog,
    *,
    judge_failures: int = 0,
) -> Path:
    records = [
        {
            "conversationId": conversation.conversation_id,
            "domain": conversation.domain,
            "reviewerA": "pass" if index % 3 else "fail",
            "reviewerB": "pass" if index % 3 else "fail",
            "adjudicated": "pass" if index % 3 else "fail",
            "judge": (
                ("fail" if index % 3 else "pass")
                if index < judge_failures
                else ("pass" if index % 3 else "fail")
            ),
        }
        for index, conversation in enumerate(catalog.conversations)
    ]
    path = tmp_path / "calibration.json"
    path.write_text(
        json.dumps(
            {
                "format": "pilo-agent-multiturn-calibration:v1",
                "catalogSha256": "a" * 64,
                "judgeModel": "gpt-5.4-mini",
                "judgePromptVersion": "agent-multiturn-context-judge:v1",
                "records": records,
            }
        ),
        encoding="utf-8",
    )
    return path
