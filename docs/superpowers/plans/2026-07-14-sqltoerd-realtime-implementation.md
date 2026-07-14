# SQLtoERD realtime 구현 계획

> **실행 방식:** 각 작업은 별도 Issue와 PR로 진행한다. 이 문서는 #771 설계를 실행 가능한 순서로 고정하며, 현재 PR은 이 계획의 코드 구현을 포함하지 않는다.

**목표:** 같은 SQLtoERD session에서 presence를 먼저 제공하고, 이어서 table·annotation operation과 SQL source lease lock을 안전하게 동기화한다.

**아키텍처:** App Server가 영속 mutation의 유일한 진입점이다. DB transaction이 session과 operation을 확정한 뒤 Redis channel에 publish하고, realtime-server는 SQLtoERD room으로 broadcast한다. browser는 REST 응답과 socket operation을 sequence로 정렬해 적용한다.

**기술 스택:** NestJS App Server, PostgreSQL, Socket.IO realtime-server, Redis pub/sub, Next.js/React, tldraw surface

---

## 전역 구현 제약

- Canvas room과 `canvas` 테이블 access service를 SQLtoERD에 재사용하지 않는다. 인증/Socket lifecycle만 참고하고 `sql_erd_sessions` 전용 access service를 만든다.
- client는 socket으로 영속 mutation을 emit하지 않는다.
- `layout_patch`는 전체 `layoutJson` 대체가 아니라 명령형 patch다. 모든 병합은 함수형 최신 상태 update에서 수행한다.
- `source_snapshot`은 유효한 source lease owner만 제출할 수 있다. CRDT는 이 계획의 범위 밖이다.
- API·migration 변경 PR은 `docs/api/sqltoerd-api.md`와 함께 수정하고 SQLtoERD·DB Schema·Infra/Realtime 리뷰를 받는다.

## 작업 1: SQLtoERD realtime room과 presence

**Issue:** `feat(sqltoerd,realtime): SQLtoERD session room과 presence 추가`

**예상 파일:**

- Create: `apps/realtime-server/src/sql-erd/sql-erd-types.ts`
- Create: `apps/realtime-server/src/sql-erd/sql-erd-access.service.ts`
- Create: `apps/realtime-server/src/sql-erd/sql-erd-room.service.ts`
- Create: `apps/realtime-server/src/sql-erd/sql-erd-socket-events.ts`
- Create: `apps/realtime-server/src/sql-erd/sql-erd-presence.service.ts`
- Modify: `apps/realtime-server/src/socket/room-names.ts`
- Modify: `apps/realtime-server/src/socket/socket-server.ts`
- Test: `apps/realtime-server/src/sql-erd/sql-erd-socket-events.spec.ts`

**테스트를 먼저 작성한다.**

```ts
it("같은 Workspace의 활성 SQLtoERD session에만 join시킨다", async () => {
  await expect(join({ workspaceId, sessionId, userId })).resolves.toMatchObject({
    roomName: `workspace:${workspaceId}:sql-erd:${sessionId}`,
  });
  await expect(join({ workspaceId: otherWorkspaceId, sessionId, userId }))
    .rejects.toMatchObject({ code: "SQL_ERD_ACCESS_DENIED" });
});
```

**구현 단계:**

1. `createSqlErdRoomName({ workspaceId, sessionId })`를 만들고 Canvas room 이름과 충돌하지 않게 한다.
2. `sql_erd_sessions`, `workspace_members`, `deleted_at IS NULL`을 함께 확인하는 access query를 구현한다.
3. `sql-erd:join`, `sql-erd:leave`, `sql-erd:presence:update`과 `sql-erd:joined`, `sql-erd:presence:leave`, `sql-erd:error`를 등록한다.
4. cursor·selection·tool만 in-memory presence로 보관하고 disconnect 시 제거한다.
5. socket payload 크기, UUID, 색상, 선택 ID 배열 길이를 검증한다.

**검증:** realtime-server의 단위 테스트, 다른 Workspace/삭제 session join 거부, 두 브라우저의 presence 수동 확인.

## 작업 2: frontend presence bridge와 원격 표시

**Issue:** `feat(sqltoerd,realtime): SQLtoERD remote cursor와 selection 표시`

**예상 파일:**

