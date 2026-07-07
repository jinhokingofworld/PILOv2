# Drive API

## 범위

Drive API는 Workspace 공유 파일 화면의 폴더와 파일 업로드, 조회, 다운로드,
이름 변경, 삭제를 담당한다.

Frontend 화면 이름은 `파일`로 둔다. Backend 도메인 이름과 API path는 `drive`를
사용한다.

1차 Domain Owner는 은재다.

- Workspace 공유 드라이브 폴더 생성
- 현재 폴더의 폴더/파일 목록 조회
- S3 presigned URL 기반 파일 업로드
- S3 presigned URL 기반 파일 다운로드
- 폴더/파일 이름 변경
- 폴더/파일 soft delete

파일 미리보기, 검색, 이동, 복구, public link share, 문서 공동 편집, 버전 관리는
이 문서의 MVP 범위가 아니다.

## 데이터 규칙

- 테이블: `drive_items`, `drive_uploads`
- `workspace_id`는 path의 `workspaceId`에서 온다.
- `created_by_user_id`, `updated_by_user_id`는 현재 로그인 사용자에서 온다.
- Workspace 접근 권한이 있는 모든 `owner`, `member`는 폴더/파일을 조회, 다운로드,
  업로드, 이름 변경, 삭제할 수 있다.
- `workspaceId`, `createdByUserId`, `updatedByUserId`, `objectKey`는 request body로
  받지 않는다.
- S3 object key는 서버가 생성한다. 클라이언트가 object key를 지정할 수 없다.
- Drive 파일은 uploads bucket 안에서 `drive/` prefix 아래에 저장한다. 회의 녹음,
  보고서, 스냅샷 등 다른 기능 prefix와 섞지 않는다.
- 파일 업로드는 app-server가 발급한 presigned URL로 브라우저가 S3에 직접
  `PUT`한 뒤, `complete` API로 서버에 완료를 알리는 방식이다.
- `drive_items`는 드라이브에 보이는 폴더/파일 metadata source of truth다.
- `drive_uploads`는 presigned upload URL 한 번의 업로드 시도와 만료/완료 상태를
  추적한다.
- 폴더는 `itemType = 'folder'`, 파일은 `itemType = 'file'`이다.
- root 폴더는 별도 row를 만들지 않는다. `parentId = null`이면 root 목록이다.
- 폴더는 무제한 depth를 허용한다. 단, 서버는 parent가 같은 Workspace의 활성 폴더인지
  검증한다.
- 같은 Workspace와 같은 parent 안에서는 활성 폴더/파일 이름을 대소문자 구분 없이
  중복할 수 없다.
- 파일 크기 제한은 파일당 `100 MiB`다.
- 모든 MIME type을 허용한다. 실행 파일 차단과 바이러스 검사는 MVP 범위가 아니다.
- 삭제는 `deleted_at`을 사용하는 soft delete다.
- 폴더 삭제는 해당 폴더와 하위 폴더/파일 전체를 soft delete한다.
- 목록 조회는 활성 폴더와 `ready` 파일만 반환한다. `pending`, `failed` 파일은 공유
  목록에 노출하지 않는다.
- 만료된 pending upload는 서버가 `expired`로 전환하고 연결된 pending file item을
  `failed` 및 soft delete 처리할 수 있다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/drive/items` | 현재 parent의 폴더/파일 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/drive/folders` | 폴더 생성 |
| `POST` | `/workspaces/{workspaceId}/drive/files/upload-url` | 파일 metadata 생성과 presigned upload URL 발급 |
| `POST` | `/workspaces/{workspaceId}/drive/files/{fileId}/complete` | S3 업로드 완료 확인과 파일 ready 전환 |
| `GET` | `/workspaces/{workspaceId}/drive/files/{fileId}/download-url` | 파일 다운로드용 presigned URL 발급 |
| `PATCH` | `/workspaces/{workspaceId}/drive/items/{itemId}` | 폴더/파일 이름 변경 |
| `DELETE` | `/workspaces/{workspaceId}/drive/items/{itemId}` | 폴더/파일 soft delete |

Endpoint 표는 공통 API 문서 규칙에 따라 `/api/v1` base path를 생략한다.

## Drive Item Payload

API 응답은 S3 bucket name, object key, presigned URL 생성을 위한 내부 값을 노출하지
않는다.

