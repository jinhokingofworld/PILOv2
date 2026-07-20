import pytest

from app.phase4e_dev_smoke import (
    validate_observation,
    validate_running_recording_unchanged,
    validate_tool_step,
)


def run(tool_status: str = "pending", mode: str = "llm_router") -> dict[str, object]:
    observation = (
        {
            "toolRouting": {
                "mode": "llm_router",
                "status": "routed",
                "domains": ["meeting"],
                "capabilityIds": ["meeting.recording.end"],
            }
        }
        if mode == "llm_router"
        else {"toolRetrieval": {"mode": mode, "usedShortlist": False}}
    )
    return {
        "steps": [
            {
                "type": "planner",
                "outputSummary": observation,
            },
            {"type": "tool", "toolName": "end_meeting_recording", "status": tool_status},
        ]
    }


def test_dev_smoke_requires_llm_router_observation() -> None:
    value = run()
    assert (
        validate_observation(value, "llm_router", "end_meeting_recording")[
            "routingObservationCount"
        ]
        == 1
    )
    with pytest.raises(ValueError, match="expected retrieval mode"):
        validate_observation(run(mode="shadow"), "llm_router", "end_meeting_recording")


def test_dev_smoke_accepts_shadow_with_the_expected_primary_tool() -> None:
    value = run(mode="shadow")
    value["steps"][0]["outputSummary"]["toolRetrieval"]["primaryToolName"] = "end_meeting_recording"
    assert (
        validate_observation(value, "shadow", "end_meeting_recording")[
            "expectedPrimaryToolObserved"
        ]
        is True
    )


def test_dev_smoke_rejects_write_completed_before_confirmation() -> None:
    validate_tool_step(run(), "end_meeting_recording", completed=False)
    with pytest.raises(ValueError, match="mutated before confirmation"):
        validate_tool_step(run(tool_status="completed"), "end_meeting_recording", completed=False)


def test_dev_smoke_requires_authoritative_recording_to_remain_running() -> None:
    running = {"id": "recording-1", "status": "RUNNING"}
    validate_running_recording_unchanged(running, {"id": "recording-1", "status": "RUNNING"})
    with pytest.raises(ValueError, match="recording changed"):
        validate_running_recording_unchanged(running, {"id": "recording-1", "status": "COMPLETED"})
    with pytest.raises(ValueError, match="no longer running"):
        validate_running_recording_unchanged(running, None)
