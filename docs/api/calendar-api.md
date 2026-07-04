# Calendar API

## 범위

Calendar API는 Workspace 일정만 담당한다. MVP 캘린더는 GitHub issue, PR,
회의, 회의록을 자동으로 캘린더에 섞지 않는다.

## 데이터 규칙

- 테이블: `calendar_events`
- `workspace_id`는 path의 `workspaceId`에서 온다.
- `created_by`는 현재 로그인 사용자에서 온다.
- Workspace 접근 권한이 있는 모든 사용자는 MVP에서 일정을 생성, 조회, 수정, 삭제할 수 있다.
- `startDate`, `endDate`는 `YYYY-MM-DD` 형식이다.
- `startTime`, `endTime`은 `HH:mm` 형식이며 `isAllDay = false`일 때만 필수다.
- 기본 `color`는 `#3B82F6`이다.
- 반복 일정, 알림, 외부 캘린더 연동은 제외한다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/calendar/events` | Date range 기준 일정 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/calendar/events/{eventId}` | 일정 상세 조회 |
| `POST` | `/workspaces/{workspaceId}/calendar/events` | 일정 생성 |
| `PATCH` | `/workspaces/{workspaceId}/calendar/events/{eventId}` | 일정 수정 |
| `DELETE` | `/workspaces/{workspaceId}/calendar/events/{eventId}` | 일정 삭제 |

## 목록 Query

```http
GET /api/v1/workspaces/{workspaceId}/calendar/events?start=2026-07-01&end=2026-07-31
```

서버는 요청 기간과 겹치는 일정을 반환한다.

```sql
start_date <= :end
AND end_date >= :start
```

## Event Payload

```json
{
  "id": 1,
  "title": "Team meeting",
  "description": "Weekly sync",
  "color": "#3B82F6",
  "isAllDay": false,
  "startDate": "2026-07-03",
  "endDate": "2026-07-03",
  "startTime": "14:00",
  "endTime": "15:00",
  "createdBy": "user_uuid",
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

## 일정 생성

```json
{
  "title": "Team meeting",
  "description": "Weekly sync",
  "color": "#3B82F6",
  "isAllDay": false,
  "startDate": "2026-07-03",
  "endDate": "2026-07-03",
  "startTime": "14:00",
  "endTime": "15:00"
}
```

`createdBy`, `workspaceId`는 request body로 받지 않는다.

## Validation

| 규칙 | 조건 |
| --- | --- |
| 날짜 순서 | `endDate >= startDate` |
| 종일 일정 시간 | `isAllDay = true`이면 `startTime = null`, `endTime = null` |
| 시간 지정 일정 | `isAllDay = false`이면 `startTime`, `endTime` 필수 |
| 시간 순서 | 같은 날짜의 시간 지정 일정은 `endTime > startTime` |

## MVP 제외

- 반복 일정
- 일정 알림
- Google/Outlook calendar sync
- GitHub issue/PR 자동 일정
