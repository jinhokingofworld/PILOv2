# Calendar API

## 범위

Calendar API는 Workspace 일정 CRUD를 담당한다. MVP Calendar는 GitHub issue, PR,
meeting, meeting report를 자동으로 Calendar에 넣지 않는다.

## 데이터 규칙

- 테이블: `calendar_events`
- `workspace_id`는 path의 `workspaceId`에서 온다.
- `created_by`는 현재 로그인 사용자에서 온다.
- Workspace 접근 권한이 있는 모든 사용자는 MVP에서 일정을 생성, 조회, 수정, 삭제할 수 있다.
- `createdBy`, `workspaceId`는 request body로 받지 않는다.
- `startDate`, `endDate`는 `YYYY-MM-DD` 형식이며, `endDate`를 생략하면 서버가 `startDate`와 같은 날짜로 정규화한다.
- `startTime`, `endTime`은 `HH:mm` 형식이며 `isAllDay = false`일 때 사용한다.
- `isAllDay = false`이고 `endTime`이 생략되면 서버는 `startTime + 1시간`으로 정규화한다.
- `startTime + 1시간`이 다음 날짜로 넘어가면 서버는 `endDate`도 함께 다음 날짜로 정규화한다.
- 기본 `color`는 `#3B82F6`이다.
- 반복 일정, 알림, 외부 Calendar 연동은 제외한다.

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
  "createdByUser": {
    "id": "user_uuid",
    "name": "Sein",
    "avatarUrl": "https://example.com/avatar.png"
  },
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

`createdByUser`는 Calendar UI 표시용 사용자 요약 정보다. Email, provider id, token,
encrypted token은 포함하지 않는다.

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

`endDate`는 생략할 수 있으며, 생략하면 서버가 `startDate`와 같은 날짜로 정규화한다. `isAllDay = true`인 종일 일정에는 `startTime`과 `endTime`이 필요하지 않고 저장하지 않는다. `endTime`은 `isAllDay = false`일 때 생략할 수 있으며, 생략하면 서버가 `startTime + 1시간`으로 정규화한 값을 저장하고 응답한다.

예:

```json
{
  "title": "Team meeting",
  "isAllDay": false,
  "startDate": "2026-07-03",
  "startTime": "14:00"
}
```

정규화 후 저장/응답:

```json
{
  "startDate": "2026-07-03",
  "endDate": "2026-07-03",
  "startTime": "14:00",
  "endTime": "15:00"
}
```

`createdBy`, `workspaceId`는 request body로 받지 않는다.

## 일정 수정

```http
PATCH /api/v1/workspaces/{workspaceId}/calendar/events/{eventId}
```

Request body에는 변경할 필드만 보낸다. `startTime` 또는 `isAllDay`를 변경하고
`isAllDay = false`인 상태에서 `endTime`이 생략되면 서버가 `startTime + 1시간`으로
정규화한다. `endDate`만 변경하는 요청은 기존 `endTime`을 유지한다.

## 일정 삭제

```http
DELETE /api/v1/workspaces/{workspaceId}/calendar/events/{eventId}
```

응답:

```json
{
  "success": true,
  "data": {
    "id": 1
  }
}
```

## Validation

| 규칙 | 조건 |
| --- | --- |
| 제목 | 빈 문자열 불가 |
| 제목 길이 | 최대 255자 |
| 색상 | `#RRGGBB` 형식 |
| 날짜 순서 | `endDate >= startDate` |
| 종일 일정 시간 | `isAllDay = true`이면 `startTime = null`, `endTime = null` |
| 시간 지정 일정 | `isAllDay = false`이면 `startTime` 필수, `endTime` 생략 가능 |
| 시간 정규화 | `isAllDay = false`이고 `endTime` 생략 시 `startTime + 1시간` |
| 시간 순서 | 같은 날짜의 시간 지정 일정은 정규화 후 `endTime > startTime` |

## MVP 제외

- 반복 일정
- 일정 알림
- Google/Outlook calendar sync
- GitHub issue/PR 자동 일정
