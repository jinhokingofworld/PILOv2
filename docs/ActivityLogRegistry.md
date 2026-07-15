# Activity Log Registry

`activity_logs`는 Meeting 전용 테이블이 아니다. 각 도메인은 실제로 commit된 의미 있는 사용자 행동만 공통 `ActivityLogService`로 같은 DB transaction 안에 append한다.

## 공통 계약

- `occurred_at`은 App Server DB default가 기록한다. 클라이언트 시간, `meetingId`, `recordingId`를 입력받지 않는다.
- `dedupeKey`는 `<domain>:<action>:<targetId>:<stable-operation-or-version>` 형식이며 1~512자다. 재시도에도 같은 값을 사용한다.
- `metadata`는 `{ version: 1, summary, data }` object다. `summary`는 1~500자의 한국어 과거형 사실 문장이고, `data`는 action별 JSON object다.
- `actor.type`은 `user`, `agent`, `system`, `integration` 중 하나다. `user` actor는 `userId`가 필수다. 다른 actor도 사용자 요청의 귀속이 필요할 때만 `userId`를 넣을 수 있다.
- raw transcript, 원문 파일, OAuth/provider payload, token/secret, Canvas raw shape를 `metadata`에 넣지 않는다.
- row는 append-only다. DB는 일반 `UPDATE`/`DELETE`를 차단한다. 계정 식별자 익명화(`actor_user_id -> NULL`)와 Workspace 물리 삭제 transaction의 tenant purge만 예외다.

## 등록된 action

| Domain | action | target.type | `metadata.data` 필수/권장 값 | `dedupeKey` 예시 | `summary` 예시 |
| --- | --- | --- | --- | --- | --- |
| Workspace | `workspace_created`, `workspace_updated`, `workspace_archived` | `workspace` | `name`, `changedFields` | `workspace:workspace_updated:{workspaceId}:{updatedAt}` | Workspace 이름을 변경했습니다. |
| Meeting | `meeting_started`, `meeting_ended`, `meeting_participant_joined`, `meeting_participant_left` | `meeting` 또는 `meeting_participant` | `meetingRoomId`, `participantUserId` | `meeting:meeting_participant_joined:{participantId}:{joinedAt}` | 음성 회의에 참여했습니다. |
| Meeting | `meeting_recording_started`, `meeting_recording_completed`, `meeting_recording_failed` | `meeting_recording` | `meetingId`, `status` | `meeting:meeting_recording_completed:{recordingId}:{statusVersion}` | 회의 녹음을 완료했습니다. |
| Meeting | `meeting_report_completed`, `meeting_report_failed` | `meeting_report` | `meetingId`, `status` | `meeting:meeting_report_completed:{reportId}:{statusVersion}` | 회의록 생성을 완료했습니다. |
| PR Review | `pr_review_session_created`, `pr_review_session_updated`, `pr_review_session_submitted` | `pr_review_session` | `pullRequestId`, `changedFields` | `pr_review:pr_review_session_updated:{sessionId}:{version}` | PR 리뷰 세션을 수정했습니다. |
| PR Review | `file_review_decision_created` | `file_review_decision` | `reviewSessionId`, `decision` | `pr_review:file_review_decision_created:{decisionId}:{version}` | 파일 리뷰 결정을 등록했습니다. |
| PR Review | `review_submission_created`, `review_submission_submitted`, `review_submission_failed` | `review_submission` | `reviewSessionId`, `status` | `pr_review:review_submission_submitted:{submissionId}:{version}` | 리뷰를 제출했습니다. |
| GitHub | `github_sync_started`, `github_sync_succeeded`, `github_sync_failed` | `github_sync_run` | `target`, `status` | `github:github_sync_succeeded:{syncRunId}:{attempt}` | GitHub 동기화를 완료했습니다. |
| GitHub | `github_repository_synced`, `github_issue_synced`, `github_project_v2_synced` | `github_repository`, `github_issue`, `github_project_v2` | `providerId`, `syncRunId` | `github:github_issue_synced:{issueId}:{syncRunId}` | GitHub Issue를 동기화했습니다. |
| Canvas | `canvas_created`, `canvas_updated` | `canvas` | `changedFields` | `canvas:canvas_updated:{canvasId}:{version}` | Canvas 이름을 수정했습니다. |
| Canvas | `canvas_user_entered`, `canvas_user_left` | `canvas_presence` | `canvasId` | `canvas:canvas_user_entered:{canvasId}:{operationId}` | Canvas에 입장했습니다. |
| Canvas | `canvas_shape_created`, `canvas_shape_updated`, `canvas_shape_deleted` | `canvas_shape` | `canvasId`, `shapeType`, `changedFields` when updated | `canvas:canvas_shape_updated:{shapeId}:{operationId}` | Canvas 노트의 내용을 수정했습니다. |
| Board | `board_created`, `board_updated` | `board` | `changedFields` | `board:board_updated:{boardId}:{version}` | 보드 이름을 수정했습니다. |
| Board | `pilo_issue_created`, `pilo_issue_updated`, `pilo_issue_moved`, `pilo_issue_deleted` | `pilo_issue` | `boardId`, `changedFields`, `from`/`to` when moved | `board:pilo_issue_moved:{issueId}:{version}` | Issue 상태를 변경했습니다. |
| Calendar | `calendar_event_created`, `calendar_event_updated`, `calendar_event_deleted` | `calendar_event` | `title`, `changedFields`, `before`/`after` when updated | `calendar:calendar_event_updated:{eventId}:{version}` | 디자인 리뷰 일정을 변경했습니다. |

