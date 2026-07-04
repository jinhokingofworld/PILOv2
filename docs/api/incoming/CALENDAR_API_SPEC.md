# Calendar Events API Specification

## 기준 테이블

```sql
calendar_events
```

## 공통 규칙

| 항목             | 내용                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 인증             | 로그인한 사용자만 호출 가능                                                                                                                  |
| 날짜 형식        | `YYYY-MM-DD`                                                                                                                                 |
| 시간 형식        | `HH:mm`                                                                                                                                      |
| 색상 형식        | hex color 예: `#3B82F6`                                                                                                                      |
| 등록자           | 서버가 현재 로그인 사용자로 `created_by`에 저장                                                                                              |
| 일정 ID          | `BIGSERIAL`                                                                                                                                  |
| 사용자 ID        | `UUID`                                                                                                                                       |
| 기본 색상        | `#3B82F6`                                                                                                                                    |
| 기본 종일 여부   | `true`                                                                                                                                       |
| 종료 시간 기본값 | 시간 지정 일정에서 `endTime`이 없으면 `startDate + startTime + 1시간`으로 종료 일시를 계산하고, 날짜가 바뀌면 `endDate`도 계산된 날짜로 저장 |
| 설명 응답        | `description`이 비어 있으면 `null`                                                                                                           |
| 응답 일시 형식   | `createdAt`, `updatedAt`은 `TIMESTAMPTZ` 기준의 시간대 포함 값                                                                               |
| 생성일           | DB 기본값 `now()`                                                                                                                            |
| 수정일           | DB 기본값 `now()`, 수정 시 `update_updated_at_column()` 트리거로 갱신                                                                        |

## 필드 매핑

| API 필드      | DB 컬럼       | 타입           | 필수   | 설명                          |
| ------------- | ------------- | -------------- | ------ | ----------------------------- |
| `id`          | `id`          | number         | Y      | 일정 ID                       |
| `title`       | `title`       | string         | Y      | 일정 제목                     |
| `description` | `description` | string \| null | N      | 일정 설명. 비어 있으면 `null` |
| `color`       | `color`       | string         | Y      | 일정 색상                     |
| `isAllDay`    | `is_all_day`  | boolean        | Y      | 종일 일정 여부                |
| `startDate`   | `start_date`  | string         | Y      | 시작 날짜                     |
| `endDate`     | `end_date`    | string         | Y      | 종료 날짜                     |
| `startTime`   | `start_time`  | string \| null | 조건부 | 시작 시간                     |
| `endTime`     | `end_time`    | string \| null | 조건부 | 종료 시간                     |
| `createdBy`   | `created_by`  | string         | Y      | 등록자 UUID                   |
| `createdAt`   | `created_at`  | string         | Y      | 생성 일시, `TIMESTAMPTZ`      |
| `updatedAt`   | `updated_at`  | string         | Y      | 수정 일시, `TIMESTAMPTZ`      |

## DB 제약 조건

| 제약                | 조건                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| 날짜 순서           | `end_date >= start_date`                                                                        |
| 종일 일정 시간      | `is_all_day = true`이면 `start_time IS NULL` 그리고 `end_time IS NULL`                          |
| 시간 지정 일정 시간 | `is_all_day = false`이면 `start_time IS NOT NULL` 그리고 `end_time IS NOT NULL`                 |
| 시간 순서           | `is_all_day = true`이거나, `end_date > start_date`이거나, 같은 날짜에서 `end_time > start_time` |

---

## 1. 일정 목록 조회

```http
GET /api/calendar/events?start=2026-07-01&end=2026-07-31
```

지정한 기간에 포함되는 일정을 조회합니다.

서버 조회 조건:

```sql
start_date <= end
AND end_date >= start
```

### Query Parameters

| 이름    | 타입   | 필수 | 설명           |
| ------- | ------ | ---- | -------------- |
| `start` | string | Y    | 조회 시작 날짜 |
| `end`   | string | Y    | 조회 종료 날짜 |

### Response 200

```json
[
  {
    "id": 1,
    "title": "팀 회의",
    "description": "주간 회의",
    "color": "#3B82F6",
    "isAllDay": false,
    "startDate": "2026-07-03",
    "endDate": "2026-07-03",
    "startTime": "14:00",
    "endTime": "15:00",
    "createdBy": "550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2026-07-03T10:00:00Z",
    "updatedAt": "2026-07-03T10:00:00Z"
  }
]
```

---

## 2. 일정 상세 조회

```http
GET /api/calendar/events/{eventId}
```

### Path Parameters

| 이름      | 타입   | 필수 | 설명    |
| --------- | ------ | ---- | ------- |
| `eventId` | number | Y    | 일정 ID |

### Response 200

```json
{
  "id": 1,
  "title": "팀 회의",
  "description": "주간 회의",
  "color": "#3B82F6",
  "isAllDay": false,
  "startDate": "2026-07-03",
  "endDate": "2026-07-03",
  "startTime": "14:00",
  "endTime": "15:00",
  "createdBy": "550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2026-07-03T10:00:00Z",
  "updatedAt": "2026-07-03T10:00:00Z"
}
```

