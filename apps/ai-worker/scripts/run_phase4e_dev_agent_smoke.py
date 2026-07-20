from __future__ import annotations

import argparse
import json
import os
import secrets
from pathlib import Path

from app.phase4e_dev_smoke import (
    AgentApiClient,
    SmokeConfig,
    validate_observation,
    validate_running_recording_unchanged,
    validate_tool_step,
    wait_for_status,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run privacy-safe Phase 4-E dev Agent smoke.")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--expected-mode", choices=("shadow", "llm_router"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    token = os.environ.get("PHASE4E_DEV_AGENT_TOKEN")
    if not token:
        raise SystemExit("PHASE4E_DEV_AGENT_TOKEN is required")

    client = AgentApiClient(
        SmokeConfig(args.base_url, args.workspace_id, token, args.expected_mode)
    )
    nonce = secrets.token_hex(12)
    read = client.create_run("최근 회의록 보여줘", f"phase4e-read-{nonce}")
    read_id = str(read["id"])
    read = wait_for_status(client, read_id, {"completed"}, 120)
    read_observation = validate_observation(read, args.expected_mode, "list_meeting_reports")
    validate_tool_step(read, "list_meeting_reports", completed=True)

    meeting = client.get_current_meeting()
    meeting_id = meeting.get("id")
    if not isinstance(meeting_id, str):
        raise ValueError("Agent smoke current Meeting is invalid")
    recording_before = client.get_current_recording(meeting_id)
    validate_running_recording_unchanged(recording_before, recording_before)

    write = client.create_run("녹음 끝내줘", f"phase4e-write-{nonce}")
    write_id = str(write["id"])
    write = wait_for_status(client, write_id, {"waiting_confirmation"}, 120)
    write_observation = validate_observation(write, args.expected_mode, "end_meeting_recording")
    validate_tool_step(write, "end_meeting_recording", completed=False)
    confirmation = write.get("confirmation")
    if not isinstance(confirmation, dict) or confirmation.get("status") != "pending":
        raise ValueError("Agent smoke write did not create a pending confirmation")
    plan = confirmation.get("plan")
    if not isinstance(plan, dict):
        raise ValueError("Agent smoke write confirmation plan is invalid")
    before = plan.get("before")
    if not isinstance(before, dict) or before.get("meetingId") != meeting_id:
        raise ValueError("Agent smoke confirmation selected a different Meeting")
    recording_during_confirmation = client.get_current_recording(meeting_id)
    validate_running_recording_unchanged(recording_before, recording_during_confirmation)
    client.reject(write_id, str(confirmation["id"]))
    rejected = wait_for_status(client, write_id, {"cancelled"}, 30)
    validate_tool_step(rejected, "end_meeting_recording", completed=False)
    recording_after_rejection = client.get_current_recording(meeting_id)
    validate_running_recording_unchanged(recording_before, recording_after_rejection)

    report = {
        "format": "phase4e-agent-dev-smoke:v2",
        "passed": True,
        "mode": args.expected_mode,
        "checks": {
            "readCompleted": True,
            "writeWaitingConfirmation": True,
            "mutationBeforeConfirmation": False,
            "confirmationRejectedForCleanup": True,
            "mutationAfterRejection": False,
            "authoritativeRecordingUnchangedBeforeConfirmation": True,
            "authoritativeRecordingUnchangedAfterRejection": True,
        },
        "observations": {"read": read_observation, "write": write_observation},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
