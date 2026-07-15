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
6. manifest의 `sessionVersions` 목록을 [삭제 SQL](../../db/operations/sqltoerd-operations-v1-delete-snapshot-sessions.sql)에 넣고 maintenance window에서 실행한다.
7. postflight SQL과 신규 operations_v1 session API·Realtime smoke test를 수행한다.
8. export와 manifest는 physical delete 성공 시점부터 최소 7일간 보관하고, 기간 종료 뒤 함께 영구 삭제한 사실을 운영 기록에 남긴다.

## export와 manifest

먼저 `psql`에서 다음 조회를 실행해 전체 row, 행 수, session ID, revision, updated_at을 기록한다. ID와 `sessionVersions`는 manifest와 삭제 SQL에서 같은 정렬 순서를 사용한다.

```sql
SELECT to_jsonb(session)
FROM public.sql_erd_sessions AS session
WHERE write_protocol = 'snapshot'
  AND deleted_at IS NULL
ORDER BY id;
```

Supabase SQL Editor의 CSV/JSON download는 wrapper를 추가할 수 있으므로 그대로 사용하지 않는다. 표준 PostgreSQL 접속 환경 변수(`PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`)와 `PGCLIENTENCODING=UTF8`을 안전한 운영 shell에 설정한 뒤, 다음 명령으로 header 없는 raw UTF-8 NDJSON을 만든다.

```powershell
$env:PGCLIENTENCODING = "UTF8"
psql --no-align --tuples-only --output snapshot-sessions.ndjson `
  --command "SELECT to_jsonb(session)::text FROM public.sql_erd_sessions AS session WHERE write_protocol = 'snapshot' AND deleted_at IS NULL ORDER BY id;"
```

결과는 UTF-8 NDJSON(`sql_erd_sessions_ndjson_v1`)이며 한 줄에 `sql_erd_sessions` 전체 row 하나를 기록한다. 이 format은 현재 table의 전체 column을 요구하므로 일부 필드만 추출한 파일이나 CSV/JSON wrapper가 있는 파일은 recovery 검증에서 거부된다. export 파일은 로컬 임시 경로에서 바로 암호화한다. 예를 들어 organization의 `age` recipient를 사용한다.

```powershell
age -r $env:PILO_CUTOVER_AGE_RECIPIENT -o snapshot-sessions.ndjson.age snapshot-sessions.ndjson
$ageExitCode = $LASTEXITCODE
Remove-Item -LiteralPath .\snapshot-sessions.ndjson -Force -ErrorAction SilentlyContinue
if ($ageExitCode -ne 0) { throw "age encryption failed" }
Get-FileHash snapshot-sessions.ndjson.age -Algorithm SHA256
```

암호화 artifact를 별도 restricted bucket 또는 vault에 업로드한 뒤, 업로드 완료와 접근 제어가 실제로 제한됐는지를 운영자가 확인한다. manifest validator는 정적 metadata 검사를 제공하고, 위의 recovery 명령은 실제 `age` identity로 복호화한 export의 복구 가능성과 manifest 대조까지 수행한다. bucket policy나 vault ACL 자체는 대신 검증하지 않는다.

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
    ],
    "sessionVersions": [
      {
        "sessionId": "11111111-1111-4111-8111-111111111111",
        "revision": 4,
        "updatedAt": "2026-07-15T08:55:00.000Z"
      },
      {
        "sessionId": "22222222-2222-4222-8222-222222222222",
        "revision": 7,
        "updatedAt": "2026-07-15T08:58:00.000Z"
      }
    ]
  },
  "artifact": {
    "fileName": "snapshot-sessions.ndjson.age",
    "encryption": "age",
    "exportFormat": "sql_erd_sessions_ndjson_v1",
    "sha256": "<encrypted artifact SHA-256>"
  },
  "storageLocation": "s3://restricted-cutover-bucket/sqltoerd/<cutover-date>/",
  "retention": {
    "deleteAfter": "2026-07-23T09:00:00.000Z"
  }
}
```

암호화된 artifact와 manifest가 같은 local directory에 있을 때 다음을 실행한다. 이 검증은 checksum, 활성 snapshot predicate, 행 수와 session ID 수, UUID 중복, 각 row의 revision·updated_at, `age` metadata, storage location, 검증 시점부터 최소 7일의 남은 보존 기간을 확인한다.

```powershell
node apps/app-server/scripts/sqltoerd/operations-v1-cutover-manifest.mjs `
  --manifest .\cutover-manifest.json `
  --artifact .\snapshot-sessions.ndjson.age `
  --identity $env:PILO_CUTOVER_AGE_IDENTITY
