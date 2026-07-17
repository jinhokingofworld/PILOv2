# Workspace Presence Realtime API

Workspace Presence는 같은 Workspace에 접속 중인 사용자의 대표 활성 화면을
메모리에서만 공유하고, 아바타를 눌렀을 때 그 화면으로 한 번 이동하기 위한
Socket.IO 계약이다. 연속 따라가기, 원격 제어, 활동 로그, DB 저장은 이 계약의
범위가 아니다.

## 연결과 접근 권한

- 기존 realtime-server Socket.IO 연결을 재사용한다. 별도 socket을 만들지 않는다.
- handshake의 `auth.token` 또는 `Authorization: Bearer <pilo_access_token>`으로
  인증한다.
- join 시 인증 사용자가 `workspace_members`에 존재하는지 확인한다.
- 내부 room 이름은 `workspace:{workspaceId}:presence`다.
- 현재 사용자의 profile API `lastSeenAt`이나 `/me/presence`는 online 여부의
  source of truth가 아니다.
- Workspace membership이 철회되면 해당 Workspace의 기존 presence room과 메모리
  state를 즉시 제거한다. 이후 같은 socket의 update는 `room_not_joined`로
  거부되며, 다른 Workspace의 presence 연결은 유지한다.

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
          | "calendar-grid"
          | "drive-list"
          | "meeting-content";
        xRatio: number;
        yRatio: number;
      }
    | { kind: "camera"; x: number; y: number; z: number };
};
```

`lastActiveAt`은 server timestamp ISO 8601 문자열이다. client가 timestamp를
지정할 수 없다.

## 화면별 durable location

| page | route | context | viewport |
| --- | --- | --- | --- |
| `home` | `/home` | 없음 | document |
| `calendar` | `/calendar?date=...` | `selectedDate: string \| null` | calendar-grid 또는 document |
| `board` | `/board` | `boardId: string` | board-kanban |
| `sql-erd` | `/sql-erd/session?sessionId=...` | `sessionId: string` | camera |
| `pr-review` | `/pr-review?reviewSessionId=...` | `reviewSessionId: string \| null` | camera 또는 document |
| `meeting` | `/meeting?meetingRoomId=...` | `meetingRoomId: string \| null` | document 또는 meeting-content |
| `canvas` | `/canvas?canvasId=...` | `canvasId: string` | camera |
| `drive` | `/files?folderId=...` | `folderId: string \| null` | drive-list 또는 document |

location에는 modal, popover, sheet, 입력값, 미저장 draft, 선택 중인 transient
object를 넣지 않는다. Meeting restore는 회의방만 선택하며 회의 시작, 참여,
LiveKit 연결을 실행하지 않는다. Drive, SQL ERD, PR Review, Canvas는 목적지
resource가 실제로 로드된 뒤 viewport를 복원한다.

## Validation

- `workspaceId`와 context identifier는 trim 후 빈 문자열을 허용하지 않으며 최대
  256자다.
- `route.search`는 최대 2,048자다.
- pathname은 page별 route prefix와 일치해야 한다. 예를 들어 `sql-erd`는
  `/sql-erd` 또는 `/sql-erd/...`만 허용한다.
- viewport 종류와 element key는 page별 허용 조합만 통과한다.
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
- DB, migration, RLS, Activity Log에 online 상태나 location을 기록하지 않는다.
- 마지막 disconnect, 명시적 leave, server process 재시작 시 상태가 사라진다.
- DB fallback이나 과거 위치 복구는 없다.
- 현재 구현은 process-local roster다. 여러 realtime-server process에서 완전한
  대표 탭 선택이 필요하면 별도의 shared ephemeral presence store가 필요하다.

## Frontend one-shot 이동

frontend는 focus, blur, visibility, route 변경을 즉시 보고하고 scroll/camera
interaction은 100ms로 throttle한다. 아바타 클릭 시 해당 시점의 대표 location을
snapshot한 뒤 같은 route면 즉시 복원하고, 다른 route면 이동 후 목적지 adapter가
ready가 될 때 한 번만 복원한다. 이후 상대방이 이동해도 자동으로 따라가지 않는다.

8초 안에 목적지 resource를 복원하지 못하면 이전 route로 rollback하고 shadcn
Sonner로 `해당 팀원의 화면으로 이동할 수 없습니다`를 표시한다. 같은 아바타를
다시 누르면 기존 pending 요청을 교체하고 그 시점의 최신 대표 location으로 다시
이동한다.
