# Activity Log Registry

Canvas shape actions (`canvas_shape_created`, `canvas_shape_updated`, and
`canvas_shape_deleted`) are emitted only by the internal Meeting Recording
capture path. They are not appended by the ordinary Canvas shape command or
checkpoint path. The path uses the authenticated Realtime actor and
`captureId`-derived dedupe key; recording identity, receive ordering, and
Realtime capture time live in `meeting_recording_activity_links`, not in
`activity_logs.metadata`.

`activity_logs`는 Meeting 전용 테이블이 아니다. 각 도메인은 실제로 commit된 의미 있는 사용자 행동만 공통 `ActivityLogService`로 같은 DB transaction 안에 append한다.

## 공통 계약

- `occurred_at`은 App Server DB default `now()`가 기록하는 **transaction 시작 시각**이다. 클라이언트 시간이나 domain event의 실제 발생 시각을 입력받지 않는다. 하나의 transaction에서 여러 row를 만들면 같은 `occurred_at`을 가질 수 있으므로 목록 조회는 반드시 `occurred_at DESC, id DESC`로 정렬한다.
- `dedupeKey`는 `<domain>:<action>:<targetId>:<stable-operation-or-version>` 형식이며 1~512자다. 재시도에도 같은 값을 사용한다.
- `metadata`는 `{ version: 1, summary, data }` object다. `summary`는 1~500자의 한국어 과거형 사실 문장이고, `data`는 action별 JSON object다.
- `actor.type`은 `user`, `agent`, `system`, `integration` 중 하나다. 신규 append에서 `user` actor는 `userId`가 필수다. 사용자 삭제 뒤에는 FK의 `ON DELETE SET NULL`로 기존 `user` actor row가 익명화될 수 있으므로 DB constraint는 그 historical row를 허용한다.
- raw transcript, 원문 파일, OAuth/provider payload, token/secret, Canvas raw shape를 `metadata`에 넣지 않는다.
- row는 append-only다. DB는 일반 `UPDATE`/`DELETE`를 차단한다. 계정 식별자 익명화(`actor_user_id -> NULL`)와 Workspace 물리 삭제 transaction의 tenant purge만 예외다.

## MeetingReport 소비 경계

`activity_logs`에는 `meetingId`나 `recordingId`를 저장하지 않는다. MeetingReport는
Workspace 일치, recording 시간 범위, 해당 시점의 participant membership을 모두
만족하는 row만 snapshot한다. Canvas action은 연결 row의 `captured_at`을 시간 기준으로
사용하고 `meeting_recording_activity_links`가 없는 row는 제외한다. raw Activity Log
row와 raw metadata는 MeetingReport 응답이나 LLM 결과 저장소에 노출하지 않는다.

## 등록된 action과 `metadata.data` 계약

이 표가 producer의 단일 계약이다. `metadata.data`는 표에 적힌 key 외 값을 넣지 않는다.
`?`는 optional이고, 표에 없는 모든 key는 필수다. optional key도 값이 있으면 `null`이
아닌 표기된 JSON type이어야 한다. `{}`는 빈 object만 허용한다. `string[]`은 비어 있지 않은
문자열 배열이고, ID는 원본 domain ID를 문자열로 넣는다. 상태 값은 action이 이미 표현하므로
별도의 `status` field를 중복 저장하지 않는다.