```json
{
  "id": "drive_item_uuid",
  "workspaceId": "workspace_uuid",
  "parentId": null,
  "itemType": "file",
  "name": "PILO 기획서.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 1048576,
  "uploadStatus": "ready",
  "createdByUser": {
    "id": "user_uuid",
    "name": "PILO User",
    "avatarUrl": null
  },
  "updatedByUser": {
    "id": "user_uuid",
    "name": "PILO User",
    "avatarUrl": null
  },
  "createdAt": "2026-07-07T00:00:00.000Z",
  "updatedAt": "2026-07-07T00:00:00.000Z",
  "deletedAt": null
}
```

폴더 payload는 파일 전용 값을 `null`로 반환한다.

```json
{
  "id": "folder_uuid",
  "workspaceId": "workspace_uuid",
  "parentId": null,
  "itemType": "folder",
  "name": "회의 자료",
  "mimeType": null,
  "sizeBytes": null,
  "uploadStatus": null,
  "createdByUser": {
    "id": "user_uuid",
    "name": "PILO User",
    "avatarUrl": null
  },
  "updatedByUser": null,
  "createdAt": "2026-07-07T00:00:00.000Z",
  "updatedAt": "2026-07-07T00:00:00.000Z",
  "deletedAt": null
}
```

## Upload Payload

```json
{
  "id": "drive_upload_uuid",
  "fileId": "drive_item_uuid",
  "status": "pending",
  "method": "PUT",
  "uploadUrl": "https://s3-presigned-upload-url",
  "headers": {
    "Content-Type": "application/pdf"
  },
  "expiresAt": "2026-07-07T00:10:00.000Z"
}
```

`headers`에 포함된 값은 프론트가 S3 `PUT` 요청에 그대로 넣어야 한다.

## 목록 조회

```http
GET /api/v1/workspaces/{workspaceId}/drive/items?parentId=folder_uuid
```

Query:

| Query | 설명 |
| --- | --- |
| `parentId` | 조회할 폴더 id. 생략하면 root 목록 |

응답:

```json
{
  "success": true,
  "data": {
    "parent": null,
    "breadcrumbs": [],
    "items": [
      {
        "id": "folder_uuid",
        "workspaceId": "workspace_uuid",
        "parentId": null,
        "itemType": "folder",
        "name": "회의 자료",
        "mimeType": null,
        "sizeBytes": null,
        "uploadStatus": null,
        "createdByUser": {
          "id": "user_uuid",
          "name": "PILO User",
          "avatarUrl": null
        },
        "updatedByUser": null,
        "createdAt": "2026-07-07T00:00:00.000Z",
        "updatedAt": "2026-07-07T00:00:00.000Z",
        "deletedAt": null
      }
    ]
  }
}
```

서버 규칙:

- 현재 사용자가 해당 Workspace의 `owner` 또는 `member`가 아니면 `403 FORBIDDEN`을
  반환한다.
- `parentId`가 없으면 root 목록을 조회한다.
- `parentId`가 있으면 같은 Workspace의 활성 folder여야 한다.
- 삭제된 item과 `pending`, `failed` file은 반환하지 않는다.
- 정렬은 folder 먼저, file 나중이며 각 그룹 안에서는 `updatedAt DESC`, `name ASC`를
  기본값으로 한다.

## 폴더 생성

```http
POST /api/v1/workspaces/{workspaceId}/drive/folders
```

Request:

```json
{
  "parentId": null,
  "name": "회의 자료"
}
```

응답:

```json
{
  "success": true,
  "data": {
    "id": "folder_uuid",
    "workspaceId": "workspace_uuid",
    "parentId": null,
    "itemType": "folder",
    "name": "회의 자료",
    "mimeType": null,
    "sizeBytes": null,
    "uploadStatus": null,
    "createdByUser": {
      "id": "user_uuid",
      "name": "PILO User",
      "avatarUrl": null
    },
    "updatedByUser": null,
    "createdAt": "2026-07-07T00:00:00.000Z",
    "updatedAt": "2026-07-07T00:00:00.000Z",
    "deletedAt": null
  }
}
```

서버 규칙:

- `parentId`가 있으면 같은 Workspace의 활성 folder여야 한다.
- 같은 parent 안에 활성 item의 같은 이름이 이미 있으면 `400 BAD_REQUEST`를 반환한다.
- `name`은 trim 후 저장한다.

## Upload URL 발급

```http
POST /api/v1/workspaces/{workspaceId}/drive/files/upload-url
```

Request:

```json
{
  "parentId": null,
  "name": "PILO 기획서.pdf",
  "sizeBytes": 1048576,
  "mimeType": "application/pdf"
}
```

응답:

```json
{
  "success": true,
  "data": {
    "file": {
      "id": "drive_item_uuid",
      "workspaceId": "workspace_uuid",
      "parentId": null,
      "itemType": "file",
      "name": "PILO 기획서.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": 1048576,
      "uploadStatus": "pending",
      "createdByUser": {
        "id": "user_uuid",
        "name": "PILO User",
        "avatarUrl": null
      },
      "updatedByUser": null,
      "createdAt": "2026-07-07T00:00:00.000Z",
      "updatedAt": "2026-07-07T00:00:00.000Z",
      "deletedAt": null
    },
    "upload": {
      "id": "drive_upload_uuid",
      "fileId": "drive_item_uuid",
      "status": "pending",
      "method": "PUT",
      "uploadUrl": "https://s3-presigned-upload-url",
      "headers": {
        "Content-Type": "application/pdf"
      },
      "expiresAt": "2026-07-07T00:10:00.000Z"
    }
  }
}
```

서버 규칙:

- `parentId`가 있으면 같은 Workspace의 활성 folder여야 한다.
- `sizeBytes`는 `0` 이상 `104857600` 이하만 허용한다.
- `mimeType`은 빈 문자열이 아니어야 한다.
- 서버는 `drive_items`에 `pending` file row를 생성한다.
- 서버는 `drive_uploads`에 `pending` upload row를 생성한다.
- 서버는 `S3_UPLOADS_BUCKET`에 저장할 object key를 직접 생성한다.
- object key는 `drive/workspaces/{workspaceId}/items/{fileId}/{safeFileName}` 형식을
  기본값으로 한다.
- presigned upload URL 기본 만료 시간은 `10분`이다.
- 같은 parent 안에 활성 item의 같은 이름이 이미 있으면 `400 BAD_REQUEST`를 반환한다.

## Upload 완료

```http
POST /api/v1/workspaces/{workspaceId}/drive/files/{fileId}/complete
```

Request:

```json
{
  "uploadId": "drive_upload_uuid"
}
```

응답:

```json
{
  "success": true,
  "data": {
    "id": "drive_item_uuid",
    "workspaceId": "workspace_uuid",
    "parentId": null,
    "itemType": "file",
    "name": "PILO 기획서.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 1048576,
    "uploadStatus": "ready",
    "createdByUser": {
      "id": "user_uuid",
      "name": "PILO User",
      "avatarUrl": null
    },
    "updatedByUser": {
      "id": "user_uuid",
      "name": "PILO User",
      "avatarUrl": null
    },
    "createdAt": "2026-07-07T00:00:00.000Z",
    "updatedAt": "2026-07-07T00:01:00.000Z",
    "deletedAt": null
  }
}
```

서버 규칙:

- `fileId`는 같은 Workspace의 활성 `pending` file이어야 한다.
- `uploadId`는 해당 file에 연결된 `pending` upload여야 한다.
- upload가 만료되었으면 `400 BAD_REQUEST`를 반환하고, upload를 `expired`로
  전환할 수 있다.
- 서버는 S3 `HeadObject`로 object 존재 여부와 크기를 확인한다.
- S3 object가 없으면 `400 BAD_REQUEST`를 반환한다.
- S3 object size가 요청한 `expectedSizeBytes`와 다르거나 `100 MiB`를 초과하면
  `400 BAD_REQUEST`를 반환한다.
- 검증이 성공하면 `drive_uploads.status = 'completed'`,
  `drive_items.upload_status = 'ready'`로 전환한다.

## Download URL 발급

```http
GET /api/v1/workspaces/{workspaceId}/drive/files/{fileId}/download-url
```

응답:

```json
{
  "success": true,
  "data": {
    "file": {
      "id": "drive_item_uuid",
      "workspaceId": "workspace_uuid",
      "parentId": null,
      "itemType": "file",
      "name": "PILO 기획서.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": 1048576,
      "uploadStatus": "ready",
      "createdByUser": {
        "id": "user_uuid",
        "name": "PILO User",
        "avatarUrl": null
      },
      "updatedByUser": {
        "id": "user_uuid",
        "name": "PILO User",
        "avatarUrl": null
      },
      "createdAt": "2026-07-07T00:00:00.000Z",
      "updatedAt": "2026-07-07T00:01:00.000Z",
      "deletedAt": null
    },
    "downloadUrl": "https://s3-presigned-download-url",
    "expiresAt": "2026-07-07T00:11:00.000Z"
  }
}
```

서버 규칙:

- `fileId`는 같은 Workspace의 활성 `ready` file이어야 한다.
- folder, pending file, failed file은 다운로드 URL을 발급하지 않는다.
- presigned download URL 기본 만료 시간은 `10분`이다.
- 다운로드 응답은 원본 파일명을 `Content-Disposition` filename으로 사용할 수 있게
  발급한다.

## 이름 변경

```http
PATCH /api/v1/workspaces/{workspaceId}/drive/items/{itemId}
```

Request:

```json
{
  "name": "새 파일 이름.pdf"
}
```

응답은 `Drive Item Payload`와 같다.

서버 규칙:

- 현재 사용자가 해당 Workspace의 `owner` 또는 `member`이면 이름을 변경할 수 있다.
- `itemId`는 같은 Workspace의 활성 item이어야 한다.
- `name`은 trim 후 저장한다.
- 같은 parent 안에 활성 item의 같은 이름이 이미 있으면 `400 BAD_REQUEST`를 반환한다.
- 이름 변경은 S3 object key를 변경하지 않는다.

## 삭제

```http
DELETE /api/v1/workspaces/{workspaceId}/drive/items/{itemId}
```

응답:

```json
{
  "success": true,
  "data": {
    "id": "drive_item_uuid",
    "deleted": true,
    "deletedItemCount": 3
  }
}
```

서버 규칙:

- 현재 사용자가 해당 Workspace의 `owner` 또는 `member`이면 삭제할 수 있다.
- `itemId`는 같은 Workspace의 활성 item이어야 한다.
- file 삭제는 해당 file row의 `deleted_at`을 기록한다.
- folder 삭제는 recursive soft delete로 folder와 모든 하위 item의 `deleted_at`을
  기록한다.
- MVP에서는 S3 object를 즉시 삭제하지 않는다. S3 실제 삭제 또는 lifecycle cleanup은
  후속 작업으로 둔다.

## Validation

| 규칙 | 조건 |
| --- | --- |
| 이름 | trim 후 빈 문자열 불가 |
| 이름 길이 | 최대 255자 |
| 예약 이름 | `.`, `..` 불가 |
| 이름 문자 | `/`, `\` 포함 불가 |
| parentId | 생략 가능. 값이 있으면 같은 Workspace의 활성 folder |
| sibling 이름 | 같은 parent의 활성 item끼리 대소문자 구분 없이 중복 불가 |
| 파일 크기 | `0 <= sizeBytes <= 104857600` |
| MIME type | 빈 문자열 불가, 최대 255자 |
| upload 완료 | S3 object가 존재하고 expected size와 일치해야 함 |

## 오류

| 조건 | Status | Code |
| --- | --- | --- |
| bearer session 없음 또는 만료 | `401` | `UNAUTHORIZED` |
| Workspace 접근 권한 없음 | `403` | `FORBIDDEN` |
| parent, item, file, upload 없음 | `404` | `NOT_FOUND` |
| 이름, 크기, MIME type, upload 상태가 잘못됨 | `400` | `BAD_REQUEST` |
| 같은 parent에 같은 이름의 활성 item이 있음 | `400` | `BAD_REQUEST` |
| S3 object 확인 또는 presigned URL 발급 실패 | `502` | `BAD_GATEWAY` |

## MVP 제외

- 파일/폴더 이동
- 전체 또는 현재 폴더 검색
- 파일 미리보기
- 문서 공동 편집
- 파일 버전 관리
- 휴지통 복구
- public link share
- Workspace quota
- 바이러스 검사
- 파일 타입 제한
- S3 object 즉시 삭제
