# SQLtoERD focus 단일 도구와 혼합 resolver 설계

## 목적

SQLtoERD 집중 보기에서 공개 `inspect_sql_erd_schema`와 후속
`focus_sql_erd_tables`를 두 turn으로 실행하던 흐름을 하나의 공개 focus 도구로
통합한다. 현재 SQLtoERD 화면의 session은 서버가 소유한 request context에서
가져오며, 스키마 projection과 대상 선택은 App Server 내부에서 처리한다.

목표 흐름은 다음과 같다.

```text
Router -> Planner -> focus_sql_erd_tables({ featureQuery })
       -> server-owned schema inspection
       -> deterministic resolver
       -> 필요한 경우에만 bounded LLM fallback
       -> 직접 FK 확장 및 실행 직전 재검증
       -> focus resource
```

## 공개 계약

- `inspect_sql_erd_schema`는 Agent catalog와 planner 계약에서 제거한다.
- `focus_sql_erd_tables`의 공개 입력은 `featureQuery` 한 필드만 허용한다.
- focus는 `surface=sql_erd`와 유효한 `sessionId` request context에서만 실행한다.
- session UUID, revision, fingerprint, compact table ref는 Planner가 생성하거나
  전달하지 않는다.
- 기존 `AGENT_DOMAIN_SQL_ERD_READ_ENABLED`가 비상 차단 스위치다.

## server-owned inspect

App Server는 현재 사용자와 workspace membership으로 request context의 session을
조회한다. 저장된 `modelJson`과 `sourceText`에서 최대 9,000자의 bounded projection을
만들고 내부 resolver에만 전달한다. raw SQL, layout, UUID는 LLM 입력과 응답 계약에
넣지 않는다.

session 조회 시점의 model fingerprint를 보관하고, focus resource를 만들기 직전에
같은 session을 다시 읽어 fingerprint를 비교한다. layout-only revision 증가는 focus
대상 의미를 바꾸지 않으므로 허용하고 최종 resource에는 최신 revision을 넣는다.
model이 변경된 경우에만 결과를 적용하지 않고 최신 요청으로 다시 시도하도록
안내한다.

## 혼합 resolver

1. 결정적 단계는 정규화한 query token을 table/schema 이름, table/column comment,
   column 이름·type·enum 값과 비교한다.
2. 제외·부정 표현이 있는 query와 projection에서 이름이 잘린 table은 이름 기반 결정적
   일치를 사용하지 않는다. 잘린 table은 `truncatedTableRefs`로 표시한다.
3. 명시적 table 이름이 하나 이상 정확히 일치하거나, 고유하고 충분한 schema
   evidence가 있으면 이를 primary로 선택한다.
4. primary와 직접 FK로 연결된 모든 table을 related로 확장한다.
5. 결정적 결과가 없거나 복수 의미로 모호할 때만 bounded projection과 query를
   OpenAI strict JSON schema에 전달한다.
6. LLM 결과의 ref, 중복, role overlap, 직접 FK 관계와 evidence를 서버가 다시
   검증한다. 검증 실패는 focus로 적용하지 않는다.
7. provider 장애, timeout, 0건 또는 여전히 모호한 결과는
   `needs_clarification`으로 종료하고 resource를 만들지 않는다.

결정적 결과는 provider 호출을 생략해 일반적인 명시적 table 요청의 지연과 비용을
줄인다. 한국어 기능명처럼 schema identifier와 직접 맞지 않는 요청만 LLM fallback을
사용한다.

## 응답과 개인정보 경계

성공 응답과 frontend resource metadata는 기존 table focus v1 계약을 유지한다.
clarification은 제한된 질문과 reason taxonomy만 반환한다. Agent output, planner
context, 로그에는 raw SQL, provider payload, UUID, token을 새로 노출하지 않는다.

## hard cutover와 rollback

개발 환경이며 호환 대상 사용자가 없다는 전제에서 legacy inspect continuation,
Router bypass, inspect 후보 복구 코드를 함께 제거한다. 과거 run 재개 호환은 제공하지
않는다. 문제가 생기면 SQLtoERD read flag를 끄거나 직전 배포로 롤백한다. flag OFF가
legacy inspect를 복구하지는 않는다.

## 검증

- exact table 요청은 provider 없이 focus된다.
- 기능명 요청은 mock LLM fallback 후 FK 확장된다.
- 0건·모호한 결과·invalid provider ref·provider 장애는 resource 없이 clarification한다.
- session context 누락, 다른 workspace/user, revision/fingerprint 변경은 focus하지 않는다.
- capability catalog와 Planner에는 focus만 노출된다.
- 기존 frontend focus metadata 적용은 그대로 통과한다.
- 고정 fixture로 canonical, held-out, negative, ambiguous 결과를 오프라인 비교한다.

## 범위 밖

- SQLtoERD session 밖의 schema 검색
- 자유로운 schema 설명용 inspect Agent 도구
- DB migration 또는 realtime protocol 변경
- 실시간 shadow traffic과 legacy 호환 기간
- LLM이 raw SQL이나 내부 UUID를 직접 받는 resolver
