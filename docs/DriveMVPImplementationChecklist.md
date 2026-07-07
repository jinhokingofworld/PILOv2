# 파일 MVP 구현 체크리스트

작성일: 2026-07-07
최신화: 2026-07-07

이 문서는 Workspace 공유 파일 기능의 현재 구현 상태와 남은 작업 순서를 정리한다.
구현 기준 계약은 `docs/api/drive-api.md`, DB schema 기준은
`db/migrations/014_create_drive_items_and_uploads.sql`을 따른다.

## 0. 현재 진행 상황

| Issue | 범위 | 상태 | 관련 PR | 메모 |
| --- | --- | --- | --- | --- |
| #298 | 계약/DB/Infra 준비 | 완료 | #295 | API 문서, migration, 구현 체크리스트 준비 |
| #299 | Backend 구현 | 완료 | #305, #307 | Drive API와 S3 presigned URL 흐름 구현 |
| #300 | Frontend 구현 | GitHub상 완료 | #310 | 기본 화면은 완료. 업로드/다운로드/이름 변경/삭제 UI는 다음 구현 작업으로 남음 |
| #315 | Frontend action 구현 | 진행 예정 | - | 업로드, 다운로드, 이름 변경, 삭제 UI 구현 |
| #301 | 통합 QA/배포 정리 | 진행 전 | - | 전체 흐름 구현 후 dev 환경에서 검증 |

주의: #300은 #310 merge 후 GitHub issue 상태가 `CLOSED`이지만, 기능 범위 기준으로는
파일 업로드, 다운로드, 이름 변경, 삭제 UI가 아직 남아 있다. 이 남은 Frontend action
작업은 #315에서 추적한다.

## 1. 완료된 기반 작업

### 1.1 계약과 DB

- [x] Drive API 계약 문서를 작성했다.
- [x] `docs/api/README.md`에 Drive API 문서를 등록했다.
- [x] `drive_items`, `drive_uploads` migration을 `014`번으로 추가했다.
- [x] `drive_items`가 폴더와 파일 metadata를 모두 표현한다.
- [x] `drive_uploads`가 presigned upload URL 한 번의 업로드 시도를 추적한다.
- [x] 같은 Workspace와 parent 안에서 활성 item 이름 중복을 막는다.
- [x] `object_key` unique index와 pending upload 정리용 index를 추가했다.
- [x] RLS baseline all-deny를 활성화했다.

### 1.2 Backend

- [x] `DriveModule`, `DriveController`, `DriveService`를 추가했다.
- [x] `DriveStorageService`에서 S3 presigned upload/download URL을 발급한다.
- [x] `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` 의존성을 추가했다.
- [x] `AuthGuard`와 Workspace 접근 권한 검증을 Drive endpoint에 적용했다.
- [x] 파일/폴더 이름, UUID, parent folder, size, MIME type 검증을 구현했다.
- [x] 목록 조회와 폴더 생성 API를 구현했다.
- [x] 업로드 URL 발급과 upload complete API를 구현했다.
- [x] 다운로드 URL 발급 API를 구현했다.
- [x] 이름 변경과 soft delete API를 구현했다.
- [x] 폴더 삭제 시 하위 item까지 recursive soft delete한다.
- [x] S3 raw error를 API 응답에 그대로 노출하지 않도록 처리했다.
- [x] app-server drive 테스트 스크립트를 추가했다.

### 1.3 Frontend 기본 화면

- [x] `apps/frontend/src/features/drive/` 도메인 폴더를 추가했다.
- [x] Drive 타입과 API client를 추가했다.
- [x] 목록 조회 API 함수를 구현했다.
- [x] 폴더 생성 API 함수를 구현했다.
- [x] `/files` route bridge를 `apps/frontend/src/app/(workspace)/files/page.tsx`에 추가했다.
- [x] `drive/navigation.ts`를 만들고 `파일` 메뉴를 등록했다.
- [x] 현재 Workspace id와 access token을 기존 auth/session 흐름에서 가져온다.
- [x] root와 폴더 내부 이동을 구현했다.
- [x] breadcrumbs를 표시한다.
- [x] 폴더와 파일 목록을 구분해서 표시한다.
- [x] 빈 상태, 로딩 상태, 에러 상태와 재시도 버튼을 구현했다.
- [x] 새 폴더 생성 UI를 shadcn/ui `Sheet`, `Button`, `Input` 기반으로 구현했다.
- [x] #310 CI에서 frontend build, lint, test 통과를 확인했다.

## 2. 다음 구현 PR: Frontend action 완성

다음 작업은 최신 `dev`에서 새 브랜치를 파고 시작한다. 권장 브랜치:
`feat/315-drive-frontend-actions`.

### 2.1 시작 전 확인

- [x] 최신 `dev`를 pull한다.
- [x] 남은 Frontend action 작업의 추적 issue를 #315로 확정한다.
- [x] `docs/api/drive-api.md`에서 upload/download/rename/delete 계약을 다시 확인한다.
- [x] `apps/frontend/FRONTEND_COMMON_AREAS.md`를 확인한다.
- [x] route bridge는 `apps/frontend/src/app/(workspace)/files/page.tsx` 위치를 유지한다.
- [x] 이번 PR에는 API 계약/DB schema 변경을 넣지 않는다.

### 2.2 API client와 타입 확장

