# 파일 MVP 구현 체크리스트

작성일: 2026-07-07

이 문서는 Workspace 공유 파일 기능을 구현할 때 따라갈 작업 순서를 정리한다.
구현 기준 계약은 `docs/api/drive-api.md`, DB schema 기준은
`db/migrations/014_create_drive_items_and_uploads.sql`을 따른다.

## 1. 작업 준비와 영향 범위 확인

- [ ] 현재 브랜치가 `origin/dev` 기준 작업 브랜치인지 확인한다.
- [ ] `docs/api/drive-api.md`의 MVP 범위와 제외 범위를 다시 확인한다.
- [ ] `db/migrations/014_create_drive_items_and_uploads.sql` 번호가 최신 `dev`와 충돌하지 않는지 확인한다.
- [ ] DB schema 변경이므로 DB Schema owner 확인 대상임을 PR 본문에 명시한다.
- [ ] Drive 1차 owner가 은재임을 작업 범위에 명시한다.
- [ ] S3는 기존 uploads bucket을 사용하고, 파일 object key는 `drive/` prefix로 분리한다.
- [ ] App Server 공통 영역 변경이 필요한 항목을 정리한다.
- [ ] Frontend 공통 영역 변경이 필요한 항목을 정리한다.
- [ ] `docs/AgentPostMVP.md`를 같은 PR에 포함할지 최종 확인한다.

## 2. 인프라와 환경 변수 준비

- [ ] app-server가 `S3_UPLOADS_BUCKET`을 읽을 수 있는지 확인한다.
- [ ] dev 환경에서 uploads bucket 이름이 app-server 환경 변수로 주입되는지 확인한다.
- [ ] S3 object key prefix를 `drive/workspaces/{workspaceId}/items/{fileId}/{safeFileName}`로 고정한다.
- [ ] uploads bucket CORS에 브라우저 presigned upload/download 흐름이 가능한지 확인한다.
- [ ] CORS 허용 method에 `PUT`, `GET`, `HEAD`가 포함되는지 확인한다.
- [ ] CORS 허용 header에 `Content-Type`, `x-amz-*`가 포함되는지 확인한다.
- [ ] CORS expose header에 `ETag`가 필요한지 확인한다.
- [ ] app-server IAM 권한에 `s3:PutObject`, `s3:GetObject`, `s3:HeadObject`가 충분한지 확인한다.
- [ ] Drive용 별도 bucket을 만들지 않고 uploads bucket의 `drive/` prefix를 사용하는 것으로 문서화한다.

## 3. App Server 의존성과 공통 영역 반영

- [ ] `apps/app-server/package.json`에 S3 client 의존성을 추가한다.
- [ ] presigned URL 발급용 의존성을 추가한다.
- [ ] 의존성 설치 후 `package-lock.json` 변경을 확인한다.
- [ ] `src/app.module.ts`에 `DriveModule`을 등록한다.
- [ ] `src/modules/README.md`에 `drive` 모듈을 추가할지 확인한다.
- [ ] 공통 영역 변경 사유, 영향 범위, 검증 방법을 PR 본문에 적을 수 있게 정리한다.

## 4. DB Migration 적용 기준 확인

- [ ] `drive_items` 테이블이 폴더와 파일 metadata를 모두 표현하는지 확인한다.
- [ ] `drive_uploads` 테이블이 presigned upload 한 번의 시도를 추적하는지 확인한다.
- [ ] `drive_items.parent_id`가 같은 Workspace 안의 item만 참조하도록 FK가 잡혔는지 확인한다.
- [ ] 폴더 row는 `object_key`, `mime_type`, `size_bytes`, `upload_status`가 모두 `NULL`인지 확인한다.
- [ ] 파일 row는 `object_key`, `mime_type`, `size_bytes`, `upload_status`가 모두 필요한지 확인한다.
- [ ] 같은 parent 안에서 활성 item 이름 중복을 막는 unique index를 확인한다.
- [ ] `deleted_at IS NULL` 조건이 중복 이름 제약에 들어가 있는지 확인한다.
- [ ] `object_key` unique index를 확인한다.
- [ ] `pending` upload 정리용 index가 있는지 확인한다.
- [ ] RLS가 baseline all-deny로 활성화되는지 확인한다.
- [ ] 가능하면 로컬 Postgres에 migration을 적용해 문법을 검증한다.

