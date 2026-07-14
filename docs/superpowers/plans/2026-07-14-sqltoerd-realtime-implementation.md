# SQLtoERD realtime 구현 계획

> **실행 방식:** #771의 후속 구현은 아래 **4개 Issue·4개 PR**로만 진행한다. 각 Issue 내부의 frontend·app-server·realtime-server·문서 변경은 하나의 사용자 흐름을 완성하는 범위에서 함께 처리한다.

**목표:** 같은 SQLtoERD session에서 presence를 먼저 제공하고, 이어서 table·annotation operation과 SQL source lease lock을 안전하게 동기화한다.

**아키텍처:** App Server가 영속 mutation의 유일한 진입점이다. session 변경·operation log·outbox intent는 하나의 DB transaction으로 저장한다. commit 뒤 outbox publisher가 Redis에 전달하고 realtime-server는 room에 broadcast한다. browser는 socket event와 10초 REST catch-up을 `opSeq` 순서로 적용한다.

**기술 스택:** NestJS App Server, PostgreSQL, Socket.IO realtime-server, Redis pub/sub, Next.js/React, tldraw surface

---

## 전역 구현 제약

- Canvas room과 `canvas` 테이블 access service를 SQLtoERD에 재사용하지 않는다. 인증/Socket lifecycle만 참고하고 `sql_erd_sessions` 전용 access service를 만든다.
- client는 socket으로 영속 mutation을 emit하지 않는다.
- `layout_patch`는 전체 `layoutJson` 대체가 아니라 명령형 patch다. 모든 병합은 함수형 최신 상태 update에서 수행한다.
- realtime 활성 session의 plural·singular full `PATCH`는 server가 `409 SQL_ERD_REALTIME_OPERATION_REQUIRED`로 막는다. compatibility PATCH는 realtime 비활성 session에만 허용한다.
- source lease가 살아 있는 동안에는 holder를 포함한 모든 `layout_patch`를 server가 `409 SQL_ERD_SOURCE_LOCK_ACTIVE`로 막는다. source snapshot은 전체 `layoutJson`을 받지 않는다.
- API·migration 변경 PR은 `docs/api/sqltoerd-api.md`와 함께 수정하고 SQLtoERD·DB Schema·Infra/Realtime 리뷰를 받는다.

## 작업 1: SQLtoERD room·presence

**Issue/PR:** `feat(sqltoerd,realtime): SQLtoERD session room과 presence 추가`

**예상 파일:**

- Create: `apps/realtime-server/src/sql-erd/sql-erd-types.ts`
- Create: `apps/realtime-server/src/sql-erd/sql-erd-access.service.ts`
- Create: `apps/realtime-server/src/sql-erd/sql-erd-room.service.ts`
- Create: `apps/realtime-server/src/sql-erd/sql-erd-socket-events.ts`
- Create: `apps/realtime-server/src/sql-erd/sql-erd-presence.service.ts`
- Modify: `apps/realtime-server/src/socket/room-names.ts`
- Modify: `apps/realtime-server/src/socket/socket-server.ts`
- Create: `apps/frontend/src/features/sql-erd/realtime/use-sql-erd-realtime.ts`
- Create: `apps/frontend/src/features/sql-erd/realtime/SqlErdRealtimeBridge.tsx`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-canvas.tsx`

**테스트를 먼저 작성한다.**

```ts
it("같은 Workspace의 활성 SQLtoERD session에만 join시킨다", async () => {
  await expect(join({ workspaceId, sessionId, userId })).resolves.toMatchObject({
    roomName: `workspace:${workspaceId}:sql-erd:${sessionId}`,
  });
  await expect(join({ workspaceId: otherWorkspaceId, sessionId, userId }))
    .rejects.toMatchObject({ code: "SQL_ERD_ACCESS_DENIED" });
});

