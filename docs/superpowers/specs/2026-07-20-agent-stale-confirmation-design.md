# Agent stale confirmation 재검증 설계

## 목적

Agent가 SQLtoERD schema 교체 또는 Calendar 일정 수정을 제안한 뒤 승인되기 전에 대상이 바뀌면, 오래된 confirmation으로 최신 상태를 덮어쓰지 않는다. 서버가 confirmation 생성 시 읽은 상태 token을 저장하고 실제 도메인 transaction 안에서 비교한 뒤 일치할 때만 mutation과 후속 side effect를 수행한다.

## 선택한 접근

- SQLtoERD `replace_current`는 `expectedSessionRevision`과 `expectedModelFingerprint`를 모두 비교한다. 둘 중 하나라도 바뀌면 strict stale로 처리한다.
- Calendar는 새 revision 컬럼을 만들지 않고 기존 `updatedAt`을 `expectedUpdatedAt` optimistic concurrency token으로 사용한다.
- token은 Planner나 승인 요청에서 새로 받지 않는다. confirmation plan의 server-owned `call`에 저장하고 tool의 `buildConfirmationInput`으로만 복원한다.
- SQLtoERD fingerprint 계산은 Agent 전용 파일에서 SQLtoERD 도메인 helper로 이동하되 기존 Agent export는 유지한다.
- stale 오류는 기존 confirmation 상태 모델을 바꾸지 않고 domain conflict로 실행을 실패시킨다. 사용자는 최신 상태로 새 confirmation을 만들어야 한다.

## 대안과 제외 이유

1. Calendar에 정수 revision 컬럼 추가: 명확하지만 migration과 공개 API 확장이 필요해 이번 최소 변경 범위를 넘는다.
2. Agent 공통 confirmation service에 도메인별 stale 검사를 추가: 도메인 규칙이 공통 계층에 새어 나오므로 제외한다.
3. SQLtoERD에서 fingerprint만 비교해 layout-only revision 변경을 허용: 이슈 완료 기준이 revision과 fingerprint 모두의 strict 재검증이므로 제외한다.

## SQLtoERD 흐름

1. `prepareGenerate`가 현재 session의 revision과 model fingerprint를 confirmation plan에 저장한다.
2. `replace_current` 선택 시 두 token을 포함한 confirmed input을 복원한다. 과거 plan에 token이 없으면 fail-closed한다.
3. `replaceAgentGeneratedSchema`가 session row를 잠그고 기존 agent operation을 먼저 조회한다.
4. 이미 성공한 동일 run이면 기존 idempotent 결과를 반환한다.
5. 새 실행이면 현재 revision과 model fingerprint를 비교하고 불일치 시 conflict를 발생시킨다.
6. 일치할 때만 source snapshot, operation, outbox, Activity Log를 기록한다.

`new_session`은 현재 session을 덮지 않으므로 stale token이 없어도 실행할 수 있다.

## Calendar 흐름

1. selector가 정확히 한 event를 다시 조회한 뒤 그 `updatedAt`을 plan의 `expectedUpdatedAt`에 저장한다.
2. Calendar tool의 `buildConfirmationInput`이 event ID, changes, expected token을 저장된 plan에서 복원한다.
3. `CalendarService.updateEvent`는 Agent 내부 호출에만 optional expected token을 받는다. 공개 controller 호출은 기존과 같이 token 없이 동작한다.
4. transaction의 `FOR UPDATE` 조회 직후 현재 `updated_at`과 expected token을 비교한다.
5. 불일치 시 UPDATE, Activity Log, Google Calendar sync outbox 없이 conflict를 발생시킨다.

## 오류와 호환성

- 과거 SQLtoERD `replace_current` plan과 Calendar update plan에 token이 없으면 실행하지 않는다.
- 과거 SQLtoERD `new_session` plan은 현재 session을 변경하지 않으므로 계속 실행 가능하다.
- 공개 SQLtoERD/Calendar HTTP endpoint request 계약과 DB schema는 변경하지 않는다.
- 정상적인 기존 idempotency와 source lock 검사는 유지한다.

## 최소 검증

- SQLtoERD Agent plan token 저장·복원
- SQLtoERD revision stale, fingerprint stale, 성공 후 idempotent replay
- Calendar Agent plan token 저장·복원
- Calendar transaction stale 거부와 mutation/Activity Log/sync side effect 0건
- 관련 네 개 스크립트와 App Server TypeScript build만 실행

