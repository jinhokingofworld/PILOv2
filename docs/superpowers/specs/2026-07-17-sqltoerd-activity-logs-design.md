# SQLtoERD Activity Logs Design

## 목적

SQLtoERD에서 회의록에 반영할 가치가 있는 저장 결과를 공통 `activity_logs`에 기록한다. SQLtoERD는 Meeting 또는 recording 식별자를 알지 않으며, MeetingReport가 나중에 Workspace, 녹음 시간, 당시 참여자를 기준으로 필요한 행만 조회한다.

## 기록 범위

다음 일곱 action만 추가한다.

| action | target.type | 기록 조건 |
| --- | --- | --- |
| `sql_erd_session_created` | `sql_erd_session` | 사용자 또는 Agent가 세션을 생성해 commit됨 |
| `sql_erd_schema_updated` | `sql_erd_session` | SQL source, model, dialect 중 하나 이상이 실제로 변경되어 commit됨 |
| `sql_erd_session_renamed` | `sql_erd_session` | 세션 제목이 실제로 변경되어 commit됨 |
| `sql_erd_session_deleted` | `sql_erd_session` | 세션 soft delete가 commit됨 |
| `sql_erd_note_created` | `sql_erd_note` | 비어 있지 않은 note가 생성되어 commit됨 |
| `sql_erd_note_updated` | `sql_erd_note` | 기존 note의 공백 정규화 본문이 실제로 변경되어 commit됨 |
| `sql_erd_note_deleted` | `sql_erd_note` | 비어 있지 않은 note가 삭제되어 commit됨 |

조회, polling, writer lease, presence, table/note drag 또는 resize, viewport, 색상과 같은 시각 상태 변경은 기록하지 않는다. 세션 생성 payload에 비어 있지 않은 초기 note가 포함되면 세션 생성과 같은 transaction에서 note 생성 log도 함께 기록한다.

## 트랜잭션과 재시도

모든 log는 실제 SQLtoERD 변경에 사용된 `DatabaseTransaction`을 그대로 `ActivityLogService.append`에 전달한다. log append가 실패하면 도메인 변경도 rollback된다. `activity_logs`를 직접 INSERT, UPDATE 또는 DELETE하지 않는다.

dedupe key는 `sqltoerd:<action>:<targetId>:<resultRevision>` 형식을 사용한다. note는 session 내부 중첩 entity이므로 action의 target ID는 `<sessionId>:<noteId>`, 세션 action의 target ID는 session ID다. 재시도 ledger 또는 기존 operation을 반환하는 경로에서는 새 append를 시도하지 않는다. DB unique 제약도 같은 Workspace에서 중복 행을 막는다.

일반 API 변경은 `{ type: "user", userId }`, Agent가 생성하거나 스키마를 교체한 결과는 `{ type: "agent", userId }`로 기록한다. Agent actor에도 요청 사용자의 ID를 보존해 Meeting participant 판별이 가능해야 한다.

## Metadata 계약

- 세션 생성: `{ title, dialect, tableCount, relationCount }`
- 스키마 변경: `{ title, changedFields, dialect, beforeCounts, afterCounts }`
- 이름 변경: `{ title, previousTitle }`
- 세션 삭제: `{ title, tableCount, relationCount }`
- note 생성/수정: `{ sessionId, contentSummary, truncated, contentOmitted }`
- note 삭제: `{ sessionId }`

`contentSummary`는 note text의 연속 공백을 하나로 정리하고 앞뒤 공백을 제거한 뒤 Unicode code point 경계를 보존하며 최대 500자로 자른 값이다. 원문이 500자를 넘으면 `truncated`가 true다. token, password, secret, OAuth 또는 private key 형태가 감지되면 본문을 저장하지 않고 `contentSummary`를 빈 문자열, `contentOmitted`를 true로 기록한다. 삭제 log에는 삭제 전 본문을 복사하지 않는다.

SQL source, `modelJson`, `layoutJson`, provider payload와 Meeting 관련 ID는 metadata에 저장하지 않는다. 모든 summary는 500자 이내의 한국어 과거형 사실 문장이다.

## 변경 경로

- `createSession`, `createPluralSession`, `createAgentGeneratedSession`
- snapshot `updateSession`
- `updateSessionMetadata`
- `deleteSession`
- operations_v1 `createOperation`
- `publishSourceSnapshot`, `replaceAgentGeneratedSchema`

snapshot `updateSession`은 조회, revision 검증, update, Activity Log append를 하나의 transaction으로 합친다. operations_v1 note 변경은 patch 적용 전후 layout의 note ID와 공백 정규화 text를 비교한다. source publish는 source/model/dialect의 실제 변경 여부를 비교한다.

## 검증

테스트는 중앙 TypeScript registry와 Postgres enum migration 085의 일치, metadata shape와 Unicode-safe 500자 제한, secret 생략, geometry-only 제외, 빈 note 제외, note create/update/delete 구분, user/agent actor, 재시도 중복 방지, Activity Log 실패 시 도메인 API 실패를 검증한다. App Server build, SQLtoERD 테스트, 공통 Activity Log 테스트, format check를 실행한다.