## 5. Drive Backend 모듈 골격 작성

- [ ] `apps/app-server/src/modules/drive/drive.module.ts`를 만든다.
- [ ] `drive.controller.ts`를 만든다.
- [ ] `drive.service.ts`를 만든다.
- [ ] `drive-storage.service.ts` 또는 동등한 S3 adapter를 만든다.
- [ ] `dto/`, `types/`, `queries/` 폴더를 필요한 만큼 만든다.
- [ ] `WorkspaceModule`, `DatabaseModule`, `CommonModule` import를 맞춘다.
- [ ] 모든 endpoint에 `AuthGuard`를 적용한다.
- [ ] 모든 service method 시작에서 `WorkspaceService.assertWorkspaceAccess`를 호출한다.
- [ ] request body의 `workspaceId`, `userId`, `objectKey`를 받지 않도록 한다.

## 6. Backend 공통 검증 로직 구현

- [ ] UUID 형식 검증 helper를 둔다.
- [ ] 파일/폴더 이름 trim 검증을 구현한다.
- [ ] 빈 이름, 255자 초과 이름을 거부한다.
- [ ] `.`, `..` 이름을 거부한다.
- [ ] `/`, `\`가 포함된 이름을 거부한다.
- [ ] `parentId`가 있으면 같은 Workspace의 활성 folder인지 검증한다.
- [ ] 같은 parent의 활성 item 이름 중복을 사전에 검사한다.
- [ ] DB unique violation도 `BAD_REQUEST`로 안전하게 변환한다.
- [ ] `sizeBytes`가 `0` 이상 `100 MiB` 이하인지 검증한다.
- [ ] `mimeType`이 빈 문자열이 아니고 255자 이하인지 검증한다.
- [ ] S3 provider raw error를 응답에 그대로 노출하지 않는다.

## 7. 목록 조회와 폴더 생성 구현

- [ ] `GET /workspaces/{workspaceId}/drive/items`를 구현한다.
- [ ] root 조회는 `parentId IS NULL`로 처리한다.
- [ ] 특정 폴더 조회는 `parentId` 기준으로 처리한다.
- [ ] 활성 폴더와 `ready` 파일만 목록에 반환한다.
- [ ] `pending`, `failed`, soft-deleted item은 목록에서 제외한다.
- [ ] 정렬은 폴더 먼저, 파일 나중으로 처리한다.
- [ ] 각 그룹 안에서 `updatedAt DESC`, `name ASC`로 정렬한다.
- [ ] 현재 parent payload와 breadcrumbs를 응답에 포함한다.
- [ ] `POST /workspaces/{workspaceId}/drive/folders`를 구현한다.
- [ ] 폴더 생성 시 `created_by_user_id`를 현재 사용자로 저장한다.
- [ ] 폴더 생성 응답을 `Drive Item Payload`에 맞춘다.

## 8. 업로드 URL 발급 구현

- [ ] `POST /workspaces/{workspaceId}/drive/files/upload-url`를 구현한다.
- [ ] 요청의 `parentId`, `name`, `sizeBytes`, `mimeType`을 검증한다.
- [ ] 서버에서 file id를 생성하거나 DB insert 결과 id를 사용한다.
- [ ] object key를 `drive/workspaces/{workspaceId}/items/{fileId}/{safeFileName}` 형식으로 만든다.
- [ ] 파일명을 object key에 넣기 전에 S3 key로 안전한 문자열로 정규화한다.
- [ ] `drive_items`에 `item_type = 'file'`, `upload_status = 'pending'` row를 만든다.
- [ ] `drive_uploads`에 `status = 'pending'`, `expires_at = now() + 10분` row를 만든다.
- [ ] S3 presigned `PUT` URL을 발급한다.
- [ ] 응답에 `file`, `upload.method`, `upload.uploadUrl`, `upload.headers`, `upload.expiresAt`을 포함한다.
- [ ] S3 bucket name과 object key는 응답에 노출하지 않는다.

## 9. 업로드 완료 처리 구현

- [ ] `POST /workspaces/{workspaceId}/drive/files/{fileId}/complete`를 구현한다.
- [ ] `fileId`가 같은 Workspace의 활성 `pending` file인지 확인한다.
- [ ] `uploadId`가 해당 file의 `pending` upload인지 확인한다.
- [ ] upload가 만료되었으면 `drive_uploads.status = 'expired'`로 전환한다.
- [ ] 만료된 upload의 file item은 `failed` 및 soft delete 처리할지 구현 정책을 확정한다.
- [ ] S3 `HeadObject`로 object 존재 여부를 확인한다.
- [ ] S3 object size가 expected size와 일치하는지 확인한다.
- [ ] size가 `100 MiB`를 초과하면 실패 처리한다.
- [ ] 검증 성공 시 transaction으로 `drive_uploads.status = 'completed'`를 저장한다.
- [ ] 같은 transaction에서 `drive_items.upload_status = 'ready'`로 전환한다.
- [ ] 완료 응답을 `Drive Item Payload`에 맞춘다.

## 10. 다운로드 URL 발급 구현

- [ ] `GET /workspaces/{workspaceId}/drive/files/{fileId}/download-url`를 구현한다.
- [ ] `fileId`가 같은 Workspace의 활성 `ready` file인지 확인한다.
- [ ] folder, pending file, failed file에 대해서는 다운로드 URL을 발급하지 않는다.
- [ ] S3 presigned `GET` URL을 발급한다.
- [ ] URL 만료 시간은 기본 `10분`으로 둔다.
- [ ] 원본 파일명을 `Content-Disposition` filename에 반영한다.
- [ ] 응답에 `file`, `downloadUrl`, `expiresAt`을 포함한다.
- [ ] S3 bucket name과 object key는 응답에 노출하지 않는다.

## 11. 이름 변경과 삭제 구현

- [ ] `PATCH /workspaces/{workspaceId}/drive/items/{itemId}`를 구현한다.
- [ ] Workspace `owner` 또는 `member`면 이름 변경을 허용한다.
- [ ] `itemId`가 같은 Workspace의 활성 item인지 확인한다.
- [ ] 새 이름 검증과 sibling 중복 검사를 수행한다.
- [ ] 이름 변경 시 S3 object key는 변경하지 않는다.
- [ ] `updated_by_user_id`를 현재 사용자로 저장한다.
- [ ] `DELETE /workspaces/{workspaceId}/drive/items/{itemId}`를 구현한다.
- [ ] Workspace `owner` 또는 `member`면 삭제를 허용한다.
- [ ] file 삭제는 해당 item의 `deleted_at`을 기록한다.
- [ ] folder 삭제는 recursive CTE로 하위 item까지 soft delete한다.
- [ ] 삭제 시 S3 object는 즉시 삭제하지 않는다.
- [ ] 응답에 `id`, `deleted`, `deletedItemCount`를 포함한다.

## 12. Backend 테스트와 검증

- [ ] drive 도메인 전용 테스트 스크립트를 추가한다.
- [ ] 폴더 생성 성공 테스트를 작성한다.
- [ ] 같은 폴더 이름 중복 실패 테스트를 작성한다.
- [ ] root와 하위 폴더 목록 조회 테스트를 작성한다.
- [ ] upload URL 발급 성공 테스트를 작성한다.
- [ ] 100 MiB 초과 업로드 요청 실패 테스트를 작성한다.
- [ ] upload complete 성공 테스트를 작성한다.
- [ ] S3 object 미존재 complete 실패 테스트를 작성한다.
- [ ] 다운로드 URL 발급 성공 테스트를 작성한다.
- [ ] 이름 변경 성공과 중복 실패 테스트를 작성한다.
- [ ] 파일 삭제와 폴더 recursive 삭제 테스트를 작성한다.
- [ ] Workspace 접근 권한 없는 요청이 실패하는지 확인한다.
- [ ] `npm run build`, `npm run lint`, `npm test` 또는 repo 기준 검증 명령을 실행한다.

## 13. Frontend API client와 타입 구현

- [ ] `apps/frontend/src/features/drive/types/` 또는 `types.ts`를 만든다.
- [ ] `DriveItem`, `DriveUpload`, `DriveListResponse` 타입을 정의한다.
- [ ] `apps/frontend/src/features/drive/api/client.ts`를 만든다.
- [ ] 목록 조회 API 함수를 구현한다.
- [ ] 폴더 생성 API 함수를 구현한다.
- [ ] upload URL 발급 API 함수를 구현한다.
- [ ] S3 `PUT` 업로드 함수를 구현한다.
- [ ] upload complete API 함수를 구현한다.
- [ ] download URL 발급 API 함수를 구현한다.
- [ ] 이름 변경 API 함수를 구현한다.
- [ ] 삭제 API 함수를 구현한다.
- [ ] API error parsing은 기존 feature client 패턴을 따른다.

## 14. Frontend 화면과 상태 구현

- [ ] `apps/frontend/src/features/drive/page.tsx`를 만든다.
- [ ] `apps/frontend/src/app/files/page.tsx` route bridge를 만든다.
- [ ] `drive/navigation.ts`를 만들고 `파일` 메뉴를 정의한다.
- [ ] `src/features/navigation.ts`에 Drive navigation을 등록한다.
- [ ] 현재 Workspace id와 access token을 auth session에서 가져온다.
- [ ] root와 폴더 내부를 이동할 수 있게 한다.
- [ ] breadcrumbs를 표시한다.
- [ ] 폴더와 파일 목록을 구분해서 표시한다.
- [ ] 빈 상태를 표시한다.
- [ ] 로딩 상태를 표시한다.
- [ ] 에러 상태와 재시도 버튼을 표시한다.
- [ ] 새 폴더 생성 UI를 만든다.
- [ ] 파일 선택 및 업로드 UI를 만든다.
- [ ] 업로드 진행 중 상태를 표시한다.
- [ ] 업로드 실패 상태를 표시한다.
- [ ] 다운로드 버튼을 만든다.
- [ ] 이름 변경 UI를 만든다.
- [ ] 삭제 확인 UI를 만든다.
- [ ] 모바일 폭에서도 목록과 버튼 텍스트가 겹치지 않게 확인한다.

## 15. Frontend 검증

- [ ] 로그인하지 않은 상태에서 파일 화면 접근 시 기존 auth UX와 맞게 동작하는지 확인한다.
- [ ] Workspace member가 root 목록을 볼 수 있는지 확인한다.
- [ ] 폴더 생성 후 목록에 반영되는지 확인한다.
- [ ] 파일 업로드 후 `ready` 상태로 목록에 나타나는지 확인한다.
- [ ] 다운로드 버튼이 presigned URL로 파일을 받을 수 있는지 확인한다.
- [ ] 이름 변경 후 목록과 상세 표시가 갱신되는지 확인한다.
- [ ] 파일 삭제 후 목록에서 사라지는지 확인한다.
- [ ] 폴더 삭제 후 하위 item도 목록에서 사라지는지 확인한다.
- [ ] 100 MiB 초과 파일 업로드가 UI에서 차단되거나 서버 에러를 보여주는지 확인한다.
- [ ] `npm run build`, `npm run lint`, `npm test` 또는 repo 기준 검증 명령을 실행한다.

## 16. 문서와 PR 정리

- [ ] 구현 중 API 계약이 바뀌면 `docs/api/drive-api.md`를 함께 수정한다.
- [ ] DB schema가 바뀌면 migration과 `db/README.md`를 함께 수정한다.
- [ ] app-server 공통 영역 변경 사유와 영향 범위를 PR 본문에 적는다.
- [ ] frontend 공통 영역 변경 사유와 영향 범위를 PR 본문에 적는다.
- [ ] Infra/S3 CORS 변경이 있으면 배포 영향에 적는다.
- [ ] PR 제목에 DB, app-server 공통 영역, frontend 공통 영역 영향이 있으면 사이렌 표시를 검토한다.
- [ ] 테스트 결과와 미수행 사유를 PR 본문에 적는다.
- [ ] Drive owner와 DB Schema owner 확인이 필요한 점을 PR 본문에 적는다.
- [ ] 구현 범위에서 제외한 항목을 PR 본문에 명시한다.
