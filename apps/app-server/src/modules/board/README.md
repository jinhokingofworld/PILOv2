# Board Module

Owner: 주형

API contract: `docs/api/board-api.md`

범위:

- GitHub ProjectV2 기반 board hydrate
- board, column, issue card 조회
- kanban 화면용 read model

주의:

- GitHub 원본 조회와 sync는 GitHub Integration API를 사용한다.
- Board issue 생성과 delivery option 조회는 같은 target eligibility 검증을 재사용한다. repository와 ProjectV2가 동일한 active installation에 연결된 경우에만 생성 가능하며, 응답에는 Board/Column의 `id`, `name`만 노출한다.
- installation 삭제로 분리됐거나 서로 다른 installation을 가리키는 Board는 cache identity를 유지하되 재연결 sync가 완료될 때까지 생성 대상에서 제외한다.
- ProjectV2 write API는 MVP 범위가 아니다.
