# Canvas Module

Owner: 동현

API contract: `docs/api/canvas-api.md`

Canvas Agent contract: `docs/api/canvas-agent-api.md`

범위:

- 자유형 Workspace canvas
- PR Review room에 연결된 Review Canvas의 제한적 HTTP 조회·shape operation
- PR Review 시스템 shape type과 사용자 mutation 보호
- shape 생성, 이동, 수정, 삭제
- viewport 상태
- shape `contentHash`, `revision`, viewport bounds 기반 조회
- shape update/delete `baseRevision` stale conflict 판정과 `409 CONFLICT` 응답

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
의 검색용 텍스트는 pgvector로 비동기 인덱싱한다. raw tldraw JSON과 외부 도메인
데이터는 검색 인덱스나 Canvas AI action에 넣지 않는다.

주의:

- Canvas 목록·생성·Agent는 계속 `freeform` 전용이다.
- 연결된 Review Canvas는 active room에서만 수정할 수 있고 completed room에서는 읽기만 가능하다.
- PR Review 화면용 graph와 시스템 node metadata의 source of truth는 PR Review 모듈이다.
- Review Canvas realtime join/presence는 아직 이 모듈 범위에 포함하지 않는다.
- `pr_review_file_node`는 geometry만 사용자 변경을 허용하고,
  `pr_review_relation_edge`는 사용자 mutation을 허용하지 않는다.
- 시스템 shape 생성과 도메인 metadata 갱신은 PR Review materialization이 담당한다.
- `contentHash`는 서버가 canonical shape content 기준으로 계산한다.
