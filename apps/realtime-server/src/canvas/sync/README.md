# Canvas tldraw Sync

`engine_type = 'tldraw_sync'`인 freeform Canvas의 `@tldraw/sync` room lifecycle을
관리한다.

접근 권한을 확인한 뒤 room을 지연 생성하고, 마지막 연결이 종료되면 메모리 상태를
정리할 수 있다. 복구 snapshot은 `canvas_sync_documents`를 사용하며 classic
Canvas roomState, shape batch와 operation history에는 섞지 않는다.
