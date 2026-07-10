# Canvas Module

Owner: 동현

API contract: `docs/api/canvas-api.md`

Canvas Agent contract: `docs/api/canvas-agent-api.md`

범위:

- 자유형 Workspace canvas
- shape 생성, 이동, 수정, 삭제
- viewport 상태
- shape `contentHash`, `revision`, viewport bounds 기반 조회

구조:

- `canvas.controller.ts`: Canvas API route와 response wrapping
- `canvas.service.ts`: Workspace 접근 확인, DB query/transaction, Canvas use case 조립
- `canvas.types.ts`: Canvas DB row, request, response, 내부 write 값 타입
- `canvas-shape.validation.ts`: Canvas/shape request와 query validation
- `canvas-shape.mapper.ts`: SQL row를 Canvas API response로 변환
- `canvas-shape-hash.ts`: canonical shape content 기준 `contentHash` 계산
- `agent/`: Canvas Agent run, step, draft API와 SQS planning/job boundary

`agent/`는 Canvas 전용 AI orchestration을 담당한다. 실제 Canvas shape mutation은
`CanvasService`를 호출하며, AI Worker는 Canvas action 계획만 만든다. Canvas shape
의 검색용 텍스트는 pgvector로 비동기 인덱싱하고, 사용자 승인 표현 기억은 같은
사용자·Workspace 범위에서만 local routing에 사용한다. raw tldraw JSON과 외부
도메인 데이터는 검색 인덱스나 Canvas AI action에 넣지 않는다.

주의:

- PR Review canvas는 자유형 canvas 테이블에 저장하지 않는다.
- PR Review 화면용 graph는 PR Review 모듈의 view model이다.
- `contentHash`는 서버가 canonical shape content 기준으로 계산한다.
