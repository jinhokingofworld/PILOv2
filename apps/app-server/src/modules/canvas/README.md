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
- `canvas.service.ts`: 기존 Controller와 Canvas Agent가 사용하는 얇은 public facade
- `board/`: Canvas 목록, 생성, 상세와 viewport 설정
- `shape/`: shape 조회와 mutation, validation, mapper, content hash
- `operation/`: operation catch-up, activity log와 Redis publish
- `user-state/`: Canvas 입장과 퇴장 상태
- `policies/`: Canvas 접근 판정과 Review system shape 보호 정책
- `contracts/`: Canvas DB row, request, response, 내부 write 값 타입
- `infrastructure/`: soft-deleted shape 정리 같은 lifecycle 작업
- `agent/`: Canvas Agent run, step, draft API와 SQS planning/job boundary

호출 흐름:

```text
CanvasController
  -> CanvasService
    -> board / shape / operation / user-state service
```

`CanvasService`의 public method 이름과 API payload는 Classic Canvas 계약을 유지한다. shape
create/update/delete/batch는 `CanvasShapeCommandService`가 같은 transaction 안에서
처리하며, operation publish는 DB transaction이 끝난 뒤 실행한다.

Canvas 루트의 `canvas.types.ts`, `canvas-shape-hash.ts`,
`canvas-review-shape-policy.ts` 같은 파일은 기존 PR Review import 경로를 보존하는
호환 re-export다. Canvas 내부 구현은 각 기능 폴더의 실제 파일을 import한다.

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