- Create: `apps/frontend/src/features/sql-erd/realtime/sql-erd-realtime-types.ts`
- Create: `apps/frontend/src/features/sql-erd/realtime/use-sql-erd-realtime.ts`
- Create: `apps/frontend/src/features/sql-erd/realtime/SqlErdRealtimeBridge.tsx`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-canvas.tsx`
- Test: `apps/frontend/src/features/sql-erd/realtime/use-sql-erd-realtime.test.ts`

**테스트를 먼저 작성한다.**

```ts
it("원격 selection은 local selection과 one-shot placement 상태를 바꾸지 않는다", () => {
  receivePresence({ userId: otherUserId, selectionIds: ["table:users"] });

  expect(getLocalSelection()).toEqual(["note:local"]);
  expect(getPendingPlacementTool()).toBe("note");
});
```

**구현 단계:**

1. `features/sql-erd/realtime`에 SQLtoERD 전용 Socket hook을 만들고 shared client의 공개 API만 사용한다.
2. mount/unmount와 session 변경 시 room join/leave를 보장한다.
3. pointer 이동은 throttle하고, local selection/tool 변경은 debounce하여 presence event를 보낸다.
4. remote cursor/selection을 overlay로 그리되 tldraw local selection, drag, pen, eraser, connect port 이벤트를 가로채지 않는다.
5. socket 단절 시 presence만 숨기고 local editing/autosave는 기존 동작을 유지한다.

**검증:** 두 계정/두 브라우저로 cursor, selection, leave/disconnect, session 전환을 확인한다.

## 작업 3: durable operation DB·API 계약

**Issue:** `feat(sqltoerd,api,db): SQLtoERD operation log와 catch-up API 추가`

**예상 파일:**

- Create: `db/migrations/20260714000100_create_sql_erd_session_operations.sql`
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd.types.ts`
- Create: `apps/app-server/src/modules/sql-erd/sql-erd-operation.service.ts`
- Create: `apps/app-server/src/modules/sql-erd/sql-erd-operation.validation.ts`
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd.controller.ts`
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd.service.ts`
- Modify: `docs/api/sqltoerd-api.md`
- Test: `apps/app-server/scripts/sql-erd/operation.test.mjs`

**테스트를 먼저 작성한다.**

```ts
it("같은 clientOperationId 재시도는 operation 하나와 같은 결과만 돌려준다", async () => {
  const first = await submit(operation);
  const retry = await submit(operation);

  expect(retry.operation.id).toBe(first.operation.id);
  expect(await countOperations(sessionId)).toBe(1);
});
```

**구현 단계:**

1. `sql_erd_session_operations` migration에 session별 `op_seq`, idempotency unique index, Workspace/RLS/index 정책을 추가한다.
2. `SqlErdLayoutPatch`와 `SubmitSqlErdOperationRequest` validation을 정의한다. update map과 delete ID list를 별도 필드로 검증한다.
3. session update, canonical patch apply, revision 증가, operation insert를 하나의 transaction으로 묶는다.
4. `POST .../operations`와 `GET .../operations?afterSeq&limit`를 추가하고 API 문서를 갱신한다.
5. 기존 full PATCH는 제거하지 않는다. realtime feature flag가 꺼진 client의 compatibility 경로로 남긴다.

**검증:** idempotency, 권한, invalid patch, 같은 entity 충돌의 server 순서, reconnect catch-up, 기존 PATCH 회귀를 자동 테스트한다.

## 작업 4: App Server publish와 realtime operation broadcast

**Issue:** `feat(sqltoerd,realtime): 저장된 SQLtoERD operation broadcast 추가`

**예상 파일:**

- Create: `apps/app-server/src/modules/sql-erd/sql-erd-realtime.publisher.ts`
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd-operation.service.ts`
- Create: `apps/realtime-server/src/sql-erd/sql-erd-operation-subscriber.ts`
- Modify: `apps/realtime-server/src/sql-erd/sql-erd-socket-events.ts`
- Test: `apps/app-server/scripts/sql-erd/realtime-publish.test.mjs`
- Test: `apps/realtime-server/src/sql-erd/sql-erd-operation-subscriber.spec.ts`

**테스트를 먼저 작성한다.**

```ts
it("DB transaction이 성공한 operation만 SQLtoERD room에 broadcast한다", async () => {
  await expect(submit(validOperation)).resolves.toBeDefined();
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({ opSeq: 1 }));

  await expect(submit(invalidOperation)).rejects.toBeDefined();
  expect(publish).toHaveBeenCalledTimes(1);
});
```

**구현 단계:**

1. App Server publisher는 transaction commit 뒤에만 Redis channel로 canonical operation을 publish한다.
2. realtime-server subscriber는 `workspace:{workspaceId}:sql-erd:{sessionId}` room에 `sql-erd:operation`을 broadcast한다.
3. Redis publish 실패 관측 지표와 retry/outbox 정책을 Infra/Realtime owner와 확정한다. 성공한 DB write를 rollback하지 않는다.
4. event payload에 원문 SQL log를 넣지 않고, authenticated room client에게 필요한 canonical snapshot/patch만 보낸다.

**검증:** transaction 실패 시 무broadcast, 다중 realtime instance 전달, duplicate Redis event idempotency를 확인한다.

## 작업 5: layout·annotation optimistic operation sync

**Issue:** `feat(sqltoerd,realtime): SQLtoERD layout과 annotation operation 동기화`

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
```

