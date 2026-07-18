# Canvas Feature

Owner: 동현

API contract: `docs/api/canvas-api.md`

자유형 canvas, shape 편집, viewport 조작 UI와 관련된 frontend feature code를 둔다.

## Freeform Canvas 조합

저장되는 PILO freeform canvas는 아래 순서로 조합한다.

```text
WorkspaceCanvas -> ClassicCanvasRuntime -> CanvasEditor -> TldrawSurface
```

- `WorkspaceCanvas`: `/canvas` 화면, toolbar, board 선택과 생성 흐름
- `engine/runtime/ClassicCanvasRuntime`: Canvas board hydration, local/API 저장 모드, shape sync queue
- `engine/editor/CanvasEditor`: Canvas 전용 shape, placement, overlay, editor action 조립
- `TldrawSurface`: `src/shared/tldraw`의 순수 tldraw rendering surface

`src/shared/tldraw`를 사용하지만, PILO freeform Canvas의 source of truth는 Canvas
도메인에 남는다. 즉 저장, hydration, sync queue, Canvas API/DB 흐름은
`src/features/canvas/`가 소유한다.

주요 폴더는 사용자가 코드를 따라가기 쉬운 책임 단위로 나눈다.

- `components/screen/`: 화면 배치, toolbar, dialog, runtime 선택
- `engine/canvas-engine-types.ts`: engine 내부에서 공유하는 shape/view 타입
- `runtime/`: 저장, hydration, sync queue, local/API mode
- `editor/`: Canvas 전용 tldraw editor 조립, 배경, reporter, overlay
- `shapes/`: shape 등록, shape factory, shape type guard, shape별 ShapeUtil/UI
- `interactions/`: placement, smart guide, selection stacking
- `assets/`: image/video asset 생성과 복원
- `collaboration/`: room presence, preview, operation catch-up hook
- `persistence/`: local storage, shape diff, batch queue와 retry
- `imports/`: 파일과 폴더 탐색, 코드 파일 검증과 import 데이터 생성
- `integrations/`: Canvas가 다른 도메인의 안정적인 식별자를 참조하는 연결 adapter

`integrations/drive/`는 Drive 파일 선택과 preview URL 발급을 Canvas 언어로 변환한다.
roomState에는 `fileId`, 파일명, MIME type만 남기고 presigned URL과 파일 원문은
브라우저 메모리에서만 사용한다.

`shapes/code-block/`은 code block shape의 tldraw 연결과 editor UI 책임을 파일 단위로
분리한다. `PiloCodeBlockShapeUtil`은 shape props schema, geometry, resize,
component 연결만 담당하고, CodeMirror 설정과 code editor UI는 code-block 하위
컴포넌트/타입 파일에서 담당한다.

`runtime/`은 `ClassicCanvasRuntime`을 조립자로 두고 책임별 파일을 평평하게 나눈다.

- `useCanvasRuntimeHydration`: board 변경 시 초기 shape 복원과 고정 시작 카메라 reset
- `useCanvasShapePersistence`: freeform shape 변경 감지, local/API 저장, dirty shape 방어
- `useCanvasViewportQueries`: viewport shape summary 조회와 shape detail lazy loading
- `useCanvasApiLifecycle`: Canvas enter/leave와 unmount 시 shape queue flush
- `CanvasZoomControls`: smart guide와 zoom controls UI
- `canvas-runtime-utils`: runtime hook들이 공유하는 순수 계산 helper와 query key
- `canvas-runtime-types`: runtime 내부 client/storage mode 타입

Classic Canvas 카메라는 협업 저장 상태로 취급하지 않는다. 진입과 새로고침 시 실제
tldraw 편집 viewport의 정중앙에 Canvas 좌표 `(0, 0)`을 배치하고 100% zoom으로
시작한다. 사용 중 pan/zoom은 자유롭게 유지하며 `zoomToFit`은 별도 사용자 액션이다.

`api/` 하위 폴더는 Canvas API client 경계를 책임별로 나눈다.

- `canvas-client.ts`: 외부 import 경로를 유지하는 얇은 entrypoint와 mode 선택
- `canvas-api-client.ts`: bearer token, baseUrl, 실제 Canvas API request/response 처리
- `canvas-mock-client.ts`: local/mock mode의 board, shape, view-setting 흐름
- `canvas-normalizers.ts`: API/mock 응답을 Canvas runtime 입력 형태로 정규화
- `canvas-types.ts`: API client와 mock client가 공유하는 타입

`agent/`는 Canvas AI run 생성·polling, 선택 영역 직렬화, HTML artifact 표시를
담당한다. HTML 생성이 완료되면 선택 영역 오른쪽에 artifact 전체 내용을 가진
`pilo-code-block`을 만들고 선택 root와 양방향 binding된 연결선을 함께 생성한다.
이 shape와 binding은 일반 tldraw 편집과 같은 reporter/shape patch 경로를 타므로
roomState, room history, checkpoint와 다른 참여자 화면에 반영된다. run id를 shape
meta에 기록해 같은 완료 응답을 polling으로 여러 번 받아도 중복 생성하지 않는다.
Canvas AI의 가상 포인터와 검색 결과 강조는 계속 현재 사용자 브라우저에서만
렌더링하며 presence나 shape persistence queue에는 넣지 않는다.

