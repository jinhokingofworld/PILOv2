# Workspace 문서 실시간 공동 편집 구현 계획

> **에이전트 작업자용:** 이 계획을 구현할 때는 반드시 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`를 사용한다. 작업 추적에는 체크박스(`- [ ]`)를 사용한다.

**목표:** native 문서를 durable concurrent Tiptap/Yjs collaboration, remote cursor, reconnect recovery로 확장하고, 같은 ready PDF를 보는 멤버의 page/pointer와 opt-in follow를 제공한다.

**구조:** browser Tiptap은 editor 계획의 schema에 Yjs collaboration provider를 붙인다. `apps/realtime-server`의 `/sync/documents` room은 authenticated Yjs sync와 awareness만 담당한다. durable update/snapshot은 보호된 App Server internal document-sync API로 넘기며, PostgreSQL write, version, Activity Log는 App Server만 소유한다. PDF presence는 Socket.IO/Redis 기반 ephemeral room state이며 PostgreSQL/Activity Log에 저장하지 않는다.

**기술:** Tiptap collaboration, Yjs, 유지보수되는 Yjs WebSocket protocol/provider, Node `ws`, Socket.IO, Redis adapter/state client, NestJS internal API, PostgreSQL.

## 공통 제약

- foundation과 editor/PDF 계획이 merge되었거나 branch에 rebase된 뒤 시작한다. server topology 변경 전 Infra/Realtime 담당자와 DB Schema 담당자에게 구현/리뷰를 조율한다.
- custom CRDT, custom Yjs merge algorithm, realtime-server의 document table 직접 write를 만들지 않는다.
- realtime room join은 mutation 권한이 아니다. App Server는 update/snapshot persist 때 bearer identity와 Workspace membership을 다시 검증한다.
- realtime memory와 Redis presence는 transport state일 뿐 source of truth가 아니다. realtime process restart 뒤에도 App Server snapshot + update로 rebuild할 수 있어야 한다.
- stable `clientUpdateId`는 browser reconnect/retry를 지나 유지한다. retry마다 새 UUID를 만들지 않는다.
- 60초 idle, 10분 active edit session, 마지막 editor leave 시 snapshot을 남긴다. merged state와 structural diff를 하나의 App Server transaction으로 저장한다.
- cursor/presence/page/follow event나 key stroke는 log로 남기지 않는다. 겹친 공동 편집에서 특정 text의 소유자를 개인에게 배정하지 않는다.
- RAG, MeetingReport evidence generation, PDF annotation, 강제 follow, collaborative PDF editing은 제외한다.

---

## 작업 1: internal sync와 realtime protocol 계약 정의

**대상 파일:**
- 수정: `docs/api/drive-api.md`, `apps/app-server/src/modules/drive/document.types.ts`, `document.validation.ts`
- 생성: `apps/realtime-server/src/documents/document-sync-protocol.ts`, `document-types.ts`, `README.md`
- 생성: `apps/realtime-server/scripts/document-sync-protocol.test.mjs`
- 수정: `apps/realtime-server/scripts/test.mjs`

- [ ] `/sync/documents`의 public client behavior를 문서화하고 App Server sync endpoint는 internal-only임을 명시한다. unauthenticated, forbidden, deleted document, malformed update, persistence failure의 close/error code를 정한다.
- [ ] 유지보수되는 Yjs sync/awareness 구현 위에서 compact protocol을 정의한다: authenticated room ref `{ workspaceId, documentId }`, stable `clientUpdateId`를 가진 incremental update, server acknowledgement, awareness payload, bootstrap snapshot/update sequence, durable error message다. decode 전에 byte size와 rate limit을 적용한다.
- [ ] dedicated realtime service credential과 forwarded bearer identity로 보호되는 internal App Server endpoint를 정의한다.
  - bootstrap read: latest snapshot과 이후 sequence의 update
  - append update: 검증된 `clientUpdateId`, binary update, edit-session id, actor
  - finalize snapshot: full Yjs state, canonical Tiptap JSON, source update sequence, edit-session id, structural metric
- [ ] internal finalize가 기존 document content/version과 `document_content_updated` Activity Log transaction을 실행하도록 명시한다. attachment mutation은 public document API에 남긴다.
- [ ] payload shape, size limit, retry id, raw content를 log에 넣지 않는 규칙을 protocol test로 검증한다.

## 작업 2: 보호된 App Server document-sync persistence boundary 구현

**대상 파일:**
- 생성: `apps/app-server/src/modules/drive/document-sync.service.ts`, `document-sync.controller.ts`, `document-sync.validation.ts`
- 수정: `apps/app-server/src/modules/drive/document.service.ts`, `drive.module.ts`, established app-server environment config 위치
- 생성: `apps/app-server/scripts/drive/document-sync.test.mjs`
- 수정: `apps/app-server/scripts/test.mjs`

- [ ] REST autosave와 internal realtime finalization이 같은 snapshot/version semantics를 쓰도록 persistence core를 `DocumentService`에서 추출해 재사용한다. SQL을 복제하지 않는다.
- [ ] 기존 deployment secret 경로를 이용해 realtime service용 server-to-server secret을 추가한다. payload를 parse하기 전에 credential 없는 호출을 거부하고 frontend에는 절대 노출하지 않는다.
- [ ] 모든 bootstrap/append/finalize에서 forwarded user bearer identity, 현재 Workspace membership, active `document` Drive item을 검증한다.
- [ ] append transaction에서 다음 sequence를 안전하게 할당하고 immutable Yjs update를 insert하며 `(document_id, client_update_id)`를 dedupe한다. retry는 기존 sequence를 반환하고 session progress field만 변경한다.
- [ ] finalize transaction에서 document lock, current/contiguous source sequence 확인, immutable snapshot write, `current_version/latest_snapshot_id` advance, edit session close, 정확히 한 개의 structural `document_content_updated` append를 실행한다. rollback 시 snapshot/log가 모두 사라져야 한다.
- [ ] recovery bootstrap은 last snapshot 이후 update를 순서대로 반환한다. update batch/byte limit을 두고 limit을 넘으면 fresh snapshot을 요구한다.
- [ ] duplicate retry, cross-workspace, invalid service credential, deleted document, concurrent sequence allocation, snapshot/log rollback, recovery ordering을 test한다.
- [ ] 필요한 secret/config 문서를 추가하고 Infra와 deployment 변경을 조율한다. 이 PR에서 관련 없는 infrastructure drift를 apply하지 않는다.

## 작업 3: realtime-server의 `/sync/documents` Yjs room 구현

**대상 파일:**
- 생성: `apps/realtime-server/src/documents/document-access.service.ts`, `document-room.service.ts`, `document-app-server-client.ts`, `document-yjs-sync.service.ts`
- 수정: `apps/realtime-server/src/server.ts`, `config/realtime-config.ts`, `README.md`
- 생성: `apps/realtime-server/scripts/document-access.test.mjs`, `document-room-recovery.test.mjs`
- 수정: `apps/realtime-server/scripts/test.mjs`

- [ ] 기존 `/sync/canvas`의 authenticated WebSocket routing style을 따라 `/sync/documents`를 document sync service로 연결한다. 기존 session-token validation과 document 전용 membership/access query를 사용한다.
- [ ] 첫 room connection에서 App Server bootstrap state를 읽어 `Y.Doc`를 reconstruct하고 durable update를 적용한 뒤 sync/awareness provider를 붙인다. bootstrap 전 write는 받지 않는다.
- [ ] valid Yjs update를 빠르게 room peer에 broadcast하고 stable client id 그대로 App Server로 보낸다. durable persistence 뒤에만 acknowledgement한다. 일시적 App Server failure에는 connection/session에 update를 queue하고 recoverable state를 알리되 durable success라고 말하지 않는다.
- [ ] idle/periodic/last-editor snapshot schedule(60초/10분/leave)을 구현한다. duplicate finalizer를 취소하고 같은 merged document state로 한 번만 internal finalize를 호출한다.
- [ ] process/room recovery에서는 stale in-memory assumption을 버리고 App Server bootstrap으로 재구성한다. restart/reconnect 뒤 최종 text가 남는 test를 추가한다.
- [ ] Yjs awareness는 display name, user id, selection/cursor만 transient하게 relay한다. payload byte limit을 두고 socket close 시 awareness를 지운다.
- [ ] config에 internal App Server URL/credential 검증을 추가하고 unauthorized/member/non-member/deleted/retry/bootstrap/awareness cleanup을 test한다.
- [ ] `apps/realtime-server`에서 `npm run lint`, `npm test`를 실행한다.

## 작업 4: frontend editor를 collaboration과 recovery state에 연결

**대상 파일:**
- 생성: `apps/frontend/src/features/documents/realtime/document-collaboration-provider.ts`, `document-realtime-client.ts`, `document-realtime-client.test.ts`
- 수정: `apps/frontend/src/features/documents/components/document-editor.tsx`, `document-editor-page.tsx`, `document-save-status.tsx`
- 수정: `apps/frontend/scripts/test.mjs`

- [ ] editor schema/attachment renderer는 유지한 채 local-only content transport를 collaboration adapter로 교체한다. 같은 edit session에서 REST autosave와 realtime snapshot write를 동시에 실행하지 않는다.
- [ ] pending update envelope과 `clientUpdateId`를 browser session storage에 보관한다. reconnect 시 acknowledgement 전까지 같은 id로 resend하고, acknowledgement된 것만 지운다.
- [ ] remote awareness를 Tiptap collaboration cursor와 compact member list로 바인딩한다. untrusted display name을 HTML로 render하지 않는다.
- [ ] transport state를 `저장 중`/`저장됨`, reconnecting을 `재연결 중`, recover 불가능한 server rejection을 `저장 실패`로 표시한다. content를 잃지 않는 retry를 제공한다.
- [ ] 열린 문서의 delete를 감지하면 provider를 stop하고 해당 document pending update를 비우며 deletion state를 표시한 뒤 `/files`로 안전하게 이동한다.
- [ ] reconnect resend identity, acknowledgement cleanup, provider error mapping, deleted-document shutdown, remote cursor가 save request를 만들지 않는 경우를 test한다.
- [ ] 두 browser session의 같은 paragraph 동시 편집, tab offline/reconnect, realtime-server restart를 수동 검증한다. 두 변경이 converge하고 refresh 뒤에도 남아야 한다.

## 작업 5: ephemeral shared PDF presence와 opt-in follow 추가

**대상 파일:**
- 생성: `apps/realtime-server/src/pdf/pdf-access.service.ts`, `pdf-presence.service.ts`, `pdf-socket-events.ts`
- 수정: `apps/realtime-server/src/socket/socket-server.ts`, `socket/room-names.ts`
- 생성: `apps/realtime-server/scripts/pdf-presence.test.mjs`
- 수정: `apps/realtime-server/scripts/test.mjs`
- 생성: `apps/frontend/src/features/documents/realtime/pdf-presence-client.ts`, `pdf-presence-client.test.ts`
- 수정: `apps/frontend/src/features/documents/components/pdf-viewer.tsx`, `apps/frontend/scripts/test.mjs`

- [ ] `pdf-view:{workspaceId}:{fileId}` room name과 join/leave/current page/normalized pointer/follow target Socket.IO event를 정의한다. join 전 file이 same-workspace active `ready` `application/pdf`인지 검증한다.
- [ ] Redis-backed room state/adapter pattern을 사용해 member identity/display name, current page, normalized `x/y` pointer, selected follow target만 ephemeral하게 보관한다. disconnect에서 cleanup한다.
- [ ] pointer emission을 초당 10-15회로 throttle하고 `x/y`를 `[0,1]`로 검증한다. 서로 같은 page일 때만 remote pointer를 render한다.
- [ ] follow는 사용자별 opt-in이다. 기본은 자유 열람이며 follow를 켠 사람만 target의 page 이동을 적용한다. zoom/scroll은 강제하지 않고 follow를 끄면 즉시 중단한다.
- [ ] PDF presence를 PostgreSQL에 쓰지 않고 `ActivityLogService`도 부르지 않는다. 이 omission을 static test로 보장한다.
- [ ] member chip, same-page pointer overlay, follow control, connection error fallback을 viewer에 넣고 기존 local PDF control은 유지한다. realtime unavailable이어도 preview/download가 동작해야 한다.
- [ ] socket auth, room isolation, stale presence cleanup, pointer validation/throttle, follow opt-in, same-page-only pointer, DB/log 미사용을 test한다.

## 작업 6: 최종 검증과 단계적 출시

- [ ] `git diff --check`와 `apps/app-server`, `apps/realtime-server`, `apps/frontend`의 `npm test`를 모두 실행한다.
- [ ] non-production 환경에서 Infra와 realtime service credential, WebSocket routing, CORS, Redis adapter, sticky routing/load-balancer 요구사항, restart behavior를 확인한다.
- [ ] owner/member/non-member로 concurrent document edit, reconnect/retry, deleted document, PDF preview/download, shared PDF page/pointer, follow on/off, realtime restart 뒤 browser refresh E2E matrix를 실행한다.
- [ ] E2E 뒤 Activity Log에는 lifecycle/content/attachment action만 safe bounded metadata로 남고 reconnect retry duplicate, cursor/page/presence entry가 없는지 확인한다.
- [ ] server-to-server sync와 PDF presence diff가 review 가능한 크기를 넘으면 별도 PR로 나눈다. 모든 PR에서 RAG와 MeetingReport는 제외한다.