## 새 action 추가 절차

새 action이 필요하면 임의 문자열을 사용하지 않는다. 다음을 포함해 Activity Log foundation 담당자와 DB Schema 담당자에게 요청한다.

1. 제안 `action`과 `target.type`
2. 기록할 commit 결과와 회의록에 필요한 이유
3. `metadata.data` JSON object 구조와 `summary` 예시
4. 재시도에도 변하지 않는 `dedupeKey` 생성 방식

승인 뒤에는 App Server registry, Postgres `activity_log_action` enum migration, 이 문서, 도메인 테스트를 함께 갱신한다.

## 도메인 팀 전달 프롬프트

당신의 도메인에서 회의록에 반영할 가치가 있는 실제 commit 결과를 공통 `ActivityLogService`로 기록하세요.

1. `activity_logs`에 직접 SQL INSERT하지 말고 `activityLogService.append(transaction, input)`만 사용합니다.
2. 도메인 상태 변경과 같은 DB transaction에 append합니다. rollback되면 log도 남으면 안 됩니다.
3. `meetingId`, `recordingId`, 클라이언트 발생 시각을 전달하거나 저장하지 않습니다.
4. `dedupeKey`는 재시도에도 같아야 합니다. 새 UUID나 요청마다 달라지는 값은 사용하지 않습니다.
5. `metadata.summary`는 실제 완료된 결과를 설명하는 1~500자 한국어 과거형 문장입니다. `metadata.data`는 action별 JSON object로 최소 정보만 보냅니다.
6. token, OAuth/provider raw payload, 원문 파일, transcript, Canvas raw shape와 polling/presence/drag·resize 같은 노이즈는 기록하지 않습니다.
7. 기존 log를 UPDATE/DELETE하지 않습니다. Workspace 삭제와 계정 익명화는 foundation 예외 경로가 처리합니다.

```ts
await activityLogService.append(transaction, {
  workspaceId,
  actor: { type: "user", userId: currentUserId },
  action: "calendar_event_updated",
  target: { type: "calendar_event", id: event.id },
  dedupeKey: `calendar:calendar_event_updated:${event.id}:${event.version}`,
  metadata: {
    version: 1,
    summary: "디자인 리뷰 일정을 변경했습니다.",
    data: { changedFields: ["startAt", "endAt"] }
  }
});
```

## 새 action 제안 양식

```text
- 제안 action:
- target.type:
- 기록할 commit 결과:
- 회의록에 필요한 이유:
- metadata.data JSON 구조:
- dedupeKey 생성 방식:
- summary 예시:
```
