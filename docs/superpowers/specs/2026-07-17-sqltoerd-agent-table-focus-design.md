# SQLtoERD Agent 테이블 집중 보기 설계

## 목적

Workspace 총괄 AI 챗봇에서 사용자가 특정 기능과 관련된 테이블을 요청하면 SQLtoERD 세션의 구조를 읽고 핵심 테이블과 직접 관련 테이블을 선정한다. 사용자는 SQLtoERD 세션에 직접 들어가 대상을 찾지 않아도 Agent 결과 링크로 이동해 관련 테이블에 집중할 수 있다.

집중 보기는 데이터 접근 제어가 아니라 이미 열람 권한이 있는 ERD를 이해하기 쉽게 만드는 일회성 UI이다. SQL source, model 또는 layout을 수정하지 않는다.

## 확정한 사용자 동작

- Workspace에 활성 SQLtoERD 세션이 하나면 자동으로 선택한다.
- 세션이 여러 개이고 사용자가 대상을 지정하지 않았으면 제목, 최근 수정 시각, 테이블 수를 후보로 보여주고 사용자가 선택하게 한다. Agent가 임의로 정본을 선택하지 않는다.
- 자연어 요구와 직접 일치하는 테이블은 `primary`로 분류한다.
- `primary` 테이블과 직접 FK로 연결되고 기능상 의미가 있는 테이블은 `related`로 분류한다.
- 기본 분석은 직접 FK 관계까지만 포함한다. 2단계 이상 확장은 사용자가 명시적으로 더 넓은 범위를 요청할 때 별도 분석한다.
- 집중 보기 중 `primary`와 `related` 테이블은 선명하게 표시하고 나머지 테이블과 선택 범위 밖 FK relation은 흐리게 표시한다.
- 흐려진 테이블과 relation은 선택, 편집, 관계 연결을 차단한다. Canvas 이동과 확대·축소는 허용한다.
- Canvas 상단 배너의 `전체 보기` 버튼으로 집중 보기를 즉시 해제한다.
- 집중 상태는 session에 저장하지 않는다. 새로고침하거나 다른 session으로 이동하면 해제한다.

## 대안 검토

### 단일 도구에서 별도 LLM 호출

App Server 도구가 model을 읽고 내부에서 LLM을 다시 호출하면 한 번의 도구 실행으로 끝낼 수 있다. 그러나 이미 실행 중인 Agent planner와 별도의 모델 호출, 비용, 오류 처리가 생기며 현재 App Server 도구의 결정론적 실행 경계를 벗어난다.

### 결정론적 이름 및 FK 점수화

서버가 테이블명, 컬럼명, FK 거리만으로 대상을 고를 수 있다. 구현은 단순하지만 한글 기능명과 영문 schema 사이의 의미 대응이나 업무 도메인 판단이 약하다. schema projection에서 중요한 컬럼을 고르는 보조 규칙으로만 사용한다.

### 두 단계 Agent 도구

첫 도구가 검증되고 제한된 schema projection을 제공하고, 기존 Agent가 이를 근거로 역할을 분류한다. 두 번째 도구는 선택 결과를 현재 session으로 다시 검증하고 프런트엔드에 전달한다. 기존 다단계 Agent 실행 구조를 재사용하고 App Server의 실행을 결정론적으로 유지할 수 있어 이 방식을 채택한다.

## Agent 도구 계약

### `inspect_sql_erd_schema`

위험도는 `low`, 실행 모드는 `auto`이다. 도구는 session을 변경하지 않는다.

입력은 다음 selector와 사용자 질의를 받는다.

- `featureQuery`: 사용자가 찾는 기능을 나타내는 1~200자 문자열
- `sessionId`: 사용자가 특정 session을 지정했거나 SQLtoERD 화면 문맥이 검증된 경우 사용하는 UUID
- `sessionTitle`: 사용자가 제목으로 특정 session을 지정한 경우 사용하는 제한된 문자열

선택 규칙은 명시적 `sessionId`, 정확한 `sessionTitle`, 단일 활성 session 순서이다. 선택할 수 없으면 최대 5개의 후보를 포함한 `needs_clarification` 결과를 반환한다. 후보에는 ID를 사용자 문장에 노출하기 위한 용도가 아니라 후속 선택 검증을 위한 resource ref로만 포함하고, 제목, 수정 시각, 테이블 수, relation 수를 제공한다.

성공 결과는 다음을 포함한다.

- session ID, 제목, revision, dialect
- 모든 테이블의 revision 한정 compact ref(`t1`, `t2`), 이름, 선택적으로 schema 이름과 제한된 comment
- 테이블별 주요 컬럼의 이름, PK/FK 여부, 제한된 comment
- FK relation의 양 끝 compact table ref
- projection에서 생략된 컬럼이 있는지를 나타내는 값

