# Canvas Room

사용자가 Canvas room에 들어갈 수 있는지 확인하고 입장 시 필요한 초기 상태를
조립한다.

- `canvas-access.service.ts`: session 사용자의 workspace/canvas 접근 권한 확인
- `canvas-room.service.ts`: room 이름, read-only 여부, presence, preview,
  loaded region과 초기 viewport hydrate 결과 조립

room은 shape 상태를 따로 소유하지 않는다. classic Canvas의 authoritative
in-memory 상태는 `state/`의 `CanvasRoomStateService`에서만 관리한다.
입장 시에는 DB initial viewport를 baseline으로 조회한 뒤, socket room join 직후의
최신 roomState와 tombstone을 Shape ID 단위로 병합해 응답한다. 입장 자체는 DB 저장을
강제하지 않는다.
