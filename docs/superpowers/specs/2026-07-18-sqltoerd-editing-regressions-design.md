# SQLtoERD 편집·결과 이동 회귀 수정 설계

## 목적

Issue #1424에서 확인된 SQLtoERD schema 편집, Canvas annotation, SQL diff, Agent 결과 이동 회귀를 하나의 일관된 수정으로 해결한다. durable schema 변경은 기존의 `model mutation -> normalized DDL preview -> parse/semantic 검증 -> source lock -> source_snapshot publish` 경로를 유지한다.

API 계약과 DB schema는 변경하지 않는다. Frontend 공통 영역으로 코드를 이동하지 않고 SQLtoERD 및 Agent feature 내부에서 해결한다.

## 확정한 사용자 동작

- 컬럼 삭제나 변경으로 DDL을 재생성할 때 known portable type은 선택 dialect의 실제 타입으로 정규화한다. `UUID`는 PostgreSQL `UUID`, MySQL `CHAR(36)`, SQLite `TEXT`로 취급한다.
- 안전하게 정규화할 수 없는 타입은 raw parser stack 대신 table, column, dialect, type을 포함한 사용자 오류로 차단한다.
- Canvas에서 실제 FK relation을 Delete/Backspace로 삭제하면 relation shape만 지우지 않고 기존 FK 삭제 candidate와 SQL diff 승인 흐름을 사용한다.
- note와 text, 잠금 해제된 frame은 tldraw resize handle로 크기를 바꿀 수 있다. frame 잠금은 이동과 resize를 계속 차단한다.
- Workspace 저장 상태에는 내부 `opSeq`를 표시하지 않는다.
- Inspector의 column 편집은 source lock 획득 상태와 비활성화 이유를 표시한다. lock을 획득하면 열린 diff의 Apply가 자동으로 활성화된다.
- SQL diff는 변경 전과 변경 후를 좌우로 나누고 각 pane에 line number를 표시한다. 여러 변경 구간은 line diff 결과에 맞춰 정렬한다.
- Agent의 SQLtoERD resource link가 현재와 같은 pathname의 다른 `sessionId`를 가리켜도 session 화면이 새 ID를 읽어 다시 로드한다.
- DDL reparse는 숫자·문자열뿐 아니라 boolean, `NULL`, `CURRENT_DATE`, `CURRENT_TIMESTAMP` 기본값을 model 표현으로 복원한다.

## 설계

### Dialect 타입과 semantic round trip

`model-to-sql.ts`에 pure normalization 계층을 둔다. known alias만 변환하고 변환된 model을 DDL 생성 결과와 함께 반환해 source와 model이 서로 다른 타입을 보유하지 않게 한다. preview는 이 normalized model을 target model로 사용하고 변환 경고를 diff와 함께 표시한다. 알 수 없는 타입을 임의 타입으로 바꾸지 않는다.

`ddl-parser.ts`의 default formatter는 AST 종류를 명시적으로 처리한다.

- number: 원래 숫자 문자열
- single quoted string: SQL escaping을 보존한 문자열
- bool: `TRUE` 또는 `FALSE`
- null: `NULL`
- zero-argument current date/time function: `CURRENT_DATE` 또는 `CURRENT_TIMESTAMP`

지원하지 않는 expression default는 기존처럼 안전하게 실패시키되 model 비교를 거짓으로 통과시키지 않는다.

### FK 삭제

schema delete shortcut의 대상에 `relation`을 추가한다. 선택 relation shape의 사용자 delete는 tldraw 기본 삭제를 차단하고 panel callback으로 전달한다. panel은 기존 `createSqlErdForeignKeyDeleteCandidate`를 호출해 model과 source를 함께 바꾸는 SQL diff를 연다. annotation link 삭제 경로는 layout-only 동작으로 유지한다.

### Annotation resize

note/frame/text shape util에 tldraw `resizeBox`를 `onResize`로 연결한다. 기존 annotation transform sync가 `x`, `y`, `width`, `height` patch를 발행하므로 저장 경로는 바꾸지 않는다. 잠긴 frame의 `canResize` 및 `onBeforeUpdate` guard를 유지한다.

### Inspector와 저장 상태

column 편집 form은 현재 session/draft 조건을 유지하되, diff dialog에 source lock 상태를 표시한다. lock 획득 중에는 `SQL 편집 잠금을 확인하는 중입니다`, 다른 사용자가 보유하면 기존 read-only message를 보여준다. 내부 operation sequence 대신 성공 상태만 표시한다.

### Split diff

`diff` 패키지의 line diff를 작은 pure adapter로 변환한다. 각 row는 before/after line과 line number를 독립적으로 보유한다. 삭제 묶음과 추가 묶음은 같은 hunk 안에서 행 단위로 짝지어 좌우 정렬하고 한쪽이 짧으면 빈 cell을 둔다. dialog는 하나의 scroll container 안에 고정된 두 column을 렌더링한다.

### Same-route Agent navigation

`SqlErdSessionPage`는 mount-only `window.location.search` state를 제거하고 Next `useSearchParams()`에서 `sessionId`를 파생한다. query 변경 시 `SqlErdPanel`에 새 ID가 전달돼 session load lifecycle이 다시 실행된다. resource link allowlist와 URL 형식은 변경하지 않는다.

## 오류 처리와 경계

- unknown dialect type은 임의 매핑하지 않는다.
- SQL diff Apply 전에는 source/model을 변경하지 않는다.
- FK Delete는 실제 relation에만 적용하고 설명 annotation은 layout delete로 유지한다.
- source lock 미보유자는 preview를 검토할 수 있지만 Apply할 수 없다.
- route query에 유효한 session ID가 없으면 기존 session 선택 안내를 유지한다.
- default expression을 복원할 수 없으면 semantic mismatch를 숨기지 않는다.

## 테스트

- UUID dialect normalization과 unknown type 차단
- boolean/null/current date/time default round trip
- relation Delete shortcut과 기본 shape delete 차단
- note/text/unlocked frame resize handler, locked frame guard
- operation sequence 비노출
- split diff row alignment과 line number
- same pathname에서 session query 변경
- 기존 SQLtoERD, Agent, realtime test와 production build

