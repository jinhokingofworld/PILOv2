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
