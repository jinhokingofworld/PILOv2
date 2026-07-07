# Frontend Common Areas

이 문서는 `apps/frontend`에서 도메인 작업과 공통 영역 작업을 구분하기 위한 기준이다.

## 공통 영역

아래 경로는 frontend 공통 영역으로 본다.

| Area | Path |
| --- | --- |
| App route shell | `src/app/layout.tsx`, `src/app/globals.css` |
| Route bridge | `src/app/**/page.tsx` |
| App common components | `src/components/` |
| shadcn/ui primitives | `src/components/ui/` |
| Shared hooks | `src/hooks/` |
| Shared utilities | `src/lib/` |
| Shared modules | `src/shared/` |
| Frontend tooling config | `components.json`, `postcss.config.mjs`, `tsconfig.json`, `next.config.mjs`, `package.json` |

단, `src/app/<route>/page.tsx`가 아래처럼 도메인 page를 re-export만 하는 경우는 route bridge로 보며 별도 공통 영역 사이렌 대상에서 제외한다.

```tsx
export { CalendarPage as default } from "@/features/calendar/page";
```

## `src/shared`의 존재 이유

`src/shared/`는 특정 feature/domain 소유가 아닌 frontend 공통 코드를 두는 영역이다.

여러 도메인이 같은 UI surface, hook, utility, adapter를 재사용해야 하고, 그 코드가
특정 도메인의 API/DB/storage/source of truth를 소유하지 않을 때만 `src/shared/`에 둔다.

예를 들어 `src/shared/tldraw/`는 tldraw 기반 rendering surface만 제공한다. PILO
freeform Canvas의 저장 queue, Canvas API, `canvas_freeform_shapes` 동기화는
`src/features/canvas/`의 책임으로 남는다.

`src/shared/`에 둔 코드는 모든 frontend 도메인에서 import할 수 있으므로, 변경 시
여러 화면에 영향을 줄 수 있는 공통 영역 변경으로 본다.

## 도메인 작업 영역

도메인별 실제 화면, 상태, API wrapper, 타입은 `src/features/<domain>/` 아래에 둔다.

```text
src/features/<domain>/
  page.tsx
  navigation.ts
  components/
  hooks/
  api/
  types/
  utils/
```

도메인 이름은 `docs/api/*.md`와 같은 kebab-case를 사용한다.

| Feature | API Contract |
| --- | --- |
| `calendar` | `docs/api/calendar-api.md` |
| `github-integration` | `docs/api/github-integration-api.md` |
| `pr-review` | `docs/api/pr-review-api.md` |
| `meeting` | `docs/api/meeting-api.md` |
| `canvas` | `docs/api/canvas-api.md` |
| `board` | `docs/api/board-api.md` |
| `sql-erd` | `docs/api/sqltoerd-api.md` |

## Shared API Layer

`src/shared/api/`는 도메인과 무관한 API 공통 처리만 담당한다.

- Base URL
- Authorization header 주입
- 공통 response parsing
- 공통 error mapping
- fetch/http client 설정

도메인 endpoint path, request/response 타입, 도메인별 payload 변환은 `src/features/<domain>/api/`에 둔다.

## 사이렌 기준

공통 영역 변경은 여러 도메인 화면에 영향을 줄 수 있으므로 사이렌 변경으로 본다.

공통 영역을 수정해야 하면 작업 전에 아래 내용을 먼저 정리하고 확인을 받는다.

- 수정하려는 공통 영역 경로
- 수정 사유
- 영향을 받을 수 있는 도메인 또는 화면
- 도메인 내부에서 해결할 수 없는 이유
- 검증 방법

도메인 작업 중 공통 영역 수정 필요가 새로 발견되면 즉시 멈추고 확인을 요청한다.

## 금지 사항

- 도메인 전용 API 호출을 `src/shared/api/`에 넣지 않는다.
- 도메인 전용 DB/storage/source of truth 흐름을 `src/shared/`에 넣지 않는다.
- 도메인 전용 UI를 `src/components/` 또는 `src/components/ui/`에 넣지 않는다.
- shadcn/ui primitive에 도메인별 비즈니스 로직을 넣지 않는다.
- `src/app` route 파일에 도메인 상태 관리, API 호출, 복잡한 UI를 직접 넣지 않는다.
- 다른 도메인에서 재사용하려는 목적으로 `src/features/<domain>/` 코드를 직접 import하지 않는다. 공통화가 필요하면 도메인 로직을 제거한 뒤 `src/shared/`로 분리한다.
