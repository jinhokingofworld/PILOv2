# PILO Frontend 화면 구조 및 도메인 분리 규칙

이 문서는 PILO frontend 구현 시 각 도메인 담당자와 AI agent가 공통으로 따르는 화면 구조 기준이다.

목표는 다음과 같다.

- 각 도메인 담당자가 자기 화면을 독립적으로 구현할 수 있게 한다.
- 여러 사람이 동시에 frontend를 수정해도 충돌을 줄인다.
- Next.js `app` router 구조와 도메인 feature 구조를 명확히 분리한다.
- 다른 도메인의 내부 구현에 직접 의존하지 않게 한다.
- PR 리뷰 범위와 코드 소유권을 명확히 한다.

## 1. 핵심 원칙

PILO frontend는 다음 원칙으로 나눈다.

```text
app      = URL 라우팅, route layout, page shell
features = 도메인별 실제 화면, 상태, API, hook, type
shared   = 도메인에 종속되지 않는 공통 UI, 공통 lib, 공통 type
```

즉, `apps/frontend/src/app` 안의 `page.tsx`는 최대한 얇게 유지한다.

`page.tsx` 안에서 복잡한 화면을 직접 구현하지 않는다. 실제 화면은 `features/<domain>/screens` 또는 `features/<domain>`에서 만든 Screen 컴포넌트를 import해서 렌더링한다.

예:

```tsx
// apps/frontend/src/app/(workspace)/workspaces/[workspaceId]/board/page.tsx
import { BoardScreen } from "@/features/board";

export default function Page() {
  return <BoardScreen />;
}
```

좋은 방향:

```text
page.tsx
  -> route params를 받고
  -> 필요한 최소 wrapper만 두고
  -> feature screen을 렌더링
```

피해야 할 방향:

```text
page.tsx 안에
  -> domain 상태 관리
  -> API 호출
  -> 복잡한 UI 컴포넌트
  -> business logic
  -> 다른 도메인 컴포넌트 조합
을 직접 작성
```

## 2. 추천 폴더 구조

기본 구조는 아래 기준을 따른다.

```text
apps/frontend/src/
  app/
    layout.tsx
    page.tsx

    (auth)/
      login/
        page.tsx

    (workspace)/
      workspaces/
        [workspaceId]/
          layout.tsx
          page.tsx

          board/
            page.tsx

          calendar/
            page.tsx

          canvas/
            page.tsx

          meetings/
            page.tsx
            [meetingId]/
              page.tsx

          github/
            page.tsx

          pr-review/
            [sessionId]/
              page.tsx

  features/
    board/
      screens/
        BoardScreen.tsx
      components/
      api/
      hooks/
      types.ts
      index.ts

    calendar/
      screens/
      components/
      api/
      hooks/
      types.ts
      index.ts

    canvas/
      screens/
      components/
      api/
      hooks/
      types.ts
      index.ts

    meeting/
      screens/
      components/
      api/
      hooks/
      types.ts
      index.ts

    github-integration/
      screens/
      components/
      api/
      hooks/
      types.ts
      index.ts

    pr-review/
      screens/
      components/
      api/
      hooks/
      types.ts
      index.ts

    workspace-dashboard/
      screens/
      components/
      api/
      hooks/
      types.ts
      index.ts

  shared/
    ui/
    layout/
    api/
    lib/
    types/
```

## 3. `app` 폴더의 역할

`app` 폴더는 Next.js App Router의 라우팅 계층이다.

담당하는 것:

- URL 구조
- route group
- layout
- loading/error/not-found boundary
- route params 전달
- metadata
- feature screen 렌더링

담당하지 않는 것:

- 도메인 business logic
- 도메인 API 호출 로직
- 도메인 상태 관리
- 도메인 내부 컴포넌트 구현
- 복잡한 화면 조합

예:

```tsx
// apps/frontend/src/app/(workspace)/workspaces/[workspaceId]/calendar/page.tsx
import { CalendarScreen } from "@/features/calendar";

type Props = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export default async function Page({ params }: Props) {
  const { workspaceId } = await params;

  return <CalendarScreen workspaceId={workspaceId} />;
}
```

이 정도는 허용된다.

하지만 아래처럼 직접 구현하는 것은 피한다.

```tsx
// 피해야 하는 예
export default function Page() {
  const [events, setEvents] = useState([]);
  const [selectedDate, setSelectedDate] = useState();

  useEffect(() => {
    fetch("/api/calendar/events").then(...);
  }, []);

  return (
    <div>
      ...
    </div>
  );
}
```

