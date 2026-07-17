# Canvas Agent

Canvas Agent의 read-only job과 기존 Canvas shape 검색/화면 안내 흐름을 관리한다.

- 사용자 요청을 기능 설명, 기존 shape 검색, 선택, viewport 이동 단계로 변환한다.
- 새 run의 `create_draft`와 `connect_shapes` 실행을 차단한다.
- agent job 상태와 repository 접근을 한 모듈 안에서 조립한다.

과거 preview draft의 apply/discard 코드는 호환성을 위해 남아 있지만 새 run에서는
draft를 만들지 않는다. shape revision, operation log와 실제 DB mutation 규칙은
`shape/`와 `operation/`이 소유하며 Agent가 해당 규칙을 우회해 직접 저장하지 않는다.
