# Workspace Presence Realtime API

Workspace Presence는 같은 Workspace에 접속 중인 사용자의 대표 활성 화면을
메모리에서만 공유하고, 아바타를 눌러 해당 사용자의 durable location을 계속
따라가는 Follow session을 제공하는 Socket.IO 계약이다. Follow는 읽기 전용
화면 이동이며 원격 제어, 활동 로그, DB 저장은 이 계약의 범위가 아니다.

## 연결과 접근 권한

- 기존 realtime-server Socket.IO 연결을 재사용한다. 별도 socket을 만들지 않는다.
- handshake의 `auth.token` 또는 `Authorization: Bearer <pilo_access_token>`으로
  인증한다.
- join 시 인증 사용자가 `workspace_members`에 존재하는지 확인한다.
- 내부 room 이름은 `workspace:{workspaceId}:presence`다.
- 현재 사용자의 profile API `lastSeenAt`이나 `/me/presence`는 online 여부의
  source of truth가 아니다.
- Workspace membership이 철회되면 해당 Workspace의 기존 presence room과 메모리
  state를 즉시 제거한다. membership 검사와 room join 사이에 철회가 도착한 join은
  room/state 생성 전에 취소하거나 rollback한다. 이후 같은 socket의 update는
  `forbidden`으로 거부되며, 다른 Workspace의 presence 연결은 유지한다.

## Event 목록

| 방향 | Event | Payload | 설명 |
| --- | --- | --- | --- |
| client → server | `workspace-presence:join` | `{ workspaceId }` | Workspace presence room에 입장한다. |
| server → client | `workspace-presence:joined` | `{ workspaceId, presence }` | 현재 사용자별 대표 상태 snapshot을 join한 socket에 보낸다. |
| client → server | `workspace-presence:update` | `WorkspacePresenceUpdatePayload` | 현재 탭의 focus, visibility, durable location을 갱신한다. |
| server → client | `workspace-presence:update` | `WorkspacePresenceState` | 해당 사용자의 새 대표 상태를 room에 broadcast한다. |
| client → server | `workspace-presence:leave` | `{ workspaceId }` | 현재 socket을 Workspace presence room에서 제거한다. |
| server → client | `workspace-presence:leave` | `{ workspaceId, userId }` | 해당 사용자의 마지막 socket이 사라졌음을 broadcast한다. |
| server → client | `workspace-presence:error` | `RealtimeSocketErrorPayload` | payload, 권한, join 순서 오류를 알린다. |

Follow 전용 subscribe/unsubscribe event는 추가하지 않는다. 기존
`workspace-presence:update`의 대표 location broadcast를 그대로 사용한다.

```ts
type WorkspacePresenceUpdatePayload = {
  workspaceId: string;
  focused: boolean;
  visible: boolean;
  location: WorkspacePresenceLocation | null;
};

type WorkspacePresenceState = WorkspacePresenceUpdatePayload & {
  userId: string;
  displayName: string;
  lastActiveAt: string;
};

type WorkspacePresenceLocation = {
  page:
    | "home"
    | "calendar"
    | "board"
    | "sql-erd"
    | "pr-review"
    | "meeting"
    | "chat"
    | "canvas"
    | "drive";
  route: { pathname: string; search: string };
  context: Record<string, string | null>;
  viewport:
    | { kind: "document"; xRatio: number; yRatio: number }
    | {
        kind: "element";
        key:
          | "board-kanban"
          | "board-issue-sheet"
          | "calendar-grid"
          | "calendar-event-detail"
          | "calendar-events-dialog"
          | "chat-messages"
          | "drive-list"
          | "drive-pdf"
          | "meeting-content"
          | "pr-review-diff"
          | "pr-review-inspector"
          | "sql-erd-inspector";
        xRatio: number;
        yRatio: number;
      }
    | {
        kind: "camera";
        x: number;
        y: number;
        z: number;
        selectedShapeIds?: string[];
      };
};

type PrReviewPresenceContext = {
  reviewSessionId: string | null;
  reviewFileId: string | null;
};

type BoardPresenceContext = {
  boardId: string;
  issueId: string | null;
};

type CalendarPresenceContext = {
  selectedDate: string | null;
  eventId: string | null;
};

type SqlErdPresenceContext = {
  sessionId: string;
  sqlErdInspectorOpen: "true" | "false";
  sqlErdSelectionType:
    | "none"
    | "table"
    | "column"
    | "relation"
    | "annotation"
    | "note"
    | "frame"
    | "text";
  sqlErdSelectionId: string | null;
  sqlErdSelectionTableId: string | null;
};

type MeetingPresenceContext = {
  meetingRoomId: string | null;
  reportId: string | null;
};

type ChatPresenceContext = {
  messageId: string | null;
  threadId: string | null;
};

type DrivePresenceContext = {
  folderId: string | null;
  documentId: string | null;
  pdfFileId: string | null;
  pdfPage: string | null;
};
```