이 코드는 `features/calendar` 안으로 들어가야 한다.

## 4. `features` 폴더의 역할

`features/<domain>`은 해당 도메인의 실제 화면과 로직을 소유한다.

각 도메인은 다음을 자기 feature 폴더 안에 둔다.

- screen component
- 도메인 전용 component
- 도메인 API client
- 도메인 hook
- 도메인 type
- 도메인 state
- 도메인 formatter / mapper
- 도메인 테스트

예:

```text
features/board/
  screens/
    BoardScreen.tsx
  components/
    BoardColumn.tsx
    BoardIssueCard.tsx
  api/
    boardApi.ts
  hooks/
    useBoard.ts
  types.ts
  index.ts
```

`index.ts`는 외부 공개 API 역할을 한다.

```ts
// features/board/index.ts
export { BoardScreen } from "./screens/BoardScreen";
export type { Board, BoardColumn, BoardIssueCard } from "./types";
```

다른 도메인은 `features/board/index.ts`에서 export한 것만 사용해야 한다.

## 5. `shared` 폴더의 역할

`shared`는 특정 도메인에 속하지 않는 공통 코드만 둔다.

넣어도 되는 것:

```text
shared/ui/Button.tsx
shared/ui/Dialog.tsx
shared/ui/Tabs.tsx
shared/layout/WorkspaceShell.tsx
shared/api/httpClient.ts
shared/lib/date.ts
shared/lib/cn.ts
shared/types/api.ts
```

넣으면 안 되는 것:

```text
shared/components/IssueCard.tsx
shared/components/MeetingSummary.tsx
shared/components/PullRequestDiff.tsx
```

이런 것들은 특정 도메인 의미를 갖기 때문에 각각의 feature에 있어야 한다.

예:

- `IssueCard`가 Board 카드라면 `features/board/components`
- `MeetingSummary`라면 `features/meeting/components`
- `PullRequestDiff`라면 `features/pr-review/components`

공통으로 쓰고 싶다면 해당 도메인 `index.ts`에서 명시적으로 export한다.

## 6. 도메인별 화면 소유권

도메인별 기본 소유 위치는 다음과 같다.

| 도메인 | 주요 화면 | 소유 폴더 |
| --- | --- | --- |
| Board | 칸반 보드, 컬럼, 이슈 카드, 보드 상태 | `features/board` |
| Calendar | 일정 목록, 날짜 패널, 이벤트 상세 | `features/calendar` |
| Canvas | tldraw 캔버스, shape, viewport, canvas toolbar | `features/canvas` |
| Meeting | 회의방, 참가자, 녹화 상태, 회의 리포트 | `features/meeting` |
| GitHub Integration | repo 연결, GitHub App/OAuth, issue/PR sync 상태 | `features/github-integration` |
| PR Review | review session, diff, file decision, GitHub review submission | `features/pr-review` |
| Workspace Dashboard | 여러 도메인의 요약 정보 조립 | `features/workspace-dashboard` |

## 7. 여러 도메인이 섞이는 화면 처리 기준

여러 도메인의 정보가 한 화면에 같이 나오는 경우, 화면 소유권은 “중심 workflow” 기준으로 정한다.

### 예시 1. PR Review 화면에서 GitHub PR 정보가 필요함

화면의 목적은 PR 리뷰다.

따라서 화면 소유는 `features/pr-review`다.

GitHub 데이터가 필요하더라도 `github-integration` 내부 파일을 직접 import하지 않는다.

좋은 방향:

```ts
import { useGithubPullRequest } from "@/features/github-integration";
```

피해야 할 방향:

```ts
import { getPullRequest } from "@/features/github-integration/api/githubApi";
import { GithubPullRequestHeader } from "@/features/github-integration/components/GithubPullRequestHeader";
```

`github-integration`에서 외부 사용을 허용하는 hook/component/type만 `index.ts`로 공개한다.

### 예시 2. Board 카드에서 Meeting 요약을 보여줌

화면의 목적은 Board다.

따라서 화면 소유는 `features/board`다.

Meeting 정보는 `features/meeting`에서 공개한 read-only widget 또는 hook만 사용한다.

좋은 방향:

```ts
import { MeetingSummaryBadge } from "@/features/meeting";
```

피해야 할 방향:

```ts
import { MeetingRoomInternalState } from "@/features/meeting/hooks/useMeetingRoomInternalState";
```

### 예시 3. 워크스페이스 홈에서 Board/Calendar/Meeting 요약을 모두 보여줌

여러 도메인 요약을 조립하는 화면은 특정 도메인 하나에 억지로 넣지 않는다.