- [x] `DriveUpload` 타입을 추가한다.
- [x] upload URL 발급 API 함수를 추가한다.
- [x] S3 presigned `PUT` 업로드 함수를 추가한다.
- [x] upload complete API 함수를 추가한다.
- [x] download URL 발급 API 함수를 추가한다.
- [x] 이름 변경 API 함수를 추가한다.
- [x] 삭제 API 함수를 추가한다.
- [x] API error parsing은 기존 Drive client 패턴을 유지한다.

### 2.3 업로드 UI

- [x] 파일 선택 input을 추가한다.
- [x] 현재 폴더 `parentId` 기준으로 업로드 URL을 요청한다.
- [x] 서버가 내려준 `upload.headers`를 S3 `PUT` 요청에 그대로 사용한다.
- [x] S3 `PUT` 성공 후 upload complete API를 호출한다.
- [x] 업로드 성공 후 현재 폴더 목록을 새로고침한다.
- [x] 업로드 진행 중 상태를 표시한다.
- [x] 업로드 실패 상태와 재시도 가능 흐름을 표시한다.
- [x] 100 MiB 초과 파일은 UI에서 사전 차단하거나 서버 에러를 사용자에게 보여준다.

### 2.4 다운로드 UI

- [x] 파일 row에 다운로드 버튼을 추가한다.
- [x] folder row에는 다운로드 액션을 노출하지 않는다.
- [x] download URL 발급 후 브라우저 다운로드를 시작한다.
- [x] 다운로드 URL 발급 실패 상태를 사용자에게 표시한다.

### 2.5 이름 변경 UI

- [x] 파일/폴더 row에 이름 변경 액션을 추가한다.
- [x] 기존 이름을 기본값으로 보여준다.
- [x] 빈 이름, 255자 초과, `.`, `..`, `/`, `\` 포함 이름을 UI에서 검증한다.
- [x] 이름 변경 성공 후 현재 목록을 새로고침한다.
- [x] sibling 이름 중복 서버 에러를 사용자에게 표시한다.

### 2.6 삭제 UI

- [x] 파일/폴더 row에 삭제 액션을 추가한다.
- [x] 삭제 확인 UI를 추가한다.
- [x] 파일 삭제 성공 후 목록에서 사라지는지 확인한다.
- [x] 폴더 삭제 성공 후 하위 item까지 사라지는지 확인한다.
- [x] 삭제 실패 상태를 사용자에게 표시한다.

### 2.7 Frontend 검증

- [x] `npm run format:check`를 실행한다.
- [x] `npm run lint`를 실행한다.
- [x] `npm run test`를 실행한다.
- [x] `npm run build`를 실행한다.
- [ ] 모바일 폭에서 목록, 버튼, 파일명이 겹치지 않는지 확인한다.
- [ ] 가능하면 dev app-server와 연결해 업로드/다운로드 흐름을 수동 확인한다.

## 3. 최종 QA와 배포 확인

이 단계는 #301에서 진행한다. Frontend action PR이 dev에 들어간 뒤 수행한다.

### 3.1 Infra/S3 확인

- [ ] dev app-server에 `S3_UPLOADS_BUCKET`이 주입되어 있는지 확인한다.
- [ ] AWS region/endpoint 설정이 app-server 실행 환경과 맞는지 확인한다.
- [ ] uploads bucket CORS에 `PUT`, `GET`, `HEAD`가 허용되어 있는지 확인한다.
- [ ] CORS 허용 header에 `Content-Type`, `x-amz-*`가 포함되어 있는지 확인한다.
- [ ] 필요하면 CORS expose header에 `ETag`를 포함한다.
- [ ] app-server IAM 권한에 `s3:PutObject`, `s3:GetObject`, `s3:HeadObject`가 있는지 확인한다.

### 3.2 DB와 Backend 확인

- [ ] dev DB에 `014_create_drive_items_and_uploads.sql` migration이 적용되어 있는지 확인한다.
- [ ] Workspace `owner`와 `member` 모두 Drive API를 사용할 수 있는지 확인한다.
- [ ] 권한 없는 Workspace 요청이 실패하는지 확인한다.
- [ ] 만료된 pending upload 처리 결과를 확인한다.

### 3.3 End-to-end 수동 QA

- [ ] Workspace member로 `파일` 화면에 접근한다.
- [ ] root 목록 조회를 확인한다.
- [ ] 폴더 생성과 폴더 내부 이동을 확인한다.
- [ ] 파일 업로드 후 `ready` 상태로 목록에 나타나는지 확인한다.
- [ ] 다운로드 URL로 파일을 받을 수 있는지 확인한다.
- [ ] 파일/폴더 이름 변경 후 목록이 갱신되는지 확인한다.
- [ ] 파일 삭제 후 목록에서 사라지는지 확인한다.
- [ ] 폴더 삭제 후 하위 item도 목록에서 사라지는지 확인한다.
- [ ] 100 MiB 초과 파일 처리 결과를 확인한다.

## 4. PR 정리 기준

- [ ] 구현 중 API 계약이 바뀌면 `docs/api/drive-api.md`를 함께 수정한다.
- [ ] DB schema가 바뀌면 migration과 `db/README.md`를 함께 수정한다.
- [ ] frontend 공통 영역 변경이 있으면 PR 제목에 사이렌 표시를 검토한다.
- [ ] `apps/frontend/FRONTEND_COMMON_AREAS.md` 기준 영향 범위와 검증 방법을 PR 본문에 적는다.
- [ ] Infra/S3 CORS/IAM/env 확인이 남아 있으면 PR 본문에 미수행 사유를 적는다.
- [ ] 테스트 결과와 미수행 사유를 PR 본문에 적는다.
- [ ] 구현 범위에서 제외한 항목을 PR 본문에 명시한다.