`lastActiveAt`은 server timestamp ISO 8601 문자열이다. client가 timestamp를
지정할 수 없다.

## 화면별 durable location

| page | route | context | viewport |
| --- | --- | --- | --- |
| `home` | `/home` | 없음 | document |
| `calendar` grid | `/calendar?date=...` | `selectedDate: string \| null`, `eventId: null` | calendar-grid 또는 document |
| `calendar` event detail | `/calendar?date=...` | `selectedDate: string`, `eventId: string` | calendar-event-detail |
| `calendar` events dialog | `/calendar?date=...` | `selectedDate: string`, `eventId: null` | calendar-events-dialog |
| `board` kanban | `/board?boardId=...` | `boardId: string`, `issueId: null` | board-kanban |
| `board` issue sheet | `/board?boardId=...&issueId=...` | `boardId: string`, `issueId: string` | board-issue-sheet |
| `sql-erd` canvas | `/sql-erd/session?sessionId=...` | `SqlErdPresenceContext`, `sqlErdInspectorOpen: "false"` | camera |
| `sql-erd` inspector | `/sql-erd/session?sessionId=...` | `SqlErdPresenceContext`, `sqlErdInspectorOpen: "true"` | sql-erd-inspector |
| `pr-review` 목록 | `/pr-review` | `reviewSessionId: null`, `reviewFileId: null` | document |
| `pr-review` canvas | `/pr-review?reviewSessionId=...` | `reviewSessionId: string`, `reviewFileId: null` | camera |
| `pr-review` diff | `/pr-review?reviewSessionId=...` | `reviewSessionId: string`, `reviewFileId: string` | pr-review-diff |
| `pr-review` inspector | `/pr-review?reviewSessionId=...` | `reviewSessionId: string`, `reviewFileId: string` | pr-review-inspector |
| `meeting` room | `/meeting?meetingRoomId=...` | `meetingRoomId: string \| null`, `reportId: null` | document 또는 meeting-content |
| `meeting` report | `/report?reportId=...` | `meetingRoomId: null`, `reportId: string \| null` | document 또는 meeting-content |
| `chat` | `/chat` | `messageId: string \| null`, `threadId: string \| null` | chat-messages |
| `canvas` | `/canvas?canvasId=...` | `canvasId: string` | camera와 optional `selectedShapeIds` |
| `drive` list | `/files?folderId=...` | `folderId: string \| null`, 나머지 Drive ID는 null | drive-list |
| `drive` document | `/files?documentId=...` | `documentId: string`, PDF ID/page는 null | document |
| `drive` PDF | `/files?folderId=...` | `folderId: string \| null`, `documentId: null`, `pdfFileId: string`, `pdfPage: positive-integer string` | drive-pdf |
| `drive` document-attached PDF | `/files?documentId=...` | `documentId: string`, `folderId: null`, `pdfFileId: string`, `pdfPage: positive-integer string` | drive-pdf |

location에는 입력값, 미저장 draft, comment, conflict draft, raw diff/content와
AI chat, popover, 편집 중인 shape 같은 transient state를 넣지 않는다. 단, PR Review
drawer의 opaque `reviewFileId`와 활성 diff/inspector scroll ratio는 읽기 전용
탐색 상태이므로 durable location에 포함할 수 있다. 파일명이나 diff 본문은
포함하지 않는다. Meeting restore는 회의방만 선택하며 회의 시작, 참여, LiveKit
연결을 실행하지 않는다. Canvas의 `selectedShapeIds`는 읽기 전용 선택 위치이며
editing shape나 AI 상태를 포함하지 않는다. Drive, SQL ERD, PR Review, Canvas는 목적지 resource가
실제로 로드된 뒤 viewport를 복원한다.

## Validation

- `workspaceId`와 context identifier는 trim 후 빈 문자열을 허용하지 않으며 최대
  256자다.
- `route.search`는 최대 2,048자다.
- pathname은 page별 route prefix와 일치해야 한다. 예를 들어 `sql-erd`는
  `/sql-erd` 또는 `/sql-erd/...`만 허용한다.