---

## 3. 일정 생성

```http
POST /api/calendar/events
```

`createdBy`는 요청 본문에 포함하지 않습니다. 서버가 현재 로그인 사용자 UUID로 저장합니다.

### Request Body

| 필드          | 타입    | 필수   | 설명                                                                              |
| ------------- | ------- | ------ | --------------------------------------------------------------------------------- |
| `title`       | string  | Y      | 일정 제목                                                                         |
| `description` | string  | N      | 일정 설명. 비어 있으면 응답에서 `null`                                            |
| `color`       | string  | N      | 일정 색상. 생략 시 DB 기본값 `#3B82F6`                                            |
| `isAllDay`    | boolean | N      | 종일 일정 여부. 생략 시 DB 기본값 `true`                                          |
| `startDate`   | string  | Y      | 시작 날짜                                                                         |
| `endDate`     | string  | Y      | 종료 날짜                                                                         |
| `startTime`   | string  | 조건부 | `isAllDay: false`인 경우 필수                                                     |
| `endTime`     | string  | N      | `isAllDay: false`에서 생략하면 `startDate + startTime + 1시간`으로 종료 일시 계산 |

### 시간 지정 일정 Request Example

```json
{
  "title": "팀 회의",
  "description": "주간 회의",
  "color": "#3B82F6",
  "isAllDay": false,
  "startDate": "2026-07-03",
  "endDate": "2026-07-03",
  "startTime": "14:00",
  "endTime": "15:00"
}
```

### 종일 일정 Request Example

```json
{
  "title": "워크숍",
  "description": "전사 워크숍",
  "color": "#10B981",
  "isAllDay": true,
  "startDate": "2026-07-10",
  "endDate": "2026-07-12"
}
```

### Response 201

```json
{
  "id": 2,
  "title": "워크숍",
  "description": "전사 워크숍",
  "color": "#10B981",
  "isAllDay": true,
  "startDate": "2026-07-10",
  "endDate": "2026-07-12",
  "startTime": null,
  "endTime": null,
  "createdBy": "550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2026-07-03T11:00:00Z",
  "updatedAt": "2026-07-03T11:00:00Z"
}
```

---

## 4. 일정 수정

```http
PATCH /api/calendar/events/{eventId}
```

일정 정보를 부분 수정합니다.

### Path Parameters

| 이름      | 타입   | 필수 | 설명    |
| --------- | ------ | ---- | ------- |
| `eventId` | number | Y    | 일정 ID |

### Request Body

| 필드          | 타입           | 필수   | 설명                                                                              |
| ------------- | -------------- | ------ | --------------------------------------------------------------------------------- |
| `title`       | string         | N      | 일정 제목                                                                         |
| `description` | string \| null | N      | 일정 설명. 비어 있으면 응답에서 `null`                                            |
| `color`       | string         | N      | 일정 색상                                                                         |
| `isAllDay`    | boolean        | N      | 종일 일정 여부                                                                    |
| `startDate`   | string         | N      | 시작 날짜                                                                         |
| `endDate`     | string         | N      | 종료 날짜                                                                         |
| `startTime`   | string \| null | 조건부 | `isAllDay: false`인 경우 `null` 불가                                              |
| `endTime`     | string \| null | N      | `isAllDay: false`에서 생략하면 `startDate + startTime + 1시간`으로 종료 일시 계산 |

### Request Example

```json
{
  "title": "팀 회의 시간 변경",
  "color": "#F97316",
  "isAllDay": false,
  "startDate": "2026-07-03",
  "endDate": "2026-07-03",
  "startTime": "15:00",
  "endTime": "16:00"
}
```

### Response 200

```json
{
  "id": 1,
  "title": "팀 회의 시간 변경",
  "description": "주간 회의",
  "color": "#F97316",
  "isAllDay": false,
  "startDate": "2026-07-03",
  "endDate": "2026-07-03",
  "startTime": "15:00",
  "endTime": "16:00",
  "createdBy": "550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2026-07-03T10:00:00Z",
  "updatedAt": "2026-07-03T12:00:00Z"
}
```

---

## 5. 일정 삭제

```http
DELETE /api/calendar/events/{eventId}
```

### Path Parameters

| 이름      | 타입   | 필수 | 설명    |
| --------- | ------ | ---- | ------- |
| `eventId` | number | Y    | 일정 ID |

### Response 204

```http
204 No Content
```

---

## 공통 에러

| Status | 상황                                                |
| ------ | --------------------------------------------------- |
| `400`  | 필수값 누락, 날짜/시간 형식 오류, DB 제약 조건 위반 |
| `401`  | 로그인하지 않음                                     |
| `403`  | 수정/삭제 권한 없음                                 |
| `404`  | 일정 없음                                           |

### Error Response Example

```json
{
  "message": "종일 일정이 아닌 경우 시작 시간은 필수입니다."
}
```
