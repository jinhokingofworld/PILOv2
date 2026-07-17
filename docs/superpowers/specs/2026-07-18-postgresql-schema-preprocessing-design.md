# PostgreSQL 전체 스키마 ERD 전처리 설계

## 목적

SQLtoERD에 PostgreSQL 전체 schema 또는 migration을 입력했을 때 `CREATE
FUNCTION`, `CREATE TRIGGER`, `CREATE EXTENSION` 같은 ERD 비대상 statement 때문에
정상적인 `CREATE TABLE`까지 parsing되지 않는 문제를 해결한다.

SQL 원문은 수정하거나 삭제하지 않는다. ERD 모델 생성을 위해
`node-sql-parser`에 전달하는 입력만 별도로 구성한다.

## 범위

이번 작업은 PostgreSQL 입력의 최상위 statement 분류와 parser 입력 구성만
변경한다.

- `CREATE TABLE` statement를 ERD parser에 전달한다.
- `ALTER TABLE` statement를 ERD parser에 전달한다.
- `CREATE TYPE`과 `CREATE DOMAIN`의 선언 이름을 기존 parser 전용 type prelude에
  반영한다.
- 함수, 프로시저, 트리거, 확장, 일반 index 등 ERD 모델을 직접 구성하지 않는
  statement는 구조 parser에 전달하지 않는다.
- MySQL과 SQLite parsing 경로는 변경하지 않는다.
- parse result, worker protocol, 화면 표시 계약은 변경하지 않는다.
- 건너뛴 statement 통계나 경고를 사용자에게 표시하지 않는다.

함수 본문의 SQL, 동적 SQL 또는 조건부 DDL은 분석하지 않는다. 실행 시점에만
결정되는 schema 변경을 정적 ERD에 반영하지 않는 것이 이 작업의 명시적인
경계다.

## 구조

PostgreSQL CodeMirror parser를 statement splitter로 사용한다. 이 parser는
dollar-quoted PL/pgSQL 본문을 포함한 전체 script에서 최상위 `Statement` 범위를
제공하므로, 정규식으로 세미콜론을 직접 분리하지 않는다.

`ddl-parser.ts`의 PostgreSQL 전처리는 다음 순서로 동작한다.

1. 원본 전체 SQL을 CodeMirror PostgreSQL parser로 한 번 parsing한다.
2. 최상위 `Statement` node의 원문 범위를 순회한다.
3. 각 statement의 선행 keyword를 syntax node 기준으로 읽는다.
4. `CREATE TABLE`과 `ALTER TABLE` 원문만 ERD parser 입력 목록에 추가한다.
5. `CREATE TYPE`과 `CREATE DOMAIN` 이름은 기존 가상 enum prelude로 등록한다.
6. prelude와 ERD 대상 statement를 결합해 `node-sql-parser`에 한 번 전달한다.

원본 SQL은 source map 생성과 저장에 계속 사용한다. 따라서 editor selection,
column source range, relation source range의 기준 문자열은 바뀌지 않는다.

## 오류 처리

비대상 statement의 문법을 `node-sql-parser`가 지원하지 않더라도 전체 ERD
parsing은 계속된다.

반면 ERD 대상인 `CREATE TABLE` 또는 `ALTER TABLE`이 잘못되었거나
`node-sql-parser`가 해당 구조를 처리하지 못하면 기존과 같이 `PARSE_FAILED`를
반환한다. 지원 대상 DDL까지 조용히 누락시키는 부분 성공은 허용하지 않는다.

ERD 대상 statement가 하나도 없으면 기존과 같이 `NO_CREATE_TABLE`을 반환한다.

## 성능

CodeMirror parsing은 기존 사용자 정의 type 수집과 source map 생성에서도 사용하는
동일한 경량 parser다. 전처리 단계에서는 전체 script를 한 번 순회하고,
`node-sql-parser`는 축소된 ERD 대상 입력을 한 번만 parsing한다.

statement마다 `node-sql-parser`를 반복 호출하지 않아 전체 schema가 커져도 parser
호출 횟수가 statement 수에 비례해 증가하지 않는다.

## 변경 파일

- `apps/frontend/src/features/sql-erd/utils/ddl-parser.ts`
  - PostgreSQL 최상위 statement 분류와 ERD parser 입력 생성
- `apps/frontend/scripts/sql-erd/test.mjs`
  - 함수, 트리거, 확장, type과 여러 table이 섞인 입력 회귀 테스트
  - 잘못된 ERD 대상 DDL이 계속 실패하는지 검증

Realtime, Canvas, worker protocol, UI component와 Frontend 공통 영역은 변경하지
않는다.

## 검증

- 기존 SQLtoERD 집중 테스트를 변경 전후 모두 통과시킨다.
- PostgreSQL 함수의 dollar-quoted 본문 안에 DDL 문자열이 있어도 최상위 table로
  오인하지 않는지 검증한다.
- 함수, 트리거, 확장과 함께 입력한 table 및 FK가 정상 생성되는지 검증한다.
- 잘못된 `CREATE TABLE` 또는 `ALTER TABLE`이 `PARSE_FAILED`로 남는지 검증한다.
- 기존 PostgreSQL, MySQL, SQLite parser 회귀 테스트를 통과시킨다.

## 영향 범위

- API 계약 변경: 없음
- DB schema 변경: 없음
- Frontend 공통 영역 변경: 없음
- 다른 도메인 영향: 없음
- 배포 설정 변경: 없음

