# Drive API

## 범위

Drive API는 Workspace 공유 파일 화면의 폴더, 파일, 네이티브 문서 생성과 파일 업로드,
조회, 다운로드, 이름 변경, 삭제를 담당한다.

Frontend 화면 이름은 `파일`로 둔다. Backend 도메인 이름과 API path는 `drive`를
사용한다.

1차 Domain Owner는 은재다.

- Workspace 공유 드라이브 폴더 생성
- 현재 폴더의 폴더/문서/파일 목록 조회
- 빈 네이티브 문서 생성
- S3 presigned URL 기반 파일 업로드
- S3 presigned URL 기반 파일 다운로드와 안전한 파일 형식의 앱 내 미리보기 URL 발급
- 폴더/문서/파일 이름 변경과 이동
- 폴더/문서/파일 soft delete

검색, 복구, public link share, 문서별 권한과 장기 버전 관리 UI는 이 문서의 MVP 범위가
아니다. native 문서는 `/sync/documents` Yjs WebSocket room에서 Workspace 멤버끼리 동시 편집하며,
병합된 본문은 최신 snapshot 조회와 자동 저장으로 보존한다. 파일 미리보기는 ready 상태의
PDF, raster 이미지와 허용된 텍스트 형식만 지원한다.

## 데이터 규칙

- 테이블: `drive_items`, `drive_uploads`, `documents`, `document_snapshots`,
  `document_yjs_updates`, `document_edit_sessions`
- `workspace_id`는 path의 `workspaceId`에서 온다.
- `created_by_user_id`, `updated_by_user_id`는 현재 로그인 사용자에서 온다.
- Workspace 접근 권한이 있는 모든 `owner`, `member`는 폴더/문서/파일을 조회하고,
  문서를 생성할 수 있으며, 파일은 다운로드와 업로드, 모든 Drive item은 이름 변경과
  삭제를 할 수 있다.
- `workspaceId`, `createdByUserId`, `updatedByUserId`, `objectKey`는 request body로
  받지 않는다.
- S3 object key는 서버가 생성한다. 클라이언트가 object key를 지정할 수 없다.
- Drive 파일은 uploads bucket 안에서 `drive/` prefix 아래에 저장한다. 회의 녹음,
  보고서, 스냅샷 등 다른 기능 prefix와 섞지 않는다.
- 파일 업로드는 app-server가 발급한 presigned URL로 브라우저가 S3에 직접
  `PUT`한 뒤, `complete` API로 서버에 완료를 알리는 방식이다.
- `drive_items`는 드라이브에 보이는 폴더/문서/파일 metadata source of truth다.
- `drive_uploads`는 presigned upload URL 한 번의 업로드 시도와 만료/완료 상태를
  추적한다.
- 폴더는 `itemType = 'folder'`, 파일은 `itemType = 'file'`, 네이티브 문서는
  `itemType = 'document'`다.
- root 폴더는 별도 row를 만들지 않는다. `parentId = null`이면 root 목록이다.
- 폴더는 무제한 depth를 허용한다. 단, 서버는 parent가 같은 Workspace의 활성 폴더인지
  검증한다.
- 같은 Workspace와 같은 parent 안에서는 활성 폴더/파일/문서 이름을 대소문자 구분 없이
  중복할 수 없다.
- 파일 크기 제한은 파일당 `100 MiB`다.
- 모든 MIME type을 허용한다. 실행 파일 차단과 바이러스 검사는 MVP 범위가 아니다.
- 삭제는 `deleted_at`을 사용하는 soft delete다.
- 폴더 삭제는 해당 폴더와 하위 폴더/문서/파일 전체를 soft delete하며, 하위 document
  aggregate도 함께 soft delete한다.
- 목록 조회는 활성 폴더, 네이티브 문서와 `ready` 파일만 반환한다. `pending`, `failed` 파일은 공유
  목록에 노출하지 않는다.
