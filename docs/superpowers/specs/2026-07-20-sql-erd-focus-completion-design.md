# SQL ERD 집중 보기 완료 흐름 설계

## 배경

`focus_sql_erd_tables` 도구는 집중할 테이블을 계산하고 `table_focus` resource ref를 정상 생성한다. 그러나 현재 도구 정의의 `completesRunAfterExecution: true`가 실행 계층에서 `waitForUserInput: true`로 변환된다. 그 결과 run은 `completed`가 아니라 `waiting_user_input`이 되고, 완료된 run만 resource link를 노출하는 프런트엔드에서 `집중 보기 열기`가 사라진다.

또한 현재 SQL ERD 화면과 resource ref의 세션이 같아도 사용자가 링크를 눌러야만 집중 보기가 적용된다. 자연어 명령의 결과가 실제 화면 상태로 이어지지 않아 성공 메시지와 화면이 어긋날 수 있다.

## 목표

- 도구 실행 뒤의 상태 전이를 명시적인 계약으로 표현한다.
- `focus_sql_erd_tables` 성공 시 tool step과 run을 하나의 트랜잭션에서 완료한다.
- 현재 SQL ERD 세션에 대한 결과는 한 번만 자동 적용한다.
- 다른 세션의 결과는 자동 이동하거나 적용하지 않고 사용자가 링크로 열게 한다.
- 자동 적용 후에도 링크를 남겨 다시 적용할 수 있게 한다.
- 성공 문구가 실제 UI 변경을 과장하지 않게 한다.

## 비목표

- SQL ERD 모델, DB schema, migration을 변경하지 않는다.
- 직접 FK 검증이나 fingerprint/revision 검증 규칙을 완화하지 않는다.
- Agent의 모든 도구 실행 정책을 재설계하지 않는다.
- 다른 세션으로 자동 탐색하지 않는다.

## App Server 설계

### 명시적인 실행 후 상태

`AgentToolDefinition`의 모호한 boolean인 `completesRunAfterExecution`을 다음 disposition으로 대체한다.

- `continue_planning`: 다음 planner turn을 실행한다.
- `wait_for_user_input`: tool step을 완료하고 run을 사용자 입력 대기로 전환한다.
- `complete_run`: tool step과 run을 완료한다.

정의가 없는 기존 도구는 `continue_planning`을 기본값으로 사용한다. `focus_sql_erd_tables`는 `complete_run`을 선언한다.

### 원자적 완료

tool step 완료 처리 함수는 disposition을 입력으로 받고 동일 트랜잭션 안에서 다음을 처리한다.

1. tool step의 output과 `resourceRefs`를 저장하고 step을 완료한다.
2. `complete_run`이면 run의 `status`, `message`, `final_answer`, `completed_at`을 완료 상태로 갱신한다.
3. 완료된 assistant message를 기록한다.
4. `continue_planning`인 경우에만 다음 turn을 queue한다.

이렇게 하면 성공한 resource ref가 저장됐지만 run이 완료되지 않는 중간 상태를 만들지 않는다.

### 사용자 메시지

집중 보기 formatter는 “집중 표시했습니다” 대신 “집중 보기 결과를 준비했습니다”를 사용한다. App Server는 결과 resource를 준비했다는 사실만 보장하고, 실제 UI 적용 여부는 클라이언트가 결정한다.

## Frontend 설계

### 같은 세션 자동 적용

완료된 run에서 `table_focus` resource link를 추출한다. 현재 화면의 Agent request context가 SQL ERD이고 `sessionId`가 resource ref와 같으면 `stageSqlErdAgentTableFocus`를 호출한다. 이 함수는 session storage와 같은 페이지 이벤트를 함께 갱신하므로 SQL ERD 화면은 즉시 집중 상태를 반영한다.

### 중복 방지

polling과 최종 fetch가 같은 run을 여러 번 전달할 수 있으므로 `runId + stepId + modelFingerprint`를 key로 사용해 위젯 생명주기 동안 한 번만 자동 적용한다. 적용에 실패하면 key를 소비하지 않아 다음 갱신에서 재시도할 수 있게 한다.

### 다른 세션과 수동 재적용

현재 세션과 다른 결과는 자동 적용하거나 자동 탐색하지 않는다. 기존 `집중 보기 열기` 링크를 표시해 사용자가 명시적으로 이동하게 한다. 같은 세션에 자동 적용한 경우에도 링크를 유지해 사용자가 “전체 보기” 이후 다시 적용할 수 있게 한다.

## API 영향

endpoint와 request/response 필드 형식은 바뀌지 않는다. 다만 `focus_sql_erd_tables` 성공 run의 최종 상태가 `waiting_user_input`에서 의도한 `completed`로 바뀐다. `docs/api/agent-api.md`에 이 상태와 resource ref 노출 조건을 명시한다.

## 오류 처리와 보안

- compact table ref, direct FK, `sessionRevision`, `modelFingerprint` 검증은 기존 로직을 유지한다.
- 세션 불일치 resource는 자동 적용하지 않는다.
- resource ref에 저장된 식별자만 사용하고 자연어 답변을 다시 파싱하지 않는다.
- 자동 적용 실패는 채팅 완료 상태를 되돌리지 않으며 기존 링크를 fallback으로 남긴다.

## 최소 검증

- App Server: `focus_sql_erd_tables` 성공 시 run이 `completed`이고 저장된 `resourceRefs`가 run 조회에 남는지 확인한다.
- Frontend: 같은 세션 결과는 정확히 한 번 자동 적용되고, 다른 세션은 자동 적용되지 않으며, 링크는 계속 렌더링되는지 확인한다.
- 기존 SQL ERD 도구 테스트를 실행해 direct FK와 stale fingerprint 검증이 유지되는지 확인한다.
- 전체 테스트 대신 위 동작을 직접 다루는 Agent/SQL ERD 테스트만 실행한다.