compact ref는 현재 model의 table 선언 순서로 결정하며 해당 session revision에서만 유효하다. 긴 내부 table ID를 relation마다 반복하지 않아 큰 schema에서도 전체 FK 인접 그래프를 우선 전달할 수 있다. 두 번째 도구가 같은 revision의 model에서 compact ref를 실제 table ID로 다시 변환한다.

Agent step output의 저장 한도는 64KB지만 AI Worker가 다음 planner turn에 전달하는 전체 planning context는 12,000자이다. 따라서 inspect projection 자체는 최대 9,000자의 더 엄격한 budget으로 조립한다. 모든 table ref와 제한된 이름, 모든 FK edge를 먼저 포함하고 남은 budget에 schema 이름, table comment와 주요 컬럼을 추가한다. 컬럼은 PK/FK, `featureQuery`와 이름이 일치하는 항목, 나머지 선언 순서 순으로 선택한다. 각 이름과 comment도 개별 길이를 제한하며 생략 여부를 명시한다. 원문 SQL, 내부 table/column ID, 전체 modelJson, default value, constraint 원문은 반환하지 않는다.

### `focus_sql_erd_tables`

위험도는 `low`, 실행 모드는 `auto`이다. 입력은 다음 값을 받는다.

- `sessionId`
- `sessionRevision`
- `featureLabel`: 배너와 결과 설명에 사용할 1~100자 문자열
- `primaryTableRefs`: projection에 존재하는 중복 없는 1개 이상의 compact table ref
- `relatedTableRefs`: projection에 존재하고 primary와 겹치지 않는 compact table ref
- `confidence`: `high`, `medium`, `low`
- `reasons`: 선택한 table별 제한된 사실 근거

도구는 현재 session을 다시 읽어 revision을 검증하고 compact ref를 현재 model의 실제 table ID로 변환한다. 각 related table은 적어도 하나의 primary table과 직접 FK로 연결돼야 한다. 조건을 만족하지 않는 입력은 적용하지 않는다. 표시할 relation ID는 AI 입력을 신뢰하지 않고 현재 model에서 서버가 계산한다.

성공 결과는 table 이름과 역할, relation ID, confidence와 제한된 근거를 제공한다. resource ref는 기존 SQLtoERD session ref를 사용하고 다음 metadata를 추가한다.

```json
{
  "version": 1,
  "view": "table_focus",
  "sessionRevision": 12,
  "featureLabel": "결제 기능",
  "primaryTableIds": ["table-orders"],
  "relatedTableIds": ["table-payments"],
  "relationIds": ["relation-order-payment"],
  "confidence": "medium"
}
```

metadata에는 modelJson, SQL, column 전체, 사용자 prompt 원문을 넣지 않는다.

## Agent planner 동작

AI Worker planner는 사용자가 특정 기능과 관련된 SQLtoERD 테이블을 찾거나 보여달라고 요청하면 먼저 `inspect_sql_erd_schema`를 호출한다. 완료된 projection만 근거로 핵심 테이블과 의미 있는 직접 FK 테이블을 나누고 `focus_sql_erd_tables`를 호출한다.

Planner는 내부 ID를 추측하지 않고 projection에 존재하는 compact ref만 사용한다. 모든 FK 이웃을 자동 포함하지 않으며, 기능상 포함 이유를 설명할 수 있는 직접 이웃만 related로 선정한다. projection이 부족하거나 의미가 모호하면 확정적인 표현 대신 사용자에게 범위를 구체화하도록 요청한다.

현재 Agent run은 최대 네 번의 tool 결과 후속 turn을 허용하므로 session 선택, schema 조회, focus 생성 흐름이 기존 한도 안에 들어온다.

## 프런트엔드 전달

resource URL은 기존 `/sql-erd/session?sessionId=...` allowlist를 유지한다. 긴 table ID 목록을 query나 hash에 넣지 않는다.

Agent resource link parser는 `table_focus` metadata를 엄격히 검증해 링크 view model에 포함한다. 사용자가 `집중 보기 열기`를 누르면 metadata를 session별 일회성 `sessionStorage` 값으로 기록하고 SQLtoERD session으로 이동한다. 이미 같은 session에 있으면 같은 payload를 window event로도 전달해 즉시 적용한다.

SQLtoERD session page는 자신과 같은 session ID이고 현재 session revision과 일치하는 payload만 한 번 소비하고 즉시 storage에서 제거한다. 이후 focus 상태는 React memory에만 둔다. 따라서 새로고침, session 이동 또는 `전체 보기`에서 사라진다. Agent run 기록에 resource metadata가 남는 것과 SQLtoERD session 상태 저장은 구분한다.

