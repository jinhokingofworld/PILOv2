# Canvas Agent

Canvas Agent job, draft 생성, tool action과 배치 적용 흐름을 관리한다.

- 사용자 요청을 Canvas tool 단계와 draft shape로 변환한다.
- draft 배치와 placement를 검증하고 Canvas shape command 경계로 전달한다.
- agent job 상태와 repository 접근을 한 모듈 안에서 조립한다.

shape revision, operation log와 실제 DB mutation 규칙은 `shape/`와 `operation/`이
소유한다. Agent가 해당 규칙을 우회해 직접 저장하지 않는다.
