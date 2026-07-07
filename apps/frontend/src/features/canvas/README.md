# Canvas Feature

Owner: 동현

API contract: `docs/api/canvas-api.md`

자유형 canvas, shape 편집, viewport 조작 UI와 관련된 frontend feature code를 둔다.

## Freeform Canvas 조합

저장되는 PILO freeform canvas는 아래 순서로 조합한다.

```text
WorkspaceCanvas -> PiloCanvasRuntime -> PiloTldrawCanvas -> TldrawSurface
```

- `WorkspaceCanvas`: `/canvas` 화면, toolbar, board 선택과 생성 흐름
- `engine/runtime/PiloCanvasRuntime`: Canvas board hydration, local/API 저장 모드, shape sync queue
- `engine/surface/PiloTldrawCanvas`: Canvas 전용 shape, placement, overlay, editor action 조립
- `TldrawSurface`: `src/shared/tldraw`의 순수 tldraw rendering surface

`src/shared/tldraw`를 사용하지만, PILO freeform Canvas의 source of truth는 Canvas
도메인에 남는다. 즉 저장, hydration, sync queue, Canvas API/DB 흐름은
`src/features/canvas/`가 소유한다.

`engine/` 하위 폴더는 책임별로 나눈다.

- `types.ts`: engine 내부에서 공유하는 freeform shape/view setting 타입
- `runtime/`: 저장, hydration, sync queue, local/API mode
- `surface/`: Canvas 전용 tldraw surface 조립, 배경, state reporter
- `shapes/`: shape 등록, shape factory, shape type guard, shape별 ShapeUtil/UI
- `interactions/`: placement, smart guide, selection stacking
- `assets/`: image/video asset 생성과 복원

`api/` 하위 폴더는 Canvas API client 경계를 책임별로 나눈다.

- `canvas-client.ts`: 외부 import 경로를 유지하는 얇은 entrypoint와 mode 선택
- `canvas-api-client.ts`: bearer token, baseUrl, 실제 Canvas API request/response 처리
- `canvas-mock-client.ts`: local/mock mode의 board, shape, view-setting 흐름
- `canvas-normalizers.ts`: API/mock 응답을 Canvas runtime 입력 형태로 정규화
- `canvas-types.ts`: API client와 mock client가 공유하는 타입

`TldrawSurface`는 Canvas API/DB 저장 흐름을 소유하지 않는다. PR Review 같은 다른
도메인은 필요한 경우 이 surface만 가져가고, 자기 도메인 payload와 source of
truth를 유지해야 한다.

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
- shape 변경 감지는 전체 snapshot `JSON.stringify` 비교 대신 shape id별 `microdiff`를 사용한다.
- viewport/detail 조회는 `@tanstack/react-query` query key, cancellation, cache invalidation과 local dirty shape 상태를 확인한 뒤 반영한다.
- `contentHash`와 `revision`은 Canvas API 응답 기준 metadata이며, shared `TldrawSurface`가 아니라 Canvas runtime/API 경계에서 다룬다.
