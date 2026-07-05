# App Server Common Areas

이 문서는 `apps/app-server`에서 도메인 작업과 공통 영역 작업을 구분하기 위한 기준이다.

## 공통 영역

아래 경로는 app-server 공통 영역으로 본다.

| Area | Path |
| --- | --- |
| App bootstrap | `src/main.ts`, `src/app.module.ts` |
| App root controller/service | `src/app.controller.ts`, `src/app.service.ts` |
| Cross-domain common layer | `src/common/` |
| Database access layer | `src/database/` |
| Module registry docs | `src/modules/README.md` |
| App server tooling config | `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `Dockerfile` |
| Shared test/format scripts | `scripts/test.mjs`, `scripts/check-format.mjs` |

도메인 모듈을 `src/app.module.ts`에 등록하거나 제거하는 작업도 app bootstrap 변경이므로 공통 영역 변경으로 기록한다.

## 도메인 작업 영역

도메인별 controller, service, DTO, query/repository, 타입, 도메인 전용 테스트는 아래에 둔다.

```text
src/modules/<domain>/
  <domain>.module.ts
  <domain>.controller.ts
  <domain>.service.ts
  dto/
  queries/
  repositories/
  types/
```

도메인 이름은 `docs/api/*.md`와 같은 kebab-case를 사용한다.

| Module | API Contract |
| --- | --- |
| `calendar` | `docs/api/calendar-api.md` |
| `github-integration` | `docs/api/github-integration-api.md` |
| `pr-review` | `docs/api/pr-review-api.md` |
| `meeting` | `docs/api/meeting-api.md` |
| `canvas` | `docs/api/canvas-api.md` |
| `board` | `docs/api/board-api.md` |

도메인 전용 테스트 스크립트는 `scripts/<domain>/` 아래에 둔다.

## Shared API Layer

`src/common/`은 도메인과 무관한 API 공통 처리만 담당한다.

- 공통 response envelope
- 공통 error type과 error mapping
- 인증 guard와 current user decorator
- session 처리
- 여러 도메인이 함께 쓰는 provider/module

도메인 endpoint path, request/response 타입, 도메인별 payload 변환, 도메인별 SQL은 `src/modules/<domain>/`에 둔다.

## Shared Database Layer

`src/database/`는 DB 연결과 query 실행의 공통 기반만 담당한다.

- connection pool 생성과 종료
- 공통 query helper
- DB client provider/module

테이블별 query, 도메인별 transaction 흐름, domain-specific mapping은 `src/modules/<domain>/`에 둔다.

## 사이렌 기준

공통 영역 변경은 여러 API 도메인과 서버 부팅 흐름에 영향을 줄 수 있으므로 사이렌 변경으로 본다.

공통 영역을 수정해야 하면 작업 전에 아래 내용을 먼저 정리하고 확인을 받는다.

- 수정하려는 공통 영역 경로
- 수정 사유
- 영향을 받을 수 있는 도메인 또는 endpoint
- 도메인 내부에서 해결할 수 없는 이유
- 검증 방법

도메인 작업 중 공통 영역 수정 필요가 새로 발견되면 즉시 멈추고 확인을 요청한다.

## 금지 사항

- 도메인 전용 API 로직을 `src/common/` 또는 `src/database/`에 넣지 않는다.
- 도메인 전용 SQL을 `src/database/`에 넣지 않는다.
- 공통 error/response 형식을 도메인 요구만 보고 변경하지 않는다.
- `src/app.module.ts`에 임시 mock module이나 실험용 provider를 등록하지 않는다.
- 실제 secret, token, private key, connection string을 코드나 테스트 fixture에 넣지 않는다.