## Canvas 표현과 상호작용

집중 상태는 modelJson이나 tldraw shape props를 변경하지 않는다. Canvas 하위 React context에서 table과 relation의 역할을 계산해 shape renderer가 읽도록 한다. 이 방식으로 layout autosave와 realtime operation에 focus 상태가 섞이지 않게 한다.

- primary table: 기존 표현을 유지하고 명확한 강조 테두리를 추가한다.
- related table: blur 없이 유지하되 primary보다 약한 보조 강조를 사용한다.
- 나머지 table: blur와 낮은 opacity를 적용하고 pointer interaction을 끈다.
- 양 끝 table이 focus 범위 안인 FK relation: 선명하게 유지한다.
- 나머지 FK relation: blur와 낮은 opacity를 적용하고 hit target을 끈다.

focus 적용 시 기존 선택이 흐려지는 대상이면 selection을 해제한다. 메모, frame, text, stroke와 annotation link는 이번 MVP에서 변경하지 않는다.

Canvas 좌측 상단에는 `기능 집중 보기`, feature label, primary/related 개수, confidence를 표시하는 배너를 둔다. `전체 보기` 버튼은 로컬 focus 상태만 해제한다.

## 오류 처리

- 활성 session이 없음: Agent가 SQLtoERD session이 필요하다고 안내한다.
- session이 여러 개임: 후보 선택 질문을 반환한다.
- revision 불일치: stale 결과를 적용하지 않고 schema를 다시 조회하도록 한다.
- 존재하지 않는 table ID: focus 도구를 실패시키고 resource ref를 만들지 않는다.
- related table에 primary와 직접 FK가 없음: 해당 선택을 거부한다.
- metadata가 잘못됐거나 크기 제한을 넘음: 프런트엔드는 일반 session 링크만 제공하고 focus를 적용하지 않는다.
- session load 후 ID가 맞지 않음: payload를 폐기하고 일반 ERD를 표시한다.

## 보안과 로그

집중 보기는 이미 Workspace와 SQLtoERD session 접근 권한을 통과한 사용자에게만 제공한다. blur는 보안 경계가 아니다.

도구는 read-only이며 조회와 일시적 UI focus에 해당하므로 공통 Activity Log를 기록하지 않는다. Agent step의 기존 실행 로그만 남는다. SQL source, 원문 DDL, 전체 modelJson, Canvas raw shape, 비밀값은 output summary와 resource metadata에 저장하지 않는다.

## 계약 문서 변경

- `docs/api/agent-api.md`: 두 tool의 input/output, session 선택, resource metadata, planner 동작을 등록한다.
- `docs/api/sqltoerd-api.md`: Agent table focus가 session을 수정하지 않는 일시적 view임을 명시한다.
- `docs/api/incoming/*` 원본 초안은 변경하지 않는다.

이 변경은 Agent API 계약과 SQLtoERD 동작에 영향을 주므로 Agent와 sqltoerd 담당자 검토가 필요하다. DB schema와 migration은 변경하지 않는다. 변경 경로는 각 feature 디렉터리 안에 있어 Frontend 공통 영역과 App Server 공통 영역에는 해당하지 않는다.

## 테스트 전략

### App Server

- 단일 session 자동 선택과 여러 session clarification
- 명시적 session selector의 Workspace 접근 검증
- projection의 우선순위, 길이와 byte 제한
- revision 불일치, 잘못된 ID, 중복 ID 검증
- related table의 직접 FK 검증과 relation ID 서버 계산
- resource metadata에 원문 SQL/model이 포함되지 않는지 검증

### AI Worker

- 기능별 테이블 요청이 inspect tool로 routing되는지 검증
- completed inspect 결과로 focus tool을 호출하는지 검증
- 모든 FK 이웃을 무조건 포함하지 않고 primary/related를 구분하는지 평가
- 모호한 multi-session 결과에서 ID를 추측하지 않는지 검증

### Frontend

- 안전한 table focus metadata만 link로 변환
- link 클릭 시 one-shot payload 저장과 같은 session event 전달
- session mismatch와 malformed payload 폐기
- 새로고침과 전체 보기에서 focus 해제
- primary, related, dimmed table 시각 상태
- 범위 밖 table/relation interaction 차단과 Canvas navigation 유지
- focus 적용 시 dimmed selection 해제

## 범위 밖

- focus 결과를 SQLtoERD session 또는 DB에 저장
- URL 공유만으로 focus 상태 복원
- 2단계 이상 FK 자동 확장
- table/domain tag 또는 설명 metadata schema 추가
- SQL 또는 model 변경
- blur를 통한 데이터 접근 통제
- 메모, frame, text, stroke의 자동 숨김이나 blur
