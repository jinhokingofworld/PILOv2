# Canvas Collaboration

## 담당하는 것

- Canvas room 입장과 퇴장
- presence와 remote cursor 상태
- operation 순서와 catch-up
- roomState shape patch와 preview event
- room history 명령

## 담당하지 않는 것

- shape의 DB 저장 형식
- tldraw editor에 shape를 직접 생성하거나 삭제하는 동작
- Canvas toolbar UI

## 시작해서 읽을 파일

`useCanvasRoom.ts`

이 hook은 Canvas room의 외부 인터페이스를 제공하며 한 runtime에서 한 번만 호출한다.
