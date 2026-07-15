# SQLtoERD operations_v1 cutover

이 runbook은 기존 SQLtoERD `snapshot` session을 전환하지 않고 물리 삭제한 뒤, 새 session만 `operations_v1`을 사용하도록 전환하는 일회성 운영 절차다. 이 문서는 migration이나 App Server startup에서 자동 실행되지 않는다.

## 책임과 사전 조건

- SQLtoERD 담당자는 신규 session, source lock, operation API의 두 브라우저 E2E를 완료한다.
- Infra/Realtime 담당자는 App Server에 `SQL_ERD_OPERATIONS_V1_ENABLED=true`를 배포하고 Realtime 연결을 확인한다.
- DB Schema 담당자는 export 보관 위치와 physical delete 실행을 승인한다.
- `061_create_sql_erd_operation_delivery.sql`, `063_create_sql_erd_source_snapshots_and_locks.sql`, `069_create_sql_erd_session_creation_audit.sql`이 대상 DB에 적용되어 있어야 한다.
- export artifact, manifest, 복호화 key는 Git, PR, issue, application log에 남기지 않는다.

## 전환 순서

1. staging에서 동일 Workspace member 두 명으로 operation, duplicate event, sequence gap/reconnect, source lock renew/publish를 확인한다.
2. maintenance window를 공지하고 기존 SQLtoERD 탭을 종료하도록 안내한다.
3. App Server를 `SQL_ERD_OPERATIONS_V1_ENABLED=true`로 배포한다. 이 flag는 **신규 session 생성 시** protocol만 고르며, 기존 row를 변경하지 않는다.
4. 아래 대상 SQL로 활성 snapshot session 목록을 export한다. 대상은 반드시 `write_protocol = 'snapshot' AND deleted_at IS NULL`이다.
5. export를 `age`로 암호화해 별도 접근 제한 bucket 또는 vault에 올리고, manifest를 생성·검증한다.
6. manifest의 session ID 목록을 [삭제 SQL](../../db/operations/sqltoerd-operations-v1-delete-snapshot-sessions.sql)에 넣고 maintenance window에서 실행한다.
7. postflight SQL과 신규 operations_v1 session API·Realtime smoke test를 수행한다.
8. export와 manifest는 정확히 7일간 보관하고, 기간 종료 뒤 함께 영구 삭제한 사실을 운영 기록에 남긴다.

## export와 manifest

먼저 Supabase SQL Editor 또는 `psql`에서 다음 조회를 실행해 행 수와 session ID 목록을 기록한다. ID는 manifest와 삭제 SQL에서 같은 정렬 순서를 사용한다.

```sql
SELECT to_jsonb(session) AS session
FROM public.sql_erd_sessions AS session
WHERE write_protocol = 'snapshot'
  AND deleted_at IS NULL
ORDER BY id;
```

결과를 JSON/NDJSON 또는 CSV로 export한다. export 파일은 로컬 임시 경로에서 바로 암호화한다. 예를 들어 organization의 `age` recipient를 사용한다.

```powershell
age -r $env:PILO_CUTOVER_AGE_RECIPIENT -o snapshot-sessions.ndjson.age snapshot-sessions.ndjson
Get-FileHash snapshot-sessions.ndjson.age -Algorithm SHA256
```

암호화 artifact를 별도 restricted bucket 또는 vault에 업로드한 뒤, 업로드 완료와 접근 제어가 실제로 제한됐는지를 운영자가 확인한다. manifest validator는 artifact의 `age` raw header·checksum·URI 형식만 확인하며 bucket policy나 vault ACL을 대신 검증하지 않는다.

암호화 artifact와 별도로 보관하는 manifest 예시는 다음과 같다. `storageLocation`에는 credential이 아닌 bucket/vault 경로만 기록한다.

```json
{
  "version": 1,
  "createdAt": "2026-07-15T09:00:00.000Z",
  "scope": {
    "activeSessionPredicate": "write_protocol = 'snapshot' AND deleted_at IS NULL",
    "rowCount": 2,
    "sessionIds": [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222"
    ]
  },
  "artifact": {
    "fileName": "snapshot-sessions.ndjson.age",
    "encryption": "age",
    "sha256": "<encrypted artifact SHA-256>"
  },
  "storageLocation": "s3://restricted-cutover-bucket/sqltoerd/<cutover-date>/",
  "retention": {
    "deleteAfter": "2026-07-22T09:00:00.000Z"
  }
}
```