- 만료된 pending upload는 서버가 `expired`로 전환하고 연결된 pending file item을
  `failed` 및 soft delete 처리할 수 있다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/drive/items` | 현재 parent의 폴더/문서/파일 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/drive/folders` | 폴더 생성 |
| `POST` | `/workspaces/{workspaceId}/drive/documents` | 빈 네이티브 문서 생성 |
| `GET` | `/workspaces/{workspaceId}/drive/documents/{documentId}` | 문서와 최신 snapshot 조회 |
| `PUT` | `/workspaces/{workspaceId}/drive/documents/{documentId}/snapshot` | 문서 최신 snapshot 저장 |
| `POST` | `/workspaces/{workspaceId}/drive/files/upload-url` | 파일 metadata 생성과 presigned upload URL 발급 |
| `POST` | `/workspaces/{workspaceId}/drive/files/{fileId}/complete` | S3 업로드 완료 확인과 파일 ready 전환 |
| `GET` | `/workspaces/{workspaceId}/drive/files/{fileId}/download-url` | 파일 다운로드용 presigned URL 발급 |
| `GET` | `/workspaces/{workspaceId}/drive/files/{fileId}/preview-url` | 지원 파일 앱 내 미리보기용 presigned URL 발급 |
| `PATCH` | `/workspaces/{workspaceId}/drive/items/{itemId}` | 폴더/문서/파일 이름 변경 또는 이동 |
| `DELETE` | `/workspaces/{workspaceId}/drive/items/{itemId}` | 폴더/문서/파일 soft delete |

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

폴더와 네이티브 문서 payload는 파일 전용 값을 `null`로 반환한다.

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

문서 생성 응답의 `item`은 위 Drive Item Payload를 사용한다. `document`는 문서 본문이
아닌 저장 상태만 반환한다.

```json
{
  "id": "document_uuid",
  "driveItemId": "document_uuid",
  "workspaceId": "workspace_uuid",
  "currentVersion": 0,
  "latestSnapshotId": "document_snapshot_uuid",
  "createdAt": "2026-07-16T00:00:00.000Z",
  "updatedAt": "2026-07-16T00:00:00.000Z",
  "deletedAt": null
}
```

문서 snapshot은 Tiptap JSON projection과 Yjs 상태를 함께 저장한다. `yjsState`는 base64
문자열이며, `plainText`는 서버가 `contentJson`에서 추출한 검색/RAG 준비용 텍스트다.

