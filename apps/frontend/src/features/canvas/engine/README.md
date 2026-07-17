# Canvas Engine

## 담당하는 것

- classic Canvas runtime 조립
- tldraw editor와 Canvas 전용 shape 연결
- local interaction, editor patch, overlay 구성

## 담당하지 않는 것

- Canvas API 요청 구현
- Socket.IO transport 구현
- 다른 도메인의 source of truth

## 읽는 순서

1. `runtime/ClassicCanvasRuntime.tsx`
2. `editor/CanvasEditor.tsx`
3. `canvas-engine-types.ts`
4. `shapes/`

`ClassicCanvasRuntime`은 저장과 collaboration 모듈을 연결하고,
`CanvasEditor`는 tldraw editor 안에서 발생하는 동작을 조립한다.
