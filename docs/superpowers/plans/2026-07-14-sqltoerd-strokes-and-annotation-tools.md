# SQLtoERD Stroke 및 Annotation 도구 구현 계획

**목표:** SQLtoERD의 자유 그리기 stroke를 영속 annotation으로 저장하고, annotation 입력·리사이즈·one-shot 도구 상태를 Canvas와 같은 명확한 방식으로 동작시킨다.

**구조:** `layoutJson.annotations.strokes`는 절대 좌표 point 배열, 색상, 고정 두께를 저장한다. 화면에서는 SQLtoERD 전용 `sqltoerd_stroke` shape로 hydrate하고, 펜은 활성 도구 모드에서 임시 shape를 갱신한 뒤 pointer up에 하나의 add patch를 발행한다. 지우개는 `sqltoerd_stroke` shape만 hit-test한다.

**제약:** stroke는 최대 100개, stroke당 point는 2~500개, 색상은 기존 annotation 색상 enum, 두께는 4px로 고정한다. DB schema·frontend/app-server 공통 영역은 변경하지 않는다.

## 원인

- `sql-erd-canvas.tsx`의 Escape 처리는 relation drag만 해제하고 `pendingPlacementToolRef`를 해제하지 않는다.
- `sql-erd-canvas-toolbar.tsx`는 선택한 frame/text를 활성 placement tool보다 우선해 색상 변경 대상을 잘못 선택한다.
- `sql-erd-note-shape.tsx`는 새 note의 focus 경로가 없으며, textarea가 비선택 note의 첫 클릭을 가로막아 selection/resize affordance가 드러나지 않는다.
- `sql-erd-canvas.tsx`는 note/frame/text transform만 `layoutJson` patch로 동기화한다. stroke 타입·validation·hydrate/dehydrate 경로가 없다.

## 작업 순서

1. types, patch merge, server validation, API 문서, 전용 테스트에 stroke 계약을 추가한다.
2. stroke shape와 pen/eraser mode를 구현하고, create/delete를 하나의 patch 경로로 저장·복원한다.
3. note/text focus와 선택 기반 input, unlocked frame resize, Escape cancel, active tool 우선 색상을 고친다.
4. lint, build, frontend/server test, format, diff check 및 수동 검증을 수행한다.