이 경우 별도 feature를 둔다.

```text
features/workspace-dashboard/
  screens/
    WorkspaceDashboardScreen.tsx
  components/
    BoardSummaryPanel.tsx
    CalendarSummaryPanel.tsx
    MeetingSummaryPanel.tsx
```

단, 각 패널에서 도메인의 내부 구현에 직접 접근하지 않는다.

```ts
import { BoardSummaryWidget } from "@/features/board";
import { CalendarSummaryWidget } from "@/features/calendar";
import { MeetingSummaryWidget } from "@/features/meeting";
```

## 8. import 규칙

가장 중요한 규칙이다.

다른 도메인의 내부 경로를 직접 import하지 않는다.

좋은 예:

```ts
import { MeetingSummaryCard } from "@/features/meeting";
import { useBoard } from "@/features/board";
import type { CalendarEvent } from "@/features/calendar";
```

피해야 할 예:

```ts
import { MeetingSummaryCard } from "@/features/meeting/components/summary/MeetingSummaryCard";
import { useBoard } from "@/features/board/hooks/useBoard";
import type { CalendarEvent } from "@/features/calendar/types";
```

외부에서 써도 되는 것은 반드시 해당 도메인의 `index.ts`에서 export한다.

```ts
// features/meeting/index.ts
export { MeetingSummaryCard } from "./components/MeetingSummaryCard";
export { useMeetingSummary } from "./hooks/useMeetingSummary";
export type { MeetingSummary } from "./types";
```

이 규칙을 두는 이유:

- 도메인 내부 리팩터링이 쉬워진다.
- 다른 팀원의 작업과 충돌이 줄어든다.
- 공개 API와 내부 구현의 경계가 생긴다.
- PR 리뷰 시 영향 범위를 파악하기 쉽다.

## 9. feature 내부 구조 기준

각 feature는 아래 구조를 기본값으로 한다.

```text
features/<domain>/
  screens/
  components/
  api/
  hooks/
  types.ts
  index.ts
```

### `screens`

라우트에서 직접 렌더링하는 최상위 화면 컴포넌트.

예:

```text
features/board/screens/BoardScreen.tsx
features/calendar/screens/CalendarScreen.tsx
features/pr-review/screens/PrReviewSessionScreen.tsx
```

### `components`

해당 도메인 내부에서 쓰는 UI 조각.

예:

```text
features/board/components/BoardColumn.tsx
features/board/components/BoardIssueCard.tsx
```

외부 도메인에서 써야 하는 컴포넌트만 `index.ts`로 공개한다.

### `api`

해당 도메인의 API 호출 함수.

예:

```text
features/board/api/boardApi.ts
features/meeting/api/meetingApi.ts
```

### `hooks`

해당 도메인의 상태, query, mutation, UI interaction hook.

예:

```text
features/board/hooks/useBoard.ts
features/calendar/hooks/useCalendarEvents.ts
```

### `types.ts`

해당 도메인에서 쓰는 type 정의.

API 계약과 연결되는 type은 API 문서 기준과 맞춰야 한다.

### `index.ts`

외부 공개 API.

다른 도메인이 import할 수 있는 항목은 여기에서만 export한다.

## 10. layout 기준

공통 layout은 `shared/layout` 또는 `app` route layout에 둔다.

예:

```text
app/(workspace)/workspaces/[workspaceId]/layout.tsx
shared/layout/WorkspaceShell.tsx
shared/layout/Sidebar.tsx
shared/layout/TopNav.tsx
```

Workspace 전체에 공통으로 들어가는 sidebar, top nav, workspace switcher는 도메인 feature가 아니라 layout 영역이다.

단, 특정 도메인 전용 toolbar는 해당 feature 안에 둔다.

예:

```text
features/canvas/components/CanvasToolbar.tsx
features/pr-review/components/ReviewToolbar.tsx
features/board/components/BoardToolbar.tsx
```

## 11. route naming 기준

도메인 라우트는 API 문서와 같은 kebab-case 도메인명을 우선한다.

추천 URL:

```text
/workspaces/[workspaceId]/board
/workspaces/[workspaceId]/calendar
/workspaces/[workspaceId]/canvas
/workspaces/[workspaceId]/meetings
/workspaces/[workspaceId]/meetings/[meetingId]
/workspaces/[workspaceId]/github
/workspaces/[workspaceId]/pr-review/[sessionId]
```

폴더 예:

```text
app/(workspace)/workspaces/[workspaceId]/pr-review/[sessionId]/page.tsx
```