it("원격 selection은 local selection과 one-shot placement 상태를 바꾸지 않는다", () => {
  receivePresence({ userId: otherUserId, selectionIds: ["table:users"] });

  expect(getLocalSelection()).toEqual(["note:local"]);
  expect(getPendingPlacementTool()).toBe("note");
});
```

**구현 단계:**

1. `createSqlErdRoomName({ workspaceId, sessionId })`와 `sql_erd_sessions`·`workspace_members`·`deleted_at IS NULL`을 함께 확인하는 access query를 구현한다.
2. `sql-erd:join`, `sql-erd:leave`, `sql-erd:presence:update`, `sql-erd:joined`, `sql-erd:presence:leave`, `sql-erd:error`를 등록한다.
3. cursor·selection·tool만 in-memory presence로 보관하고 disconnect 시 제거한다. payload 크기와 UUID, 색상, 선택 ID 배열 길이를 검증한다.
4. SQLtoERD 전용 frontend hook으로 room lifecycle을 관리하고 remote cursor/selection을 overlay로 표시한다. local drag, pen, eraser, connect port 이벤트를 가로채지 않는다.

**검증:** realtime-server 단위 테스트, 다른 Workspace/삭제 session join 거부, 두 계정·두 브라우저의 presence·leave·session 전환 수동 확인.

## 작업 2: durable operation·delivery 계약

**Issue/PR:** `feat(sqltoerd,api,db,realtime): SQLtoERD operation과 durable delivery 추가`

**예상 파일:**

- Create: `db/migrations/20260714000100_create_sql_erd_session_operations.sql`
- Create: `db/migrations/20260714000200_create_sql_erd_session_operation_outbox.sql`
- Create: `apps/app-server/src/modules/sql-erd/sql-erd-operation.service.ts`
- Create: `apps/app-server/src/modules/sql-erd/sql-erd-operation.validation.ts`
- Create: `apps/app-server/src/modules/sql-erd/sql-erd-operation-outbox-publisher.service.ts`
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd.controller.ts`
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd.service.ts`
- Create: `apps/realtime-server/src/sql-erd/sql-erd-operation-subscriber.ts`
- Modify: `docs/api/sqltoerd-api.md`

**테스트를 먼저 작성한다.**

```ts
it("같은 clientOperationId 재시도는 operation 하나와 같은 결과만 돌려준다", async () => {
  const first = await submit(operation);
  const retry = await submit(operation);

  expect(retry.operation.id).toBe(first.operation.id);
  expect(await countOperations(sessionId)).toBe(1);
});

it("Redis publish 실패 뒤에도 outbox와 operation은 남고 재시도한다", async () => {
  await submit(operation);
  await failNextRedisPublish();

  await runOutboxSweep();
  expect(await readOutbox(operation.id)).toMatchObject({ status: "pending", attemptCount: 1 });
});

it("process 종료로 60초 넘게 publishing인 row를 새 token으로 reclaim한다", async () => {
  const firstClaim = await claimOutbox(operation.id);
  await advanceClockBySeconds(61);

  await runOutboxSweep();
  const reclaimed = await readOutbox(operation.id);
  expect(reclaimed.status).toBe("publishing");
  expect(reclaimed.claimToken).not.toBe(firstClaim.claimToken);
  expect(reclaimed.attemptCount).toBe(2);
});