**구현 단계:**

1. table sync, annotation sync, UI edit의 저장 결과를 하나의 `applyLayoutPatch(previous => next)` 경로로 합친다.
2. local 변경은 `clientOperationId`로 optimistic apply 후 operation API에 보낸다.
3. 자신의 echo는 revision/opSeq만 확정하고, 다른 actor의 operation은 최신 local layout에 함수형으로 적용한다.
4. sequence gap 또는 stale response는 session detail GET으로 canonical state를 복구한다.
5. pending operation, offline, conflict 상태를 사용자에게 구분해 표시한다.

**검증:** table drag + note drag, annotation 생성/삭제, in-flight autosave, reconnect, 늦은 join, 409 recovery를 브라우저와 자동 테스트로 확인한다.

## 작업 6: SQL source lease lock과 snapshot sync

**Issue:** `feat(sqltoerd,realtime): SQL 원문 lease lock과 snapshot 동기화`

**예상 파일:**

- Create: `db/migrations/20260714000200_create_sql_erd_session_source_locks.sql`
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd.controller.ts`
- Create: `apps/app-server/src/modules/sql-erd/sql-erd-source-lock.service.ts`
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd-operation.service.ts`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-source-editor.tsx`
- Modify: `apps/frontend/src/features/sql-erd/realtime/use-sql-erd-operation-sync.ts`
- Modify: `docs/api/sqltoerd-api.md`
- Test: `apps/app-server/scripts/sql-erd/source-lock.test.mjs`

**테스트를 먼저 작성한다.**

```ts
it("유효한 lease owner만 source_snapshot을 저장할 수 있다", async () => {
  const lock = await claimSourceLock(ownerUserId, sessionId);

  await expect(submitSourceSnapshot(otherUserId, sessionId)).rejects.toMatchObject({
    statusCode: 409,
  });
  await expect(submitSourceSnapshot(ownerUserId, sessionId, lock.leaseId)).resolves.toBeDefined();
});
```

**구현 단계:**

1. source lock table과 claim/renew/release endpoint를 구현한다. lease는 30초, client renew는 10초로 시작한다.
2. source write, Regenerate SQL, SQL diff Apply가 모두 유효 lease owner를 확인하게 한다.
3. lock 변경과 만료를 Redis/realtime event로 broadcast하고 UI는 holder 외 사용자를 read-only로 전환한다.
4. source/model/layout이 확정된 뒤 `source_snapshot` operation을 만들고 publish한다.
5. remote snapshot 적용 전 local transient selection을 검증해 존재하지 않는 선택만 해제한다. source lock 정책상 원격 사용자의 unsaved source edit는 없다.

**검증:** claim 경쟁, renew, disconnect/timeout takeover, holder 변경, regenerate/apply broadcast, remote read-only UI를 확인한다.

## 작업 7: rollout·관측·회귀 검증

**Issue:** `test(sqltoerd,realtime): 동시 편집 rollout과 회귀 검증`

**예상 파일:**

- Modify: `docs/api/sqltoerd-api.md`
- Create: `docs/superpowers/specs/sqltoerd-realtime-rollout-checklist.md`
- Modify: realtime-server deployment/observability configuration files (Infra/Realtime owner와 경로 확정 후)
- Test: SQLtoERD two-browser E2E suite

**구현 단계:**

1. Workspace 또는 session feature flag로 presence부터 제한 rollout한다.
2. operation lag, reconnect recovery, source lock contention, Redis publish failure, `sync:required` 횟수를 관측한다.
3. migration backfill/rollback과 기존 non-realtime full PATCH compatibility를 검증한다.
4. 두 계정·두 브라우저에서 source lock, table/annotation operation, session 전환, deleted session, access denial E2E를 실행한다.

**완료 기준:** presence만 켠 상태와 durable operation까지 켠 상태를 분리해 배포·중단할 수 있고, 실패 시 canonical REST session GET으로 안전하게 복구된다.

---

## 실행 순서 요약

1. room/access/presence
2. frontend presence 표시
3. DB·API operation log
4. App Server publish·realtime broadcast
5. layout·annotation operation sync
6. source lease lock·snapshot sync
7. staged rollout과 two-browser E2E

각 작업은 전 작업의 API/DB 계약과 테스트가 merge된 뒤 시작한다. 작업 1~2만으로는 동시 저장 충돌이 해결되지 않으므로, 그것을 “동시 편집 완료”로 표시하지 않는다.