feature 폴더는 기존 repo 규칙에 맞춰 kebab-case를 사용한다.

```text
features/github-integration
features/pr-review
```

## 12. 도메인 간 데이터 공유 기준

도메인 간 데이터가 필요할 때는 아래 순서를 따른다.

1. API contract에 있는 endpoint를 통해 가져온다.
2. 해당 도메인의 public hook/API를 사용한다.
3. read-only widget을 해당 도메인에서 export해서 사용한다.
4. 그래도 부족하면 API 계약 또는 feature public API를 조정한다.

하지 말아야 할 것:

- 다른 도메인의 내부 store를 직접 읽기
- 다른 도메인의 private hook 직접 import
- 다른 도메인 컴포넌트 내부 props 구조에 강하게 의존
- shared에 도메인 로직을 밀어 넣기

## 13. shared로 올려도 되는 기준

아래 조건을 모두 만족하면 `shared`로 이동할 수 있다.

- 특정 도메인 용어가 없다.
- Board/Meeting/PR Review 같은 업무 의미를 모른다.
- props가 일반적인 UI 표현이다.
- 여러 도메인에서 똑같은 의미로 재사용된다.

예:

```text
Button
Input
Dialog
Tabs
DropdownMenu
Spinner
EmptyState
DateRangePicker
Toast
cn
formatDate
httpClient
```

shared로 올리면 안 되는 예:

```text
IssueCard
PullRequestBadge
MeetingParticipantList
CanvasShapeToolbar
ReviewDecisionButton
```

이들은 도메인 의미가 있으므로 각 feature에 둔다.

## 14. 충돌을 줄이는 작업 방식

각자 도메인 작업 시 기본적으로 자기 feature 폴더 안에서 작업한다.

예:

- Board 담당자: `features/board/**`, `app/.../board/page.tsx`
- Calendar 담당자: `features/calendar/**`, `app/.../calendar/page.tsx`
- Canvas 담당자: `features/canvas/**`, `app/.../canvas/page.tsx`
- Meeting 담당자: `features/meeting/**`, `app/.../meetings/**`
- PR Review 담당자: `features/pr-review/**`, `app/.../pr-review/**`

공통 파일을 수정해야 하면 PR 본문에 명시한다.

공통 파일 예:

```text
shared/**
app/layout.tsx
app/(workspace)/workspaces/[workspaceId]/layout.tsx
package.json
next.config.mjs
tsconfig.json
```

공통 파일 변경은 충돌 가능성이 높으므로, 변경 이유와 영향 범위를 PR에 적는다.

## 15. 새 화면 추가 시 절차

새 화면을 추가할 때는 아래 순서를 따른다.

1. 해당 화면이 어느 도메인의 workflow인지 정한다.
2. URL이 필요하면 `app`에 route를 만든다.
3. 실제 화면은 `features/<domain>/screens`에 만든다.
4. `features/<domain>/index.ts`에서 screen을 export한다.
5. `page.tsx`에서는 screen만 import해서 렌더링한다.
6. 다른 도메인 데이터가 필요하면 해당 도메인의 public export만 사용한다.
7. 공통 UI가 필요하면 `shared/ui`를 사용한다.

예:

```text
app/(workspace)/workspaces/[workspaceId]/board/page.tsx
features/board/screens/BoardScreen.tsx
features/board/index.ts
```

## 16. PR 작성 시 체크 기준

Frontend 화면 작업 PR에서는 다음을 확인한다.

- `page.tsx`가 지나치게 두꺼워지지 않았는가?
- 실제 화면 구현이 `features/<domain>` 안에 있는가?
- 다른 도메인의 내부 경로를 직접 import하지 않았는가?
- 외부에서 써야 하는 항목만 `index.ts`로 공개했는가?
- `shared`에 도메인 전용 컴포넌트를 넣지 않았는가?
- 공통 layout/shared/package 변경이 있다면 PR 본문에 영향 범위를 적었는가?
- API 계약 변경이 필요하면 `docs/api` 문서도 함께 수정했는가?

## 17. 요약

PILO frontend 구조는 다음 기준을 따른다.

```text
app
  URL과 layout만 담당한다.

features
  도메인별 실제 화면과 로직을 담당한다.

shared
  도메인에 종속되지 않는 공통 UI와 유틸만 담당한다.
```

다른 도메인을 사용할 때는 반드시 해당 도메인의 `index.ts`에서 공개한 것만 import한다.

이 구조를 따르면 각 도메인 담당자가 독립적으로 화면을 구현할 수 있고, 충돌과 의존성 꼬임을 줄일 수 있다.