it("stale layout patch는 최신 layout에 rebase하고 서로 다른 entity를 보존한다", async () => {
  await submitLayoutPatch({ baseRevision: 10, patch: { notesById: { noteA: { x: 80, y: 40 } } } });
  const result = await submitLayoutPatch({ baseRevision: 9, patch: { tableLayoutsById: { users: { x: 320, y: 40 } } } });

  expect(result).toMatchObject({ rebased: true, appliedOnRevision: 11, resultRevision: 12 });
  expect(await readLayout(sessionId)).toMatchObject({
    tableLayouts: { users: { x: 320, y: 40 } },
    annotations: { notes: { noteA: { x: 80, y: 40 } } },
  });
});
```

**구현 단계:**

1. session별 `opSeq`, `(session_id, client_operation_id)` idempotency, catch-up index/RLS를 가진 operation table과 operation당 하나의 outbox row를 migration으로 추가한다.
2. `POST .../operations`, `GET .../operations?afterSeq&limit`와 `SqlErdLayoutPatch` validation을 추가한다. update map과 delete ID list는 별도 필드로 검증한다. stale `layout_patch`는 최신 layout에 rebase하고, 미래 `baseRevision`은 `409 SQL_ERD_REVISION_AHEAD`로 거부한다.
3. realtime 활성 session의 plural·singular 기존 full `PATCH`를 동일하게 `409 SQL_ERD_REALTIME_OPERATION_REQUIRED`로 거부한다. client flag로 우회할 수 없게 server 상태만 사용한다.
4. session update, canonical patch apply, revision 증가, operation insert, outbox insert를 한 transaction으로 묶는다.
5. outbox publisher는 commit 뒤 즉시 publish하고, 1초 sweep에서 `FOR UPDATE SKIP LOCKED`로 row를 claim한다. `pending` due row와 `claimed_at`이 60초를 넘긴 `publishing` row를 모두 새 token으로 claim한다. 1·2·4·8·16초, 이후 30초 간격으로 재시도하며 5회 실패부터 alert를 남긴다. 성공·실패 update는 claim token을 조건으로 하며, 성공한 `PUBLISH`만 `delivered`로 바꾼다.
6. realtime-server subscriber와 client는 `operationId`·`opSeq`로 중복을 제거한다. Redis subscriber 부재나 socket 유실은 operation 실패가 아니며 REST catch-up으로 복구한다.

**검증:** idempotency, 권한, invalid patch, stale/future `baseRevision`, full PATCH 차단, transaction 실패 시 outbox 미생성, 다중 publisher claim, 60초 stale `publishing` reclaim, Redis 실패 재시도, 중복 event 제거, GET catch-up 자동 테스트.

## 작업 3: layout·annotation operation 동기화

**Issue/PR:** `feat(sqltoerd,realtime): SQLtoERD layout과 annotation 동기화 추가`

**예상 파일:**

- Create: `apps/frontend/src/features/sql-erd/realtime/sql-erd-layout-operation.ts`
- Create: `apps/frontend/src/features/sql-erd/realtime/use-sql-erd-operation-sync.ts`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-canvas.tsx`
- Modify: `apps/frontend/src/features/sql-erd/page.tsx`
- Test: `apps/frontend/src/features/sql-erd/realtime/use-sql-erd-operation-sync.test.ts`

**테스트를 먼저 작성한다.**

```ts
it("동시에 table과 note를 옮겨도 최신 layout에서 두 patch를 병합한다", () => {
  applyLayoutPatch({ tableLayoutsById: { users: { x: 120, y: 48 } } });
  applyRemoteOperation({ patch: { notesById: { noteA: { x: 300, y: 180 } } } });

  expect(getLayout().tableLayouts.users).toMatchObject({ x: 120, y: 48 });
  expect(getLayout().annotations.notes.noteA).toMatchObject({ x: 300, y: 180 });
});

it("socket operation 하나를 놓쳐도 10초 catch-up으로 적용한다", async () => {
  setLastAppliedOpSeq(11);
  await pollCatchUp();

  expect(getLastAppliedOpSeq()).toBe(12);
});
```

**구현 단계:**

1. table sync, annotation sync, UI edit의 저장 결과를 하나의 `applyLayoutPatch(previous => next)` 경로로 합친다.
2. local 변경은 `clientOperationId`로 optimistic apply 후 operation API에 보낸다. 자신의 echo는 revision/opSeq만 확정하고 다른 actor operation은 최신 local layout에 함수형으로 적용한다.
3. `opSeq` gap은 즉시 GET catch-up하고, socket 연결 중에도 10초마다 `operations?afterSeq`를 poll한다. gap·보존 만료는 session detail GET으로 canonical state를 복구한다.
4. source lock event가 오면 layout/annotation mutation UI와 operation submit을 멈추되 pan/zoom, selection, presence는 유지한다.

**검증:** table drag + note drag, 모든 annotation 생성/삭제, in-flight autosave, Redis event 누락, reconnect, 늦은 join, 409 recovery를 자동·두 브라우저 테스트로 확인한다.

## 작업 4: source lease lock·snapshot reconcile·rollout

**Issue/PR:** `feat(sqltoerd,realtime): SQL 원문 lease lock과 안전한 snapshot 동기화 추가`

**예상 파일:**