```json
{
  "id": "document_snapshot_uuid",
  "version": 1,
  "yjsState": "AQID",
  "contentJson": {
    "type": "doc",
    "content": [{ "type": "paragraph" }]
  },
  "plainText": "PILO 기획서",
  "sourceUpdateSequence": 0,
  "createdAt": "2026-07-16T00:10:00.000Z"
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
- 정렬은 folder, document, file 순서이고 각 그룹 안에서는 `updatedAt DESC`, `name ASC`를
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

## 문서 생성

```http
POST /api/v1/workspaces/{workspaceId}/drive/documents
```

Request:

```json
{
  "parentId": "folder_uuid",
  "name": "새 문서"
}
```

`parentId`와 `name`은 선택 값이다. `parentId`를 생략하면 root에 생성하고, `name`을
생략하면 서버가 `새 문서`를 사용한다. 같은 parent에 같은 이름이 이미 있으면 서버는
`새 문서 (2)`, `새 문서 (3)`처럼 다음 사용 가능한 기본 이름을 사용한다. `name`을
명시한 요청은 같은 parent에 활성 item의 같은 이름이 이미 있으면 `400 BAD_REQUEST`를
반환한다.

응답:

```json
{
  "success": true,
  "data": {
    "item": {
      "id": "document_uuid",
      "workspaceId": "workspace_uuid",
      "parentId": "folder_uuid",
      "itemType": "document",
      "name": "새 문서",
      "mimeType": null,
      "sizeBytes": null,
      "uploadStatus": null,
      "createdByUser": {
        "id": "user_uuid",
        "name": "PILO User",
        "avatarUrl": null
      },
      "updatedByUser": null,
      "createdAt": "2026-07-16T00:00:00.000Z",
      "updatedAt": "2026-07-16T00:00:00.000Z",
      "deletedAt": null
    },
    "document": {
      "id": "document_uuid",
      "driveItemId": "document_uuid",
      "workspaceId": "workspace_uuid",
      "currentVersion": 0,
      "latestSnapshotId": "document_snapshot_uuid",
      "createdAt": "2026-07-16T00:00:00.000Z",
      "updatedAt": "2026-07-16T00:00:00.000Z",
      "deletedAt": null
    }
  }
}
```

서버 규칙:

- 현재 사용자가 Workspace의 `owner` 또는 `member`여야 한다.
- `parentId`가 있으면 같은 Workspace의 활성 folder여야 한다.
- 문서, Drive item, 초기 empty snapshot, `document_created` Activity Log는 하나의 DB
  transaction으로 저장한다.
- 문서 본문은 이 API에서 받거나 반환하지 않는다.

## 문서 조회

```http
GET /api/v1/workspaces/{workspaceId}/drive/documents/{documentId}
```

응답:

```json
{
  "success": true,
  "data": {
    "item": { "id": "document_uuid", "itemType": "document", "name": "새 문서" },
    "document": {
      "id": "document_uuid",
      "driveItemId": "document_uuid",
      "workspaceId": "workspace_uuid",
      "currentVersion": 1,
      "latestSnapshotId": "document_snapshot_uuid",
      "createdAt": "2026-07-16T00:00:00.000Z",
      "updatedAt": "2026-07-16T00:10:00.000Z",
      "deletedAt": null
    },
    "snapshot": {
      "id": "document_snapshot_uuid",
      "version": 1,
      "yjsState": "AQID",
      "contentJson": { "type": "doc", "content": [{ "type": "paragraph" }] },
      "plainText": "",
      "sourceUpdateSequence": 0,
      "createdAt": "2026-07-16T00:10:00.000Z"
    }
  }
}
```

서버 규칙:

- 현재 사용자는 해당 Workspace의 `owner` 또는 `member`여야 한다.
- 삭제되지 않은 같은 Workspace의 `document` item과 최신 snapshot만 반환한다.
- snapshot의 Yjs 상태와 JSON은 편집기 bootstrap 용도이며, 다운로드 파일 API를 사용하지 않는다.

## 문서 Snapshot 저장

```http
PUT /api/v1/workspaces/{workspaceId}/drive/documents/{documentId}/snapshot
```

Request:

```json
{
  "expectedVersion": 1,
  "yjsState": "AQID",
  "contentJson": {
    "type": "doc",
    "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "PILO 기획서" }] }]
  }
}
```

응답은 갱신된 `document`와 새 `snapshot`을 반환한다.

서버 규칙:

- `expectedVersion`은 현재 문서 버전과 같아야 하며, 다르면 `409 CONFLICT`를 반환한다.
- `yjsState`는 유효한 base64이고 디코딩 후 `1 MiB` 이하여야 한다.
- `contentJson`은 최상위 `type: "doc"` Tiptap JSON object이고 직렬화 후 `512 KiB` 이하여야 한다.
- 새 snapshot insert, `documents.current_version`/`latest_snapshot_id` 갱신, Drive item의
  `updatedByUser` 갱신과 Activity Log append를 하나의 transaction으로 처리한다.
- Activity Log에는 새 버전과 짧은 사실 summary만 저장하며, 문서 본문, block JSON, Yjs 상태,
  변경 전후 diff는 저장하지 않는다.
- `driveFileAttachment` block은 `{ "type": "driveFileAttachment", "attrs": { "driveItemId": "uuid" } }`
  shape만 허용한다. `driveItemId`는 같은 Workspace의 삭제되지 않은 `ready` file이어야 한다.
- attachment 변화가 있는 snapshot 저장은 변경된 각 file에 대해 `document_attachment_updated`
  Activity Log만 남긴다. 같은 저장에서 generic `document_content_updated`를 중복으로 남기지 않는다.

## 문서 Realtime 연결

```text
wss://{realtime-origin}/sync/documents
```

- Hocuspocus의 표준 Yjs sync/awareness protocol을 사용한다. 별도의 JSON mutation protocol을 만들지 않는다.
- provider의 document name은 `workspace:{workspaceId}:document:{documentId}:yjs` 형식이며, bearer token은 Hocuspocus 인증 메시지로 보낸다. URL query에 access token을 넣지 않는다.
- realtime-server는 Hocuspocus 인증 hook에서 bearer session, Workspace membership, 삭제되지 않은 `document` Drive item을 검증한다.
- Workspace `owner`, `member`는 연결과 편집이 가능하다. 인증되지 않았거나 권한이 없거나 삭제된 문서는 연결을 거부한다.
- realtime-server는 room을 만들 때 기존 문서 조회 API로 최신 snapshot을 복원하고, Hocuspocus `onStoreDocument`의 `1초` debounce와 room mutex를 이용해 최신 병합 상태를 기존 snapshot 저장 API에 checkpoint한다. raw Yjs update는 1차 MVP에서 `document_yjs_updates`에 저장하지 않는다.
- checkpoint 호출에는 Hocuspocus 인증 context의 bearer token을 메모리에서만 사용한다. token은 DB, Activity Log, metadata에 저장하지 않는다.
- realtime URL과 bearer token이 설정된 browser는 Yjs sync/awareness만 수행하며 snapshot 저장 API를 직접 호출하지 않는다. realtime transport를 설정하지 않은 로컬/장애 fallback에서만 browser가 기존 `1초` debounce autosave와 unmount flush를 수행한다.
- server checkpoint가 `409 CONFLICT`이면 최신 snapshot을 room Y.Doc에 병합하고 한 번만 재시도한다. 두 번째 충돌이나 네트워크 오류는 Hocuspocus 저장 실패로 남기며 browser가 저장 경쟁에 참여하지 않는다.
- 마지막 연결이 종료되면 `unloadImmediately`가 보류 checkpoint를 즉시 실행하고, realtime-server 종료 시에도 pending checkpoint를 flush한다. 마지막 checkpoint 뒤 최대 `1초`의 편집은 유실될 수 있다.
- document room은 현재 realtime-server process 메모리에 있다. multiple realtime task 배포 전에는 한 task로 운영하거나 load balancer가 `/sync/documents` WebSocket을 sticky routing해야 한다.

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

## 파일 미리보기 URL 발급

```http
GET /api/v1/workspaces/{workspaceId}/drive/files/{fileId}/preview-url
```

응답:

```json
{
  "success": true,
  "data": {
    "file": {
      "id": "drive_item_uuid",
      "itemType": "file",
      "name": "PILO 기획서.pdf",
      "mimeType": "application/pdf",
      "uploadStatus": "ready"
    },
    "previewUrl": "https://s3-presigned-inline-preview-url",
    "expiresAt": "2026-07-16T00:11:00.000Z"
  }
}
```

서버 규칙:

- `fileId`는 같은 Workspace의 활성 `ready` file이어야 한다.
- 허용 MIME type은 `application/pdf`, `application/json`, raster 이미지
  (`image/avif`, `image/gif`, `image/jpeg`, `image/png`, `image/webp`)와 제한된 텍스트
  형식(`text/plain`, `text/markdown`, `text/css`, `text/csv`, `text/xml`, 코드 MIME)이다.
- `text/html`, `image/svg+xml`처럼 브라우저에서 실행 가능한 형식은 미리보기 URL을
  발급하지 않는다.
- MIME type은 매개변수를 제거하고 소문자로 정규화한 뒤 allowlist와 비교한다.
- presigned URL은 `Content-Disposition: inline`과 원본의 정규화된 content type으로
  발급한다.
- bucket name, S3 object key는 응답에 포함하지 않는다.
- URL 기본 만료 시간은 `10분`이며, 미리보기 요청은 Activity Log를 남기지 않는다.

## 이름 변경 및 이동

```http
PATCH /api/v1/workspaces/{workspaceId}/drive/items/{itemId}
```

Request:

```json
{
  "name": "새 파일 이름.pdf"
}
```

이동 request는 이름 변경과 별도로 `parentId`만 보낸다. `null`은 root 이동이다.

```json
{
  "parentId": "folder_uuid"
}
```

응답은 `Drive Item Payload`와 같다.

서버 규칙:

- 현재 사용자가 해당 Workspace의 `owner` 또는 `member`이면 이름을 변경하거나 이동할 수 있다.
- `itemId`는 같은 Workspace의 활성 item이어야 한다.
- request body는 `{ name }` 또는 `{ parentId }` 중 정확히 하나만 가진다.
- 이름 변경의 `name`은 trim 후 저장한다.
- 같은 parent 안에 활성 item의 같은 이름이 이미 있으면 `400 BAD_REQUEST`를 반환한다.
- 이름 변경은 S3 object key를 변경하지 않는다.
- 이동의 `parentId`는 같은 Workspace의 활성 folder 또는 `null`이어야 한다. folder는 자신 또는
  하위 folder로 이동할 수 없다.
- document rename/move는 각각 `document_renamed`, `document_moved` Activity Log를 같은
  transaction 안에서 남긴다. 폴더와 파일의 rename/move는 Activity Log를 남기지 않는다.

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
- file/document 삭제는 해당 item의 `deleted_at`을 기록한다. document는 연결된
  `documents.deleted_at`도 같은 transaction에서 기록한다.
- folder 삭제는 recursive soft delete로 folder와 모든 하위 item의 `deleted_at`, 하위
  document aggregate의 `deleted_at`을 기록한다.
- 직접 삭제한 document는 `document_deleted` Activity Log를 같은 transaction에서 남긴다.
  folder 삭제에 포함된 하위 document별 Activity Log는 남기지 않는다.
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
| item update body | `{ name }` 또는 `{ parentId }` 중 정확히 하나 |
| 이동 parentId | `null` 또는 같은 Workspace의 활성 folder |
| folder 이동 | 자기 자신 또는 하위 folder를 parent로 지정할 수 없음 |
| 문서 저장 expectedVersion | `0` 이상의 정수이며 현재 버전과 일치해야 함 |
| 문서 snapshot Yjs 상태 | 유효한 base64, 디코딩 후 최대 `1048576` bytes |
| 문서 snapshot JSON | 최상위 `type: "doc"` object, 최대 `524288` bytes |
| 문서 파일 첨부 | `driveFileAttachment.attrs.driveItemId`는 같은 Workspace의 활성 `ready` file |

## 오류

| 조건 | Status | Code |
| --- | --- | --- |
| bearer session 없음 또는 만료 | `401` | `UNAUTHORIZED` |
| Workspace 접근 권한 없음 | `403` | `FORBIDDEN` |
| parent, item, file, upload 없음 또는 PDF 미리보기 대상이 아님 | `404` | `NOT_FOUND` |
| 이름, 크기, MIME type, upload 상태, item update body가 잘못됨 | `400` | `BAD_REQUEST` |
| 문서 저장 요청 또는 첨부 file 참조가 잘못됨 | `400` | `BAD_REQUEST` |
| 같은 parent에 같은 이름의 활성 item이 있음 | `400` | `BAD_REQUEST` |
| 문서 저장 시 최신 버전과 다름 | `409` | `CONFLICT` |
| S3 object 확인 또는 presigned URL 발급 실패 | `502` | `BAD_GATEWAY` |

## MVP 제외

- 전체 또는 현재 폴더 검색
- PDF 이외 파일 미리보기
- 문서 공동 편집
- 파일 버전 관리
- 휴지통 복구
- public link share
- Workspace quota
- 바이러스 검사
- 파일 타입 제한
- S3 object 즉시 삭제
