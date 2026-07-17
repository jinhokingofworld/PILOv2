# Shared tldraw Surface

`src/shared/tldraw/`는 tldraw 기반 rendering surface만 제공한다.

이 폴더의 코드는 Canvas 도메인 소유 코드가 아니라, 여러 frontend 도메인이 필요한
tldraw 화면 표면을 조립할 때 재사용할 수 있는 공통 코드다.

## 책임

- `<Tldraw />` mount
- `shapeUtils`, `components`, `onMount`, overlay `children` 전달
- `hideUi`, `className`, `licenseKey` 같은 UI surface option 전달
- pointer/wheel capture 같은 surface-level event hook 전달

## 책임이 아닌 것

- Canvas API 호출
- Canvas DB 저장 흐름
- `canvas_freeform_shapes` sync
- PILO freeform Canvas runtime/hydration queue
- PR Review workflow payload ownership
- 특정 도메인의 source of truth 결정

## 도메인이 해야 하는 것

각 도메인은 `TldrawSurface` 위에 자기 도메인 소유의 shape, component, state
reporter, 저장 흐름을 조합한다.

PR Review가 이 surface를 재사용하더라도 `review_flows`, `review_files`,
`review_flow_files`를 source of truth로 유지해야 하며, Canvas API/DB 저장 흐름을
가져가면 안 된다.

## PILO freeform Canvas 조합

저장되는 PILO freeform canvas는 아래처럼 조합한다.

```text
WorkspaceCanvas -> ClassicCanvasRuntime -> CanvasEditor -> TldrawSurface
```