- Create: `db/migrations/20260714000300_create_sql_erd_session_source_locks.sql`
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd.controller.ts`
- Create: `apps/app-server/src/modules/sql-erd/sql-erd-source-lock.service.ts`
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd-operation.service.ts`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-source-editor.tsx`
- Modify: `apps/frontend/src/features/sql-erd/realtime/use-sql-erd-operation-sync.ts`
- Modify: `docs/api/sqltoerd-api.md`
- Create: `docs/superpowers/specs/sqltoerd-realtime-rollout-checklist.md`
- Test: `apps/app-server/scripts/sql-erd/source-lock.test.mjs`

**테스트를 먼저 작성한다.**

```ts
it("source lock 중에는 holder를 포함한 layout patch를 모두 거부한다", async () => {
  await claimSourceLock(ownerUserId, sessionId);

  await expect(submitLayoutPatch(ownerUserId, sessionId)).rejects.toMatchObject({
    statusCode: 409,
    code: "SQL_ERD_SOURCE_LOCK_ACTIVE",
  });
});

it("source snapshot은 최신 잠금 layout의 annotation과 기존 table 위치를 보존한다", async () => {
  const lock = await claimSourceLock(ownerUserId, sessionId);
  const result = await submitSourceSnapshot({ lock, newTableLayoutsById: { orders: { x: 640, y: 80 } } });

  expect(result.layoutJson.annotations.notes.noteA).toBeDefined();
  expect(result.layoutJson.tableLayouts.users).toMatchObject({ x: 120, y: 48 });
});

it("source snapshot은 lock claim revision과 다른 baseRevision을 거부한다", async () => {
  const lock = await claimSourceLock({ userId: ownerUserId, sessionId, baseRevision: 12 });

  await expect(submitSourceSnapshot({ lock, baseRevision: 11 })).rejects.toMatchObject({
    statusCode: 409,
    code: "SQL_ERD_SOURCE_LOCK_BASE_REVISION_STALE",
  });
});
```

**구현 단계:**

1. `source_locks` table과 claim/renew/release endpoint를 구현한다. claim은 `baseRevision === currentRevision`만 허용하며, lease는 30초, client renew는 10초로 시작한다.
2. claim transaction에서 session row를 직렬화하고 `lockedSessionRevision`과 `lockedLayoutOpSeq`를 기록한다. lock 중 모든 layout/annotation operation을 server에서 `409 SQL_ERD_SOURCE_LOCK_ACTIVE`로 거부한다.
3. source write, Regenerate SQL, SQL diff Apply가 유효 lease owner와 `lockedSessionRevision`·`lockedLayoutOpSeq`를 확인하게 한다. source snapshot은 `baseRevision === lockedSessionRevision === currentRevision`일 때만 source/model과 `newTableLayoutsById`를 받는다.
4. server는 lock 시점의 최신 layout에서 기존 table 위치·모든 annotation을 보존하고, model에서 제거된 table layout을 지우며 새 table layout만 추가한 canonical snapshot을 만든다.
5. lock 변경과 만료를 realtime event로 broadcast하고 UI는 source·layout mutation을 read-only로 전환한다. snapshot 수신은 존재하지 않는 selection만 해제하고 camera는 유지한다.
6. Workspace/session feature flag로 단계 배포한다. outbox lag, `sync:required`, 10초 poll recovery, lock contention, source snapshot reconcile을 관측하고 두 계정·두 브라우저 E2E를 실행한다.

**검증:** stale source lock claim/source snapshot 409, claim 경쟁, renew, disconnect/timeout takeover, full PATCH 우회 불가, lock 중 layout patch 차단, snapshot annotation/table 위치 보존, Redis 누락 뒤 poll 복구, feature flag rollback을 확인한다.

---

## 실행 순서 요약

1. room/access/presence
2. operation log·transactional outbox·broadcast
3. layout/annotation optimistic sync·catch-up
4. source lease lock·snapshot reconcile·rollout

각 번호는 하나의 후속 Issue와 하나의 PR이다. 1단계는 presence만 제공하므로 사용자 데이터의 동시 저장을 해결하지 않는다. 2~4단계가 모두 merge·검증되기 전에는 동시 편집 완료로 표시하지 않는다.
