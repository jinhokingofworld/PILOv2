# Canvas Agent

Canvas Agent의 read-only job과 기존 Canvas shape 검색/화면 안내 흐름을 관리한다.

- 기능 설명 모드는 App Server가 명시적으로 라우팅한다.
- 일반 모드는 AI Worker가 분류한 `find_shapes` intent와 typed arguments를
  `route_intent`에서 검증한 뒤 기존 shape 검색으로 실행한다.
- 향후 intent를 추가하더라도 App Server에 등록된 handler만 실행한다.
- 새 run의 `create_draft`와 `connect_shapes` 실행을 차단한다.
- agent job 상태와 repository 접근을 한 모듈 안에서 조립한다.

과거 preview draft의 apply/discard 코드는 호환성을 위해 남아 있지만 새 run에서는
draft를 만들지 않는다. shape revision, operation log와 실제 DB mutation 규칙은
`shape/`와 `operation/`이 소유하며 Agent가 해당 규칙을 우회해 직접 저장하지 않는다.
