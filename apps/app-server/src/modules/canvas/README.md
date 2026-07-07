# Canvas Module

Owner: 동현

API contract: `docs/api/canvas-api.md`

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

주의:

- PR Review canvas는 자유형 canvas 테이블에 저장하지 않는다.
- PR Review 화면용 graph는 PR Review 모듈의 view model이다.
- `contentHash`는 서버가 canonical shape content 기준으로 계산한다.
