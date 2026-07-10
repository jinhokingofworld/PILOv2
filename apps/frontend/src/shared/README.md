# Frontend Shared Modules

`src/shared/`는 특정 feature/domain 소유가 아닌 frontend 공통 코드를 둔다.

## 둘 수 있는 것

- 여러 도메인이 함께 쓰는 UI surface
- 도메인과 무관한 hook, utility, adapter
- 외부 라이브러리를 얇게 감싸는 공통 wrapper
- props나 callback으로 도메인별 동작을 주입받는 코드

## 두면 안 되는 것

- 특정 도메인의 API endpoint 호출
- 특정 도메인의 DB/storage/source of truth 흐름
- 특정 도메인의 request/response payload ownership
- 특정 화면에만 맞춘 business logic
- 다른 도메인이 알면 안 되는 내부 상태 관리

## 하위 폴더

- `github/`: 여러 feature가 공유하는 GitHub 기반 UI 선택값 adapter. API/DB source of truth와 GitHub token을 소유하지 않는다.
- `tldraw/`: tldraw 기반 rendering surface. Canvas API/DB 저장 흐름은 소유하지 않는다.

## 변경 기준

`src/shared/` 변경은 frontend 공통 영역 변경이다. 작업 전후로
`apps/frontend/FRONTEND_COMMON_AREAS.md`의 사이렌 기준을 확인한다.

새 코드를 `src/shared/`에 넣기 전에는 아래를 확인한다.

- 이 코드가 특정 도메인 이름, API, DB, storage에 묶여 있지 않은가?
- 도메인별 상태와 payload를 props/callback으로 주입받는가?
- 최소 두 개 이상의 도메인에서 재사용될 가능성이 실제로 있는가?
- 바뀌면 영향을 받을 화면과 검증 방법을 설명할 수 있는가?
