# Agent MVP Smoke

## Scope

This document records the Agent MVP smoke scope for issue #480.

The smoke target is the connected flow across:

- App Server Agent run API, job enqueue, tool execution, and confirmation.
- AI Worker `agent_run_requested` planning.
- Frontend Agent chat polling and confirmation UI.
- Calendar and MeetingReport tools currently registered in the App Server Agent registry.

This is not a new product scope document. API contract remains `docs/api/agent-api.md`.

## Automated Smoke Coverage

The following checks are part of the automated regression surface:

- App Server Agent run API: `apps/app-server/scripts/agent/run-api.test.mjs`
- App Server Agent job enqueue: `apps/app-server/scripts/agent/agent-job.test.mjs`
- App Server planner boundary: `apps/app-server/scripts/agent/planner.test.mjs`
- App Server execution runtime and MVP smoke matrix: `apps/app-server/scripts/agent/execution.test.mjs`
- App Server confirmation approve/reject: `apps/app-server/scripts/agent/confirmation.test.mjs`
- Calendar Agent tools: `apps/app-server/scripts/agent/calendar-tools.test.mjs`
- MeetingReport Agent tools: `apps/app-server/scripts/agent/meeting-tools.test.mjs`
- AI Worker Agent dispatcher/planner: `apps/ai-worker/tests/test_agent_processor.py`
- AI Worker job dispatch: `apps/ai-worker/tests/test_job_dispatcher.py`
- Frontend Agent chat/confirmation: `apps/frontend/src/features/agent/agent-feature.test.mjs`

`apps/app-server/scripts/agent/execution.test.mjs` now includes the MVP smoke matrix:

- Calendar read-only tool candidate executes automatically and completes the run.
- Calendar create tool candidate stops at pending confirmation.
- MeetingReport summary executes without persisting transcript text in Agent output summary.
- Board tools are not registered yet and fail safely as not executable.

## Manual Smoke Checklist

Run these against an environment with App Server, AI Worker, frontend, database, SQS, and provider credentials wired.

| Prompt / Action | Expected Result |
| --- | --- |
| `이번 주 일정 보여줘` | Agent run reaches `completed` through `list_calendar_events`. |
| `내일 오후 3시에 주간 회의 일정 만들어줘` | Agent run reaches `waiting_confirmation` with a Calendar create plan. |
| Approve the Calendar create confirmation | Calendar event is created and the Agent run reaches `completed`. |
| Reject the Calendar create confirmation | Calendar event is not created and the Agent run reaches `cancelled`. |
| `최근 회의록 요약해줘` | MeetingReport summary is returned without transcript text exposure. |
| Request another user's run or inaccessible workspace | Request fails safely with `403` or equivalent safe failure. |
| Simulate worker/provider failure | Run reaches `failed` with a safe user-facing message and no raw provider error. |

## Board Tool Status

Board issue search and Board status move remain outside the #480 required smoke because the App Server Agent registry currently registers Calendar and MeetingReport tools only.

Required follow-up before making Board smoke mandatory:

- Add Board Agent tool adapters to the App Server registry.
- Cover `search_board_issues` as a read-only auto tool.
- Cover `move_board_issue_status` as a confirmation-required write tool.
- Verify GitHub OAuth/provider failure is surfaced as a safe Agent failure.

Until then, Board prompts should not be treated as #480 blockers. They should fail safely as unregistered tools.