```

명령의 성공 출력은 `recoveryVerified`, 복구 행 수, artifact checksum, 보존 종료 시각만 포함하며 session ID와 평문 내용은 출력하지 않는다. 실제 `age` 복호화 또는 전체 row 대조가 실패하면 삭제 SQL을 실행하지 않는다.

## 복구 리허설과 복원 절차

physical delete 전에는 production과 같은 migration이 적용된 격리 staging database에서 [복원 SQL](../../db/operations/sqltoerd-operations-v1-restore-snapshot-sessions.sql)을 최소 한 번 실행한다. 이 검증은 validator가 확인한 암호문을 실제 `age` identity로 다시 복호화한 평문 NDJSON을 사용해야 한다. 복원 SQL은 `psql` 전용이며 table owner 권한이 필요하다. SQL 안의 `C:/secure-temp/snapshot-sessions.ndjson` 경로를 격리된 임시 평문 경로로 교체한 뒤 실행한다.

```powershell
$plainExport = "C:\secure-temp\snapshot-sessions.ndjson"
try {
  age --decrypt --identity $env:PILO_CUTOVER_AGE_IDENTITY `
    --output $plainExport .\snapshot-sessions.ndjson.age
  if ($LASTEXITCODE -ne 0) { throw "age decryption failed" }

  # 복원 SQL의 \copy 경로를 $plainExport와 같게 설정한 뒤 실행한다.
  psql --file db/operations/sqltoerd-operations-v1-restore-snapshot-sessions.sql
  if ($LASTEXITCODE -ne 0) { throw "snapshot restore failed" }
} finally {
  Remove-Item -LiteralPath $plainExport -Force -ErrorAction SilentlyContinue
}
```

복원 SQL은 transaction 안에서 creation-audit INSERT trigger만 일시적으로 비활성화한다. FK와 constraint trigger는 비활성화하지 않는다. physical delete 뒤에도 남아 있는 동일 session의 audit row가 workspace·protocol·createdAt과 일치하면 그대로 보존하고, migration 069 이전 session처럼 audit row가 없을 때만 새 row를 만든다. 기존 session ID가 이미 존재하거나 audit metadata가 다르면 전체 transaction을 rollback한다.

복원 대상 Workspace에 cutover 이후 생성된 session이 있으면 자동으로 삭제하거나 덮어쓰지 않는다. DB constraint와 현재 운영 정책을 확인하고 별도의 승인된 장애 복구 절차로 충돌 session을 먼저 정리한다. 이 복원 도구는 일반 rollback이나 사용자 셀프서비스용 API가 아니다. 리허설 결과에는 복원 행 수, schema/migration 버전, 담당자, artifact checksum만 기록하고 SQL 원문·session ID·평문 경로는 남기지 않는다.

## physical delete

`db/operations/sqltoerd-operations-v1-delete-snapshot-sessions.sql`을 Supabase SQL Editor에서 열고, `expected_session_versions`를 manifest의 전체 `sessionVersions` 배열로, `expected_delete_after`를 `retention.deleteAfter`로 교체한다. 이 SQL은 transaction과 `SHARE ROW EXCLUSIVE` table lock 안에서 현재 활성 snapshot의 ID·revision·updated_at을 다시 비교한다. export 이후 새 snapshot이 생기거나 기존 session의 source·layout·title 등이 저장되어 revision 또는 updated_at이 달라지면 exception으로 rollback하며 삭제하지 않는다.

삭제 대상은 active snapshot session뿐이며 `operations_v1` session과 soft-deleted session은 대상이 아니다. active snapshot session의 전체 row가 삭제되므로 title·settings를 포함한 session metadata도 함께 삭제된다. session child row는 선언된 FK cascade를 사용하며, source snapshot operation의 `ON DELETE RESTRICT` 규칙을 우회하거나 constraint를 끄지 않는다. `deleted_snapshot_session_count`와 `deleted_session_ids` 결과는 manifest와 대조한 뒤 운영 기록에 남긴다.

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

manifest의 `retention.deleteAfter`는 physical delete 성공 시점부터 최소 7일 뒤여야 하며, 그 이전에는 export를 삭제하지 않는다. 종료 시 암호화 artifact와 manifest를 함께 삭제하고, 삭제 시각·담당자·artifact checksum만 운영 기록에 남긴다. SQL 원문, session ID 목록, bucket credential, 복호화 key는 issue나 application log에 기록하지 않는다.
