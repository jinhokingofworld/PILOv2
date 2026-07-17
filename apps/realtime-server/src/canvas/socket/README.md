# Canvas Socket

classic Canvas Socket.IO 경계를 담당한다.

- `canvas-socket-events.ts`: client/server 이벤트 이름
- `canvas-socket-payloads.ts`: 외부 payload 런타임 검증과 정규화
- `canvas-socket-types.ts`: 인증된 Canvas socket의 data 타입
- `canvas-socket-handlers.ts`: join, leave, presence, viewport hydrate, shape
  patch, history, preview와 disconnect handler 등록

공용 `src/socket/socket-server.ts`는 service를 조립하고 이 폴더의 등록 함수를
호출한다. Canvas 동작을 추가할 때 공용 socket bootstrap에 handler 본문을 다시
넣지 않는다.