암호화된 artifact와 manifest가 같은 local directory에 있을 때 다음을 실행한다. 이 검증은 checksum, 활성 snapshot predicate, 행 수와 session ID 수, UUID 중복, `age` metadata, storage location, 정확히 7일 보존 기간을 확인한다.

```powershell
node apps/app-server/scripts/sqltoerd/operations-v1-cutover-manifest.mjs `
  --manifest .\cutover-manifest.json `
  --artifact .\snapshot-sessions.ndjson.age
```

manifest 검증이 실패하면 삭제 SQL을 실행하지 않는다.

## physical delete

`db/operations/sqltoerd-operations-v1-delete-snapshot-sessions.sql`을 Supabase SQL Editor에서 열고, `expected_session_ids`를 manifest의 전체 ID 목록으로 교체한다. 이 SQL은 transaction과 `SHARE ROW EXCLUSIVE` table lock 안에서 현재 활성 snapshot ID 목록을 다시 비교한다. export 이후 새 snapshot이 생기거나 대상이 달라지면 exception으로 rollback하며 삭제하지 않는다.

삭제 대상은 active snapshot session뿐이다. `operations_v1` session, soft-deleted session, title/metadata는 이 SQL의 대상이 아니다. session child row는 선언된 FK cascade를 사용하며, source snapshot operation의 `ON DELETE RESTRICT` 규칙을 우회하거나 constraint를 끄지 않는다. `deleted_snapshot_session_count`와 `deleted_session_ids` 결과는 manifest와 대조한 뒤 운영 기록에 남긴다.

## postflight

physical delete 이후 아래 SQL을 실행한다. 첫 다섯 query는 모두 `0`이어야 한다. 마지막 두 query는 새 session을 만든 뒤 `operations_v1` 생성과 cutover 이후 snapshot 생성 부재를 확인한다.

```sql
SELECT count(*)::INTEGER AS active_snapshot_sessions
FROM public.sql_erd_sessions
WHERE write_protocol = 'snapshot'
  AND deleted_at IS NULL;

SELECT count(*)::INTEGER AS operation_rows_without_session
FROM public.sql_erd_session_operations operation
LEFT JOIN public.sql_erd_sessions session ON session.id = operation.session_id
WHERE session.id IS NULL;

SELECT count(*)::INTEGER AS outbox_rows_without_operation
FROM public.sql_erd_session_operation_outbox outbox
LEFT JOIN public.sql_erd_session_operations operation ON operation.id = outbox.operation_id
WHERE operation.id IS NULL;
SELECT count(*)::INTEGER AS source_snapshot_rows_without_session
FROM public.sql_erd_session_source_snapshots snapshot
LEFT JOIN public.sql_erd_sessions session ON session.id = snapshot.session_id
WHERE session.id IS NULL;

SELECT count(*)::INTEGER AS source_lock_rows_without_session
FROM public.sql_erd_session_source_locks source_lock
LEFT JOIN public.sql_erd_sessions session ON session.id = source_lock.session_id
WHERE session.id IS NULL;

SELECT count(*)::INTEGER AS active_operations_v1_sessions
FROM public.sql_erd_sessions
WHERE write_protocol = 'operations_v1'
  AND deleted_at IS NULL;

SELECT id, session_id, workspace_id, write_protocol, session_created_at
FROM public.sql_erd_session_creation_audit
WHERE session_created_at >= '<cutover-started-at>'::timestamptz
  AND write_protocol = 'snapshot'
ORDER BY session_created_at DESC;
```

신규 session 하나를 만든 뒤 session detail의 `writeProtocol: "operations_v1"`, `revision: 1`, `latestOpSeq: 0`을 확인한다. 이어서 두 browser에서 table/annotation operation, reconnect catch-up, source lock을 확인한다. legacy full PATCH는 `409 SQL_ERD_WRITE_PROTOCOL_MISMATCH`여야 한다.

## 보존 기간 종료

manifest의 `retention.deleteAfter` 이전에는 export를 삭제하지 않는다. 종료 시 암호화 artifact와 manifest를 함께 삭제하고, 삭제 시각·담당자·artifact checksum만 운영 기록에 남긴다. SQL 원문, session ID 목록, bucket credential, 복호화 key는 issue나 application log에 기록하지 않는다.
