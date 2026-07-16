# 문서 Realtime Checkpoint 단일화 실행 계획

> 관련 이슈: #1245
> 설계: `docs/superpowers/specs/2026-07-16-document-realtime-checkpoint-design.md`

## 목표

여러 브라우저가 같은 문서 snapshot을 직접 저장하면서 발생하는 `409 Document version is outdated` 경쟁을 없앤다. Realtime Server의 Hocuspocus room이 문서 상태를 한 번만 checkpoint하고, 브라우저는 Yjs 동기화와 awareness만 담당한다.

## 작업 순서

### 1. Realtime Server checkpoint 서비스

- [x] App Server의 기존 문서 조회/snapshot API를 호출하는 `DocumentAppServerClient`를 만든다.
- [x] Yjs 문서 상태를 base64 snapshot과 ProseMirror JSON으로 직렬화하는 `DocumentCheckpointService`를 만든다.
- [x] 서버가 보유한 현재 버전으로 저장하고, 예상하지 못한 409에는 최신 snapshot을 merge한 뒤 한 번만 재시도한다.
- [x] 테스트를 먼저 작성해 정상 저장, 409 merge/retry, 두 번째 409 실패를 검증한다.

### 2. Hocuspocus lifecycle 연결

- [x] 인증 context에 메모리 내 access token을 포함한다. token은 DB나 activity log에 저장하지 않는다.
- [x] `onLoadDocument`에서 App Server snapshot을 room으로 복원한다.
- [x] `onStoreDocument`에서 Hocuspocus의 1초 debounce와 room mutex를 이용해 checkpoint한다.
- [x] 마지막 연결 종료 및 서버 종료에서 보류 중인 checkpoint를 flush한다.
- [x] lifecycle 테스트와 route contract 테스트를 먼저 실패시키고 통과시킨다.

### 3. Frontend snapshot 소유권 전환

- [x] realtime provider가 연결된 경우 브라우저의 update 기반 snapshot autosave와 unmount flush를 수행하지 않는다.
- [x] realtime 설정이 없는 로컬/장애 fallback에서는 기존 browser snapshot autosave를 유지한다.
- [x] 회의록 activity log를 포함한 기존 App Server snapshot transaction은 서버 checkpoint 호출을 통해 그대로 실행됨을 확인한다.
- [x] 선택 로직의 단위 테스트와 기존 문서 realtime 테스트를 통과시킨다.

### 4. 운영 문서와 검증

- [x] Drive API 문서와 Realtime README에 checkpoint 소유권, fallback, 단일 realtime task 또는 `/sync/documents` sticky routing 요구사항을 반영한다.
- [x] realtime-server 및 frontend의 format, lint, test, build를 실행한다.
- [ ] 5명 동시 편집, 재접속, 마지막 사용자 이탈 직후 재접속을 dev 환경에서 수동 QA한다. (dev 배포 후 수행)

## 완료 기준

- realtime이 연결된 여러 브라우저는 `PUT /snapshot`을 직접 호출하지 않는다.
- 저장은 room별로 단일 realtime server checkpoint만 수행한다.
- 기존 App Server의 멤버 권한, optimistic version, activity log transaction은 유지한다.
- multi-task realtime 배포는 이번 범위에 포함하지 않으며 단일 task 또는 sticky routing을 운영 전제에 명시한다.
