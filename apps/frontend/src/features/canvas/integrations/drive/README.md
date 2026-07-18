# Canvas Drive Integration

Workspace Drive의 파일을 Classic Canvas `file_node`로 연결한다.

## 책임

- 같은 Workspace의 ready 파일 목록을 조회한다.
- Canvas에서 지원하는 이미지, PDF, 텍스트 MIME type만 선택할 수 있게 한다.
- 각 사용자의 bearer token으로 짧은 수명의 preview URL을 발급받는다.
- shape에는 `fileId`, `fileName`, `mimeType`만 전달한다.

## 저장하지 않는 값

- S3 bucket과 object key
- presigned preview/download URL
- 파일 원문
- AWS credential

presigned URL은 `file_node` renderer의 React state에만 존재한다. 새로고침하거나 shape가
다시 mount되면 `fileId`를 사용해 현재 사용자의 Workspace 권한을 다시 확인한다.