- viewport 종류와 element key는 page별 허용 조합만 통과한다.
- context는 page별 명시된 key만 허용하며 추가 key가 있으면 거부한다.
- PR Review의 `reviewSessionId`, `reviewFileId`는 null/생략 또는 trim 후 1..256자
  identifier다. 생략한 값은 server output에서 null로 정규화한다.
- PR Review camera는 session ID만, document는 두 ID 모두 null, diff/inspector는
  두 ID 모두 있어야 한다. file ID만 있는 조합과 다른 page의 PR element key는
  거부한다.
- 새 nullable context key를 생략한 기존 payload는 server output에서 null로
  정규화한다. 기존 Canvas camera payload의 생략된 `selectedShapeIds`는 빈 배열로
  정규화한다.
- Board issue sheet는 `issueId`, Calendar event detail은 `eventId`가 있어야 한다.
  Calendar date는 `YYYY-MM-DD` 형식이다.
- SQL ERD selection type은 `none`, `table`, `column`, `relation`, `annotation`,
  `note`, `frame`, `text`만 허용한다. `column`만 table ID를 함께 요구한다.
- `/meeting`은 `reportId: null`, `/report`는 `meetingRoomId: null`이어야 한다.
- Drive document/PDF identity는 동시에 설정할 수 없고 `pdfPage`는 양의 정수
  문자열이어야 한다.
- camera의 `x`, `y`, `z`는 finite number여야 한다.
- scroll ratio는 finite number여야 하며 server가 `0..1`로 clamp한다.
- update 전에 같은 socket이 해당 Workspace room에 join해야 한다.

오류 payload는 `{ code, message, requestId? }`이며 code는 다음 중 하나다.

- `invalid_payload`: schema 또는 validation 위반
- `unauthenticated`: 유효한 bearer session 없음
- `forbidden`: Workspace membership 없음
- `room_not_joined`: join 전에 update함
- `internal_error`: realtime-server 내부 오류

## 여러 탭과 대표 상태

서버는 socket별 상태를 저장하고 userId별로 하나의 대표 상태만 노출한다.
우선순위는 다음과 같다.

1. `focused && visible`인 탭 중 가장 최근 활성 탭
2. visible 탭 중 가장 최근 활성 탭
3. 그 외 연결된 탭 중 가장 최근 활성 탭

`lastActiveAt`과 내부 activity sequence는 `focused && visible` update에서만
진행한다. background update가 foreground 탭을 대표 상태에서 밀어내지 않는다.
대표 socket이 leave/disconnect되어도 같은 사용자의 다른 socket이 남아 있으면
`workspace-presence:update`로 새 대표 상태를 보낸다. 마지막 socket이 사라질 때만
`workspace-presence:leave`를 보낸다.

## 저장과 생명주기

- 상태는 realtime-server process memory에만 존재한다.
- Follow 대상 관계도 frontend memory에만 존재하며 server, DB, history에 저장하지
  않는다.
- DB, migration, RLS, Activity Log에 online 상태나 location을 기록하지 않는다.
- 마지막 disconnect, 명시적 leave, server process 재시작 시 상태가 사라진다.
- DB fallback이나 과거 위치 복구는 없다.
- 현재 구현은 process-local roster다. 여러 realtime-server process에서 완전한
  대표 탭 선택이 필요하면 별도의 shared ephemeral presence store가 필요하다.

## Frontend Follow session

frontend는 focus, blur, visibility, route 변경을 즉시 보고하고 scroll/camera
interaction은 100ms로 throttle한다. 아바타를 누르면 해당 사용자의 Follow를
시작하고, 같은 아바타를 다시 누르거나 `Esc`를 누르면 종료한다. scroll, pointer,
wheel, keyboard navigation 같은 수동 interaction도 Follow를 즉시 종료한다.
Follow가 적용한 programmatic route/scroll/camera restore는 수동 interaction으로
취급하지 않는다.

Follow 중에는 대상 사용자의 최신 대표 location만 적용하는 latest-wins 규칙을
사용한다. 새 update가 오면 이전 pending restore를 취소하고 최신 location으로
이동한다. 최초 이동을 8초 안에 복원하지 못하면 Follow 시작 전 route로
rollback하고 shadcn Sonner로 `해당 팀원의 화면으로 이동할 수 없습니다`를
표시한다. Follow가 이미 시작된 뒤 연속 update 복원에 실패하면 rollback하지 않고
현재 화면을 유지한 채 Follow를 종료한다.

이 변경은 기존 event를 유지하는 public optional location 계약 확장이다. PR Review
위치 계약은 PR Review 담당자 은재, 검증·broadcast 동작은 Infra/Realtime 담당자
진호의 확인 대상이며 DB Schema 변경은 없다.
