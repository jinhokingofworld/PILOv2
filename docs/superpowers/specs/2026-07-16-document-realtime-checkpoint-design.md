# 문서 Realtime Checkpoint 단일화 설계

## 배경

현재 문서 편집기는 각 browser가 Yjs update를 받은 뒤 같은 App Server snapshot API를
호출한다. 여러 사용자가 동시에 편집하면 같은 `expectedVersion`으로 저장 요청이
경쟁하고, App Server의 optimistic concurrency guard가 `409 Document version is outdated`를
반환한다.

이 설계는 snapshot 저장 주체를 Hocuspocus room이 실행되는 realtime-server 프로세스 하나로
바꾼다. browser는 Yjs sync와 awareness만 수행한다.

## 확정 구조

```text
Browser
  <-> Hocuspocus /sync/documents room
        - Yjs update merge, awareness
        - onLoadDocument: App Server 최신 snapshot bootstrap
        - onStoreDocument: 1초 debounce checkpoint
  -> App Server 기존 document snapshot API
        - bearer membership 재검증
        - version 증가, snapshot/activity transaction
```

`onAuthenticate` context는 `userId`, room ref와 bearer token을 가진다. checkpoint는 마지막
Yjs change의 context token으로 기존 App Server API를 호출한다. token은 DB나 log에 저장하지
않는다. 이 token은 membership 재검증과 기존 transaction actor를 위한 transport memory일 뿐이다.

Hocuspocus `onLoadDocument`는 App Server bootstrap snapshot의 `yjsState`를 room document에
적용하고 해당 document의 현재 snapshot version을 process memory에 둔다. `onStoreDocument`는
Hocuspocus가 제공하는 document별 1초 debounce와 mutex 안에서 실행된다. room의 Yjs state와
Tiptap JSON을 저장하고 성공한 version을 갱신한다. 마지막 socket이 떠날 때와 process shutdown에는
Hocuspocus pending store를 즉시 flush한다.

## Conflict와 복구

정상 경로에서는 한 realtime process의 한 room만 snapshot을 저장하므로 browser 사이의 409가
발생하지 않는다. 409는 이전 browser build가 아직 직접 저장 중이거나, 복수 realtime task가 같은
room을 처리하는 비정상 경계에서만 발생할 수 있다. 이 경우 realtime-server는 최신 snapshot을 다시
읽어 room Y.Doc에 병합하고 현재 version으로 한 번 재시도한다.

room state는 process memory다. 따라서 현재 deployment 전제인 realtime-server 단일 task 또는
`/sync/documents` sticky routing이 필요하다. realtime-server 재시작 시 마지막 checkpoint 뒤 최대
1초의 변경만 유실될 수 있다.

## Frontend 전환

realtime provider가 구성된 문서는 browser snapshot API를 호출하지 않는다. 저장 상태는 local
snapshot 성공 여부가 아니라 realtime connection 상태로 표현한다. realtime URL 또는 access token이
없는 단일 browser fallback에서는 기존 client autosave를 유지한다.

이 전환은 server checkpoint와 같은 PR에서 적용한다. 둘 중 하나만 배포하면 기존 browser autosave와
server checkpoint가 다시 경쟁할 수 있다.

## 제외 범위

- raw `document_yjs_updates` append-only log
- 새 public API, DB migration, custom Yjs protocol
- 다중 realtime task 간 document replication
- RAG와 MeetingReport integration

## 검증

- realtime-server unit test: load, debounce store, last connection flush, 409 rebase/retry
- frontend contract test: realtime configured 문서는 direct snapshot save를 하지 않음
- fallback test: realtime 미구성 단일 browser는 기존 autosave 유지
- dev 5인 E2E: 동시 입력, 탭 종료, 재연결, 새로고침 후 보존, browser console에 document snapshot 409 없음
