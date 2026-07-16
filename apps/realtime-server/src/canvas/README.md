# Realtime Canvas

classic Canvas의 Socket.IO 입구, roomState, checkpoint, presence와 tldraw sync
room을 관리한다.

API 계약은 `docs/api/canvas-api.md`를 따른다.

## 처리 흐름

```text
socket/socket-server.ts
  -> socket/registerCanvasSocketHandlers
    -> room/접근 확인 및 최초 hydrate
    -> state/roomState 변경과 history 기록
    -> checkpoint/App Server 저장 예약
    -> presence/preview/review-lock 실시간 상태 전달
```

`CanvasRoomStateService`가 classic Canvas room별 shape, tombstone, dirty shape,
checkpoint version과 history를 한곳에서 소유한다. 하위 helper는 계산만 담당하며
별도의 room 상태 저장소를 만들지 않는다.

## 폴더 구조

- `contracts/`: Canvas realtime payload와 내부 공유 타입
- `socket/`: Socket.IO 이벤트 이름, payload 검증, classic Canvas handler
- `room/`: Canvas 접근 확인, 입장 응답과 최초 viewport hydrate
- `state/`: roomState, tombstone, dirty shape, history와 순수 계산 helper
- `checkpoint/`: dirty operation을 App Server `/shapes/batch`에 저장
- `presence/`: 커서, 선택, 편집 의도처럼 저장하지 않는 사용자 상태
- `preview/`: 이동·크기 변경·삭제 중인 shape의 임시 미리보기
- `review-lock/`: PR Review conflict draft에서만 사용하는 임시 lock
- `sync/`: `tldraw_sync` Canvas의 sync room과 snapshot lifecycle

루트의 `canvas-*.ts` 파일은 기존 import를 깨뜨리지 않기 위한 compatibility
re-export다. 새 코드는 역할별 하위 폴더의 실제 구현을 직접 import한다.

## classic Canvas 저장 원칙

- shape patch는 서버 수신 순서대로 roomState와 history에 반영한다.
- 같은 shape를 여러 사용자가 수정해도 classic Canvas에서 shape lock으로
  편집을 차단하지 않는다. 최종 상태는 마지막으로 반영된 변경이 결정한다.
- 삭제는 명시적인 delete patch와 tombstone으로만 판단한다.
- viewport/API hydrate는 tombstone을 지우거나 삭제된 shape를 되살리지 않는다.
- dirty shape는 App Server가 checkpoint 성공을 확인하기 전에 제거하지 않는다.
- leave, disconnect와 graceful shutdown에서는 남은 dirty operation의 flush를
  시도한다.
- 일부 shape 저장이 실패하면 분리 가능한 요청을 나누어 정상 shape 저장을
  계속하고, 실패한 shape는 dirty 상태로 유지한다.

## presence와 preview

presence와 preview는 협업 화면을 위한 휘발성 상태다. DB에 장기 저장하지 않으며,
socket 종료 시 사용자별 상태를 정리하고 leave/clear 이벤트를 전달한다.

`review-lock/`의 lock은 classic Canvas 편집 정책이 아니다. PR Review conflict
draft의 임시 소유권 표시에만 사용한다.

## 접근 경계

- Bearer token is validated against `user_sessions`.
- Canvas가 workspace에 속하고 인증 사용자가 `workspace_members`에 포함되는지
  확인한다.
- completed Review Canvas는 presence 입장만 허용하고 shape 변경은 거부한다.

## 담당하지 않는 영역

- Long-term presence storage.
- CRDT 또는 Yjs 기반 classic Canvas 상태 병합
- App Server의 shape API 계약과 DB schema 정의
- `canvas_shape_operations`의 장기 operation 조회 API

## tldraw sync room

`sync/`는 `engine_type = 'tldraw_sync'`인 freeform Canvas만 다룬다.

```text
workspace:{workspaceId}:canvas:{canvasId}:tldraw-sync
```

접근 확인 후 room을 지연 생성하고, 복구 가능한 snapshot은
`canvas_sync_documents`에 저장한다. 이 상태를 classic Canvas의
`canvas_freeform_shapes`나 `canvas_shape_operations`에 섞지 않는다.
