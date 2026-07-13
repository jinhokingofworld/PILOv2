# PR Review Feature

Owner: 은재

API contract: `docs/api/pr-review-api.md`

PR review session, review canvas, diff viewer, file decision, GitHub Review 제출 UI와
관련된 frontend feature code를 둔다.

## Review Canvas Realtime

- Review Canvas는 `src/shared/canvas-realtime/`의 Socket protocol, client 생성기와 remote
  cursor overlay를 사용한다.
- room 입장·퇴장과 cursor·selection Presence 상태는
  `realtime/usePrReviewCanvasPresence.ts`가 담당한다.
- active room은 기존 PR Review HTTP 저장 흐름을 유지하고, completed room은
  `canvas:joined.readOnly`를 반영해 Tldraw 편집과 shape 저장을 막는다.
- freeform Canvas의 lock, preview, operation catch-up hook은 import하지 않는다.
- 접속 중 room이 completed로 바뀌는 즉시 전환은 PR Review room lifecycle event 범위다.