| action | target.type | `metadata.data` 정확한 구조 |
| --- | --- | --- |
| `workspace_created` | `workspace` | `{ name: string }` |
| `workspace_updated` | `workspace` | `{ changedFields: string[] }` |
| `workspace_archived` | `workspace` | `{}` |
| `meeting_started`, `meeting_ended` | `meeting` | `{ meetingRoomId: string }` |
| `meeting_participant_joined`, `meeting_participant_left` | `meeting_participant` | `{ meetingRoomId: string, participantUserId: string }` |
| `meeting_recording_started`, `meeting_recording_completed`, `meeting_recording_failed` | `meeting_recording` | `{ meetingId: string }` |
| `meeting_report_completed`, `meeting_report_failed` | `meeting_report` | `{ meetingId: string }` |
| `pr_review_session_created`, `pr_review_session_submitted` | `pr_review_session` | `{ pullRequestId: string }` |
| `pr_review_session_updated` | `pr_review_session` | `{ pullRequestId: string, changedFields: string[] }` |
| `file_review_decision_created` | `file_review_decision` | `{ reviewSessionId: string, reviewFileId: string, filePath: string, decision: string }` |
| `review_submission_created`, `review_submission_submitted`, `review_submission_failed` | `review_submission` | `{ reviewSessionId: string }` |
| `pr_review_conflict_resolution_applied` | `pull_request` | `{ reviewSessionId: string, resolvedFileCount: number, headShaAfter: string, commitSha: string, conflictStatusAfter: string }` |
| `pr_review_pull_request_merged` | `pull_request` | `{ reviewSessionId: string, mergeMethod: string, mergeCommitSha: string }` |
| `github_sync_started`, `github_sync_succeeded`, `github_sync_failed` | `github_sync_run` | `{ target: string }` |
| `github_repository_synced` | `github_repository` | `{ providerId: string, syncRunId: string }` |
| `github_issue_synced` | `github_issue` | `{ providerId: string, syncRunId: string }` |
| `github_project_v2_synced` | `github_project_v2` | `{ providerId: string, syncRunId: string }` |
| `canvas_created` | `canvas` | `{}` |
| `canvas_updated` | `canvas` | `{ changedFields: string[] }` |
| `canvas_user_entered`, `canvas_user_left` | `canvas_presence` | `{ canvasId: string }` |
| `canvas_shape_created`, `canvas_shape_deleted` | `canvas_shape` | `{ canvasId: string, shapeType: string, title?: string, textPreview?: string, language?: string }` |
| `canvas_shape_updated` | `canvas_shape` | `{ canvasId: string, shapeType: string, changedFields: string[], title?: string, textPreview?: string, language?: string }` |
| `board_created` | `board` | `{}` |
| `board_updated` | `board` | `{ changedFields: string[] }` |
| `pilo_issue_created`, `pilo_issue_deleted` | `pilo_issue` | `{ boardId: string }` |
| `pilo_issue_updated` | `pilo_issue` | `{ boardId: string, changedFields: string[] }` |
| `pilo_issue_moved` | `pilo_issue` | `{ boardId: string, from?: string, to: string }` |
| `calendar_event_created`, `calendar_event_deleted` | `calendar_event` | `{ title: string }` |
| `calendar_event_updated` | `calendar_event` | `{ title: string, changedFields: string[], before: object, after: object }` |
| `document_created` | `document` | `{ title: string, source: "blank", parentId?: string }` |
| `document_content_updated` | `document` | `{ version: number }` |
| `document_renamed` | `document` | `{ title: string, previousTitle: string }` |
| `document_moved` | `document` | `{ fromParentId?: string, toParentId?: string }` |
| `document_attachment_updated` | `document` | `{ driveItemId: string, operation: "attached" \| "detached", version: number }` |
| `document_deleted` | `document` | `{}` |
| `sql_erd_session_created` | `sql_erd_session` | `{ title: string, dialect: string, tableCount: number, relationCount: number }` |
| `sql_erd_schema_updated` | `sql_erd_session` | `{ title: string, changedFields: string[], dialect: string, beforeCounts: { tableCount: number, relationCount: number }, afterCounts: { tableCount: number, relationCount: number } }` |
| `sql_erd_session_renamed` | `sql_erd_session` | `{ title: string, previousTitle: string }` |
| `sql_erd_session_deleted` | `sql_erd_session` | `{ title: string, tableCount: number, relationCount: number }` |
| `sql_erd_note_created`, `sql_erd_note_updated` | `sql_erd_note` | `{ sessionId: string, contentSummary: string, truncated: boolean, contentOmitted: boolean }` |
| `sql_erd_note_deleted` | `sql_erd_note` | `{ sessionId: string }` |

`before`와 `after`는 변경된 field만 포함하는 bounded JSON object다. Calendar event의
description 전문, Meeting transcript, Canvas raw shape처럼 원문 또는 provider payload가 될 수
있는 값은 이 object에 넣지 않는다.

문서 action의 `title`, `previousTitle`은 최대 160자까지 저장한다. `document_content_updated`
에는 문서 본문, 블록 JSON, Yjs update, 변경 전후 diff를 저장하지 않으며 저장이 확정된
문서 버전만 기록한다. `document_attachment_updated`에는 연결된 Drive item ID, 연결/해제
사실과 해당 저장본의 version만 저장하고, 첨부 파일의 원문이나 S3 object key를 넣지 않는다.

`file_review_decision_created`의 `filePath`는 repo-relative path의 연속 whitespace를 단일 공백으로
정규화해 한 줄 최대 400자까지 저장한다. 400자를 넘으면 파일명을 포함한 suffix를 보존하고 앞부분을
`…`로 줄인다. 같은 bounded path를 `summary`에도 포함해 MeetingReport가 raw metadata 조회 없이
파일을 식별하게 하며, file decision comment나 diff 원문은 저장하지 않는다.

SQLtoERD action의 `title`, `previousTitle`은 공백을 정리한 최대 160자다. note의
`contentSummary`는 공백을 정리하고 Unicode code point 경계를 보존한 최대 500자이며
원문이 더 길면 `truncated`가 `true`다. note는 session 내부 중첩 entity이므로
`target.id`와 dedupe target 구간은 `<sessionId>:<noteId>`로 구성한다.
token, password, secret, OAuth 또는 private key 형태가 감지되면 `contentSummary`는 빈
문자열이고 `contentOmitted`가 `true`다. note 삭제에는 삭제 전 본문을 저장하지 않는다.
SQL source, model/layout JSON, writer lease, Meeting/recording ID도 SQLtoERD metadata에 넣지
않는다. note 본문은 같은 공백 정규화 결과끼리 비교하므로 공백만 바꾼 수정은 기록하지
않는다. note 위치·크기, viewport, 조회, polling과 재시도 반환도 기록하지 않는다.

## 새 action 추가 절차

새 action이 필요하면 임의 문자열을 사용하지 않는다. 다음을 포함해 Activity Log foundation 담당자와 DB Schema 담당자에게 요청한다.

1. 제안 `action`과 `target.type`
2. 기록할 commit 결과와 회의록에 필요한 이유
3. 위 표에 추가할 `metadata.data`의 필수/optional key, JSON type, null 허용 여부와 `summary` 예시
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