`TldrawSurface`는 Canvas API/DB 저장 흐름을 소유하지 않는다. PR Review 같은 다른
도메인은 필요한 경우 이 surface만 가져가고, 자기 도메인 payload와 source of
truth를 유지해야 한다.

## tldraw_sync Canvas 연결 계약

`engineType === "tldraw_sync"`인 Canvas는 기존 `ClassicCanvasRuntime`의
shape batch/operation log 경로로 들어가지 않고 `TldrawSyncCanvasRuntime`으로
분기한다.

현재 구현은 `NEXT_PUBLIC_PILO_REALTIME_SERVER_URL`과 bearer session token이 있으면
`@tldraw/sync`로 realtime-server의 sync room에 접속한다. realtime-server를 사용할 수
없는 local UI Preview/mock session에서는 `canvas_sync_documents` snapshot 저장/복원
fallback을 사용한다. frontend는 아래 값을 기준으로 realtime-server room에 접속한다.

```text
workspaceId = board.workspaceId
canvasId = board.id
roomKey = workspace:{workspaceId}:canvas:{canvasId}:tldraw-sync
auth = bearer session token
```

규칙:

- frontend는 client에서 임의 room key를 만들 수 있지만, server에는
  `workspaceId`, `canvasId`, bearer token만 전달한다. 최종 room key는
  realtime-server가 검증 후 생성한다.
- `canvasId`는 `engineType === "tldraw_sync"`인 `freeform` Canvas여야 한다.
- `classic` Canvas의 `canvas_freeform_shapes`, `shapes/batch`, `operations`
  API를 tldraw sync document 저장에 사용하지 않는다.
- sync document의 최초 복원 기준은 realtime-server가 DB의
  `canvas_sync_documents.snapshot`에서 읽은 room snapshot이다. fallback runtime만
  `GET /workspaces/{workspaceId}/canvases/{canvasId}/sync-document`를 직접 사용한다.
- 새로고침/room 재생성 복구 기준은 realtime-server가 같은 persistence 경계에 저장한
  `canvas_sync_documents` snapshot이어야 한다.
- 로컬 UI Preview나 mock session은 realtime-server의 bearer session 검증을
  통과하지 않으므로 실제 multiplayer sync room에 접속하지 않는다.

## 다른 도메인과의 경계

다른 도메인이 PILO freeform Canvas 전체를 import해서 재사용하면 안 된다.

재사용 가능한 것은 `src/shared/tldraw/TldrawSurface` 같은 순수 rendering surface다.
Canvas의 아래 흐름은 Canvas 도메인 전용이다.

- Canvas API client
- Canvas local/API storage mode
- freeform shape sync queue
- `canvas_freeform_shapes` payload 변환
- `/canvas` toolbar와 board 상태

## 저장 안정성

- API 저장 모드에서는 shape 변경 operation을 Canvas feature 내부 queue에서 직렬로 보낸다.
- 저장 queue는 `p-queue` `concurrency: 1`로 직렬화한다.
- 저장 실패 시 pending operation을 버리지 않고 `p-retry` retry/backoff 후 다시 보낸다.
- 서버가 stale `baseRevision`을 `409 CONFLICT`로 거절하면 같은 payload를 retry해도
  성공하지 않으므로 non-retryable 오류로 처리한다. 이후 충돌 UI는 API 응답의
  `latestShape`와 `latestOperation.actorUserId`를 기준으로 사용자 선택지를 구성한다.
- shape 변경 감지는 전체 snapshot `JSON.stringify` 비교 대신 shape id별 `microdiff`를 사용한다.
- viewport/detail 조회는 `@tanstack/react-query` query key, cancellation, cache invalidation과 local dirty shape 상태를 확인한 뒤 반영한다.
- `contentHash`와 `revision`은 Canvas API 응답 기준 metadata이며, shared `TldrawSurface`가 아니라 Canvas runtime/API 경계에서 다룬다.

## Realtime Presence

- Canvas Socket.IO protocol, client 생성기와 remote cursor overlay는
  `src/shared/canvas-realtime/`에서 Canvas와 PR Review가 함께 사용한다.
- freeform Canvas의 presence, lock, preview, operation catch-up 조립은
  `src/features/canvas/collaboration/`에 남는다.
- `ClassicCanvasRuntime`은 socket state를 만들고, `CanvasEditor`는 `TldrawSurface` child에서 `useEditor()` 기반 cursor 좌표, selection, edit intent를 report한다.
- cursor 좌표, selection, `editingShapeId`, `editingMode` presence는 DB에 저장하지 않는다.
- remote shape preview는 `collaboration/canvas-remote-shape-preview-store`의 외부 store에서
  관리해 preview packet마다 `ClassicCanvasRuntime` 전체를 다시 렌더링하지 않는다.
- 로컬 draw/highlight pointer가 활성화된 동안에는 원격 preview와 committed shape patch를
  tldraw document store에 적용하지 않는다. room event는 shape별 대기열에 유지하고 로컬
  freehand가 끝난 직후 최신 상태를 적용해 서로 다른 사용자의 펜 segment가 끊기지 않게 한다.
- local UI Preview의 fake session은 realtime-server DB session 검증을 통과하지 않으므로 presence를 켜지 않는다.
- `src/shared/tldraw/TldrawSurface`는 presence를 소유하지 않는다. PR Review는 공통 Socket
  transport와 cursor overlay를 사용하되 room 입장과 Presence 보고는 PR Review feature에서
  조립한다.
