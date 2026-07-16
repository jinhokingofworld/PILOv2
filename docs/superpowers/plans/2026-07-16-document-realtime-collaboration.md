# Workspace 문서 실시간 공동 편집 구현 계획

> **에이전트 작업자용:** 이 계획을 구현할 때는 반드시 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`를 사용한다. 작업 추적에는 체크박스(`- [ ]`)를 사용한다.

**목표:** native 문서를 durable concurrent Tiptap/Yjs collaboration, remote cursor, reconnect recovery로 확장하고, 같은 ready PDF를 보는 멤버의 page/pointer와 opt-in follow를 제공한다.

**구조:** browser Tiptap은 editor 계획의 schema에 Yjs collaboration provider를 붙인다. `apps/realtime-server`의 `/sync/documents` room은 authenticated Yjs sync와 awareness만 담당한다. browser는 병합된 문서를 기존 App Server snapshot API에 1초 debounce로 저장하고 마지막 editor leave에서 즉시 flush한다. PostgreSQL write, version, Activity Log는 App Server만 소유한다. PDF presence는 Socket.IO/Redis 기반 ephemeral room state이며 PostgreSQL/Activity Log에 저장하지 않는다.

**기술:** Tiptap collaboration, Yjs, Hocuspocus, crossws, Node `ws`, Socket.IO, Redis adapter/state client, NestJS, PostgreSQL.

## 공통 제약

- foundation과 editor/PDF 계획이 merge되었거나 branch에 rebase된 뒤 시작한다. server topology 변경 전 Infra/Realtime 담당자와 DB Schema 담당자에게 구현/리뷰를 조율한다.
- custom CRDT, custom Yjs merge algorithm, realtime-server의 document table 직접 write를 만들지 않는다.
- realtime room join은 mutation 권한이 아니다. App Server는 snapshot persist 때 bearer identity와 Workspace membership을 다시 검증한다.
- realtime memory와 Redis presence는 transport state일 뿐 source of truth가 아니다. realtime process restart 뒤 browser가 최신 App Server snapshot으로 rebuild할 수 있어야 한다.
- 1차 MVP는 raw `document_yjs_updates`를 저장하지 않는다. 마지막 변경 뒤 1초 debounce와 마지막 editor leave 시 snapshot을 남긴다. merged state를 하나의 App Server transaction으로 저장한다.
- cursor/presence/page/follow event나 key stroke는 log로 남기지 않는다. 겹친 공동 편집에서 특정 text의 소유자를 개인에게 배정하지 않는다.
- RAG, MeetingReport evidence generation, PDF annotation, 강제 follow, collaborative PDF editing은 제외한다.

---

## 작업 1: realtime protocol과 snapshot 저장 계약 정의

**대상 파일:**
- 수정: `docs/api/drive-api.md`, `apps/app-server/src/modules/drive/document.types.ts`, `document.validation.ts`
- 생성: `apps/realtime-server/src/documents/document-sync-protocol.ts`, `document-types.ts`, `README.md`
- 생성: `apps/realtime-server/scripts/document-sync-protocol.test.mjs`
- 수정: `apps/realtime-server/scripts/test.mjs`

- [ ] `/sync/documents`의 public client behavior를 문서화한다. Hocuspocus document name, bearer token 인증 메시지, unauthenticated, forbidden, deleted document의 연결 거부 기준과 Yjs sync/awareness protocol 사용을 명시한다.
- [ ] room ref `{ workspaceId, documentId }`와 1초 debounce/last editor leave snapshot 정책을 정의한다. raw update를 위한 별도 JSON mutation, acknowledgement, internal endpoint는 만들지 않는다.
- [ ] 기존 snapshot API가 membership, version, Activity Log transaction을 담당함을 명시하고, raw content를 Activity Log에 넣지 않는 규칙을 확인한다.

## 작업 2: App Server snapshot persistence 재사용 확인

**대상 파일:**
- 수정: `apps/app-server/src/modules/drive/document.service.ts` (필요한 경우)
- 수정: `apps/app-server/scripts/drive/document-editor.test.mjs` (필요한 경우)

- [ ] collaboration provider가 기존 snapshot API만 사용하도록 current version, membership, document lifecycle semantics를 확인한다.
- [ ] 1초 debounce snapshot과 마지막 editor leave flush가 기존 snapshot transaction 및 Activity Log 규칙을 우회하지 않음을 test한다.

## 작업 3: realtime-server의 `/sync/documents` Yjs room 구현

**대상 파일:**
- 생성: `apps/realtime-server/src/documents/document-access.service.ts`, `document-room.service.ts`, `document-app-server-client.ts`, `document-yjs-sync.service.ts`
- 수정: `apps/realtime-server/src/server.ts`, `config/realtime-config.ts`, `README.md`
- 생성: `apps/realtime-server/scripts/document-access.test.mjs`, `document-room-recovery.test.mjs`
- 수정: `apps/realtime-server/scripts/test.mjs`

- [ ] 기존 `/sync/canvas`의 authenticated WebSocket routing style을 따라 `/sync/documents`를 document sync service로 연결한다. 기존 session-token validation과 document 전용 membership/access query를 사용한다.
- [ ] 첫 room connection은 표준 Yjs provider를 붙인다. 최신 snapshot bootstrap과 1초 snapshot persist는 browser collaboration provider가 담당한다.
- [ ] valid Yjs update를 room peer에 broadcast하고 awareness를 transient하게 relay한다. raw Yjs update를 App Server로 전송하거나 DB에 기록하지 않는다.
- [ ] process/room recovery에서는 browser가 최신 App Server snapshot으로 재구성한다. 마지막 snapshot 뒤 최대 1초 편집 유실 가능성을 문서화한다.
- [ ] Yjs awareness는 display name, user id, selection/cursor만 transient하게 relay한다. payload byte limit을 두고 socket close 시 awareness를 지운다.
- [ ] unauthorized/member/non-member/deleted document와 awareness cleanup을 test한다.
- [ ] `apps/realtime-server`에서 `npm run lint`, `npm test`를 실행한다.

## 작업 4: frontend editor를 collaboration과 recovery state에 연결

**대상 파일:**
- 생성: `apps/frontend/src/features/drive/document-realtime.ts`, `document-realtime.test.mjs`
- 수정: `apps/frontend/src/features/drive/components/document-editor.tsx`, `drive-document-contract.test.mjs`
- 수정: `apps/frontend/package.json`

- [x] editor schema/attachment renderer는 유지한 채 snapshot으로 bootstrap한 Y.Doc에 Hocuspocus provider를 연결한다. local·remote Yjs update 모두 `1초` debounce snapshot 저장을 만든다.
- [x] 문서 화면 종료와 provider 종료에서 pending Yjs 전송 및 snapshot 저장을 flush한다. `409 CONFLICT`는 최신 snapshot을 현재 Y.Doc에 병합한 뒤 한 번 재시도한다.
- [ ] custom `clientUpdateId` acknowledgement envelope은 Hocuspocus 표준 sync protocol과 중복되므로 만들지 않는다. offline 복구 경계와 unsynced update UX는 reconnect QA 결과를 바탕으로 별도 보강한다.
- [ ] remote awareness를 Tiptap collaboration cursor와 compact member list로 바인딩한다. untrusted display name을 HTML로 render하지 않는다.
- [x] transport state를 `저장 중`/`저장됨`, reconnecting을 `재연결 중`, 인증 실패를 재연결 가능한 오류로 표시한다. snapshot 저장 재시도는 로컬 내용을 버리지 않는다.
- [ ] 열린 문서의 delete를 감지하면 provider를 stop하고 해당 document pending update를 비우며 deletion state를 표시한 뒤 `/files`로 안전하게 이동한다.
- [x] provider room name, realtime URL 변환, `1초` debounce/flush, remote transaction이 저장 요청을 만들지 않는 연결 지점을 단위·계약 test로 검증한다.
- [ ] deleted-document shutdown, remote cursor, 두 browser session의 같은 paragraph 동시 편집, tab offline/reconnect, realtime-server restart를 수동 검증한다. 두 변경이 converge하고 refresh 뒤에도 남아야 한다.

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
