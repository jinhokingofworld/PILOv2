# Canvas Persistence

## 담당하는 것

- local Canvas 저장소
- shape diff와 API payload 변환
- shape batch queue, retry, fallback

## 담당하지 않는 것

- Socket.IO roomState 전송
- tldraw editor rendering
- toolbar와 overlay

## 시작해서 읽을 파일

1. `canvas-shape-sync.ts`
2. `canvas-storage.ts`
3. `../engine/runtime/useCanvasShapePersistence.ts`
