# Workspace 문서 공동 편집 설계

> 상태: 설계 확정. 이 문서는 1차 출시 범위와 이후 RAG·MeetingReport 연동의 고정된 경계를 정의한다. 구현은 별도 계획과 Issue/PR로 나눈다.

## 목표

PILO Workspace 멤버가 기존 `/files` 화면에서 native 문서를 만들고, 같은 문서를 동시에 편집하며, Drive의 PDF를 문서 참고 자료로 함께 열람할 수 있게 한다.

문서는 팀의 최신 기획과 의사결정을 기록하는 원본이다. 이후 Agent는 native 문서를 우선 검색하고, MeetingReport는 회의 시간에 발생한 문서 변경을 근거로 회의 결과를 보완한다.

## 1차 범위

- `/files` 트리 안의 native 문서 생성, 열람, 이름 변경, 폴더 이동, soft delete
- 제목, 문단, Heading 1~3, bullet list, number list, checklist, 인용, 코드 블록, 구분선, 링크
- Tiptap + Yjs 기반 실시간 동시 편집
- 접속 멤버와 문서 내 remote cursor 표시
- 자동 저장, 재연결 복구, durable snapshot/version
- 기존 Drive의 ready 파일을 참조하는 첨부 블록
- 문서에서 PDF 앱 내 미리보기와 다운로드
- 공동 PDF 열람: 동일 PDF의 멤버, 현재 페이지, 같은 페이지의 포인터, 선택적 따라가기
- 의미 있는 문서 mutation의 공통 Activity Log 기록

## 1차 제외

- 문서 템플릿
- Markdown/TXT/DOCX를 editable 문서로 변환하는 import
- PDF를 editable 문서로 변환하거나 PDF 본문을 추출하는 기능
- 문서별 읽기 권한, public link, 댓글, 멘션, 알림
- 표, 토글, 이미지 편집, 데이터베이스 블록
- 사용자에게 노출되는 버전 목록과 복구 UI
- 문서/PDF 내용을 Agent RAG에 넣는 기능
- 문서 변경을 회의록 LLM에 반영하는 기능
- PDF 주석, 공동 펜, PDF 자체 편집

## 사용자와 권한

- Workspace의 `owner`, `member`는 모두 문서를 생성, 열람, 편집, 이동, 이름 변경, 삭제할 수 있다.
- 문서별 권한은 1차에 두지 않는다. 모든 native 문서와 첨부 파일의 접근은 Workspace membership을 기준으로 한다.
- PDF 공동 열람 room도 같은 Workspace에 속한 ready PDF 파일에만 입장할 수 있다.
- App Server와 realtime-server는 각각 membership을 검증한다. realtime join 성공만으로 영속 mutation 권한을 신뢰하지 않는다.

## 정보 구조와 화면

문서는 별도의 `/docs` 메뉴를 만들지 않고 기존 `/files` 안에 들어간다.

```text
제품 기획/
  PILO 기획서           [문서]
  요구사항 정리         [문서]
  기존 기획서.pdf       [파일]
  참고 자료/            [폴더]
```

`/files`의 생성 메뉴는 다음 세 항목만 제공한다.

- 새 문서
- 새 폴더
- 파일 업로드

새 문서는 현재 폴더에 생성한 뒤 즉시 전용 편집 화면으로 이동한다. 서버가 중복되지 않는 기본 제목을 생성하고, 처음 열 때 제목 입력에 focus를 둔다.

문서 편집 화면에는 breadcrumb, 편집 중인 멤버, 저장 상태, 제목, 본문 블록 에디터를 둔다. 저장 상태는 `저장 중`, `저장됨`, `재연결 중`, `저장 실패`만 표현한다. 저장 버튼은 제공하지 않는다.

문서의 이름 변경, 폴더 이동, 삭제는 Drive 목록의 기존 lifecycle과 같은 UI와 정책을 따른다. 삭제된 문서를 열고 있던 편집기는 즉시 읽기 전용 `문서가 삭제됨` 상태가 되며 새 update를 보내지 않는다.

## 데이터 경계

### Drive

`drive_items.item_type`에 `document`를 추가한다. Drive는 문서의 이름, parent, 생성자, 수정자, 삭제 상태와 목록 노출을 소유한다.

- `folder`, `file`, `document`는 같은 parent tree에 위치한다.
- `document`는 S3 object, MIME type, upload status를 갖지 않는다.
- 파일과 폴더의 기존 제약을 문서에도 적용한다. 같은 parent의 활성 item 이름은 대소문자 구분 없이 유일하다.
- 문서 parent는 같은 Workspace의 활성 folder여야 한다.

### Documents

문서 본문은 Drive와 분리된 Documents 저장소가 소유한다.

```text
documents
- drive_item_id (문서의 Drive item과 1:1)
- workspace_id
- current_version
- latest_snapshot_id
- created_at, updated_at, deleted_at

document_yjs_updates
- id, document_id, workspace_id
- update_sequence, client_update_id
- edit_session_id, actor_user_id
- yjs_update (binary), created_at

document_snapshots
- id, document_id, workspace_id, version
- yjs_state (binary)
- content_json (Tiptap JSON)
- plain_text
- source_update_sequence, created_at

document_edit_sessions
- id, document_id, workspace_id, actor_user_id
- first_update_sequence, last_update_sequence
- base_version, closed_version, closed_at
```

`document_yjs_updates`는 협업 복구용 append-only update log이고, `document_snapshots`는 복구·향후 RAG·MeetingReport diff의 안정된 기준이다. snapshot은 최신 상태만 덮어쓰지 않고 version별로 보존한다.

`documents.current_version`과 snapshot version은 App Server가 단조 증가시킨다. 이전 snapshot 보존은 1차 복구 UI를 의미하지 않는다.

## 동시 편집 아키텍처

문서 편집기는 Tiptap과 Yjs를 사용한다. Yjs update 병합을 직접 구현하지 않는다.

```text
Browser: Tiptap + Yjs + collaboration provider
  <-> realtime-server: /sync/documents
      - document room, Yjs sync, awareness, remote cursor
      - bearer session 검증과 Workspace membership 확인
  -> App Server internal document sync boundary
      - membership 재검증
      - update/snapshot/version 저장
      - Activity Log append
```

`/sync/documents`는 Yjs 호환의 검증된 collaboration provider/protocol을 사용한다. realtime-server는 room lifecycle, 즉시 update broadcast, awareness만 담당한다. PostgreSQL은 App Server가 소유하며 realtime-server 메모리는 영구 source of truth가 아니다.

App Server internal sync boundary는 각 연결 사용자의 bearer identity와 안정적인 `clientUpdateId`를 받아 update를 저장한다. `(document_id, client_update_id)` unique 제약으로 재연결 재전송을 idempotent하게 처리한다.

새 room 또는 realtime-server 재시작 시 realtime-server는 App Server가 제공한 최신 snapshot과 그 뒤 update를 읽어 Y.Doc을 복구한다. 브라우저도 재연결 전 로컬 update를 유지하고, acknowledgement를 받지 못한 update만 같은 id로 재전송한다.

### 저장과 snapshot

- 작은 Yjs update는 빠르게 영속화한다.
- 사용자가 60초 이상 편집을 멈추거나, 하나의 편집 세션이 10분에 도달하거나, 문서를 떠날 때 snapshot을 확정한다.
- snapshot 확정 transaction은 Tiptap JSON, plain text, 버전, edit session 종료 상태를 함께 저장한다.
- 재연결과 강제 새로고침은 마지막 durable update까지 복구한다.
- 여러 사용자가 동시에 편집한 snapshot은 병합된 문서 상태를 표현한다. 1차 MeetingReport는 겹친 변경을 특정 문장 단위로 한 사람에게 귀속하지 않는다.

## 블록과 첨부

문서 1차 블록은 다음으로 한정한다.

- paragraph
- heading level 1, 2, 3
- bullet list, ordered list, checklist
- blockquote
- code block
- horizontal rule
- link
- Drive 파일 첨부

파일 첨부 블록은 새 업로드를 만들지 않는다. 파일 선택 dialog에서 같은 Workspace의 ready Drive 파일을 고르고 `drive_item_id`를 참조로 저장한다.

- PDF는 앱 내 viewer를 열고 다운로드를 제공한다.
- PDF 이외 파일은 이름, 형식, 크기를 표시하고 다운로드로 연결한다.
- 참조 파일이 삭제, 실패, 접근 불가가 되면 블록만 `사용할 수 없는 파일`로 바꾸며 문서 본문 편집은 계속 가능하다.

## 공동 PDF 열람

PDF는 native 문서가 아니며 수정할 수 없다. 공동 열람은 일시적인 realtime presence만 공유한다.

```text
pdf-view:{workspaceId}:{fileId}
```

room presence payload는 사용자 식별 표시 정보, 현재 page, 현재 page 안의 정규화된 pointer 좌표, 선택한 follow target만 포함한다.

- 같은 PDF viewer room의 멤버 이름과 현재 page를 표시한다.
- 상대 포인터는 같은 page를 보고 있을 때만 overlay한다.
- pointer 좌표는 page width/height에 대한 0~1 비율로 전송하고 초당 10~15회로 제한한다.
- 사용자는 특정 멤버를 `따라가기`할 수 있다. 따라가기를 켠 사용자만 상대의 page 이동을 반영한다.
- 기본은 자유 열람이다. 확대 비율, 스크롤, page 이동을 강제 동기화하지 않는다.
- presence, page, cursor, follow 상태는 DB와 Activity Log에 저장하지 않는다.

## Activity Log

문서 도메인은 공통 `ActivityLogService`만 사용하고, `activity_logs`에 직접 insert하지 않는다. 각 append는 실제 domain mutation과 같은 App Server DB transaction에서 실행한다.

1차 구현 전 Activity Log foundation과 DB Schema 담당 범위로 다음 action을 중앙 registry와 Postgres enum에 함께 등록한다.

| action | target.type | metadata.data |
| --- | --- | --- |
| `document_created` | `document` | `{ title: string, source: "blank", parentId?: string }` |
| `document_content_updated` | `document` | `{ beforeVersion: number, afterVersion: number, changedSectionTitles?: string[], addedBlockCount: number, updatedBlockCount: number, removedBlockCount: number, changeSize: "small" \| "medium" \| "large" }` |
| `document_renamed` | `document` | `{ beforeTitle: string, afterTitle: string }` |
| `document_moved` | `document` | `{ title: string, fromParentId?: string, toParentId?: string }` |
| `document_attachment_updated` | `document` | `{ title: string, fileId: string, operation: "attached" \| "detached" }` |
| `document_deleted` | `document` | `{ title: string }` |

`document_content_updated`는 snapshot 확정 transaction마다 edit session당 한 건만 append한다. `dedupeKey`는 재시도에도 변하지 않는 document id와 edit session id 또는 확정 version을 이용한다.

```text
document:document_content_updated:{documentId}:{editSessionId}
```

summary는 LLM으로 생성하지 않는다. 변경된 heading과 블록 수에서 결정적으로 만든 1~500자의 한국어 과거형 사실 문장이다. 예: `PILO 기획서의 MVP 범위와 구현 일정 섹션을 수정했습니다.`

파일 첨부/제거 API가 만든 문서 변경은 `document_attachment_updated`만 남기고 같은 commit의 일반 `document_content_updated`는 남기지 않는다. 문서 생성, 이름 변경, 이동, 삭제도 각각의 전용 action만 남긴다.

title처럼 사용자 입력이 metadata에 필요한 경우 공백을 정리한 뒤 최대 160자로 제한하고, token·secret 형태로 보이면 제목 대신 `문서`를 사용한다. log metadata에는 문서 전문, Yjs update binary, PDF 원문, raw diff, RAG chunk, token, secret을 넣지 않는다. `meetingId`, `recordingId`, 클라이언트 발생 시각도 저장하지 않는다.

## 후속 마일스톤

### 2차: 문서 RAG

- 최신 확정 `document_snapshot.plain_text`만 chunk와 embedding의 source로 사용한다.
- 새 snapshot이 확정되면 durable indexing job을 만들고, 이전 version job은 superseded 처리한다.
- Agent retrieval은 native 문서를 다른 Drive 파일보다 우선한다.
- Agent 답변은 문서 제목과 문서 링크를 출처로 표시한다.
- PDF 텍스트 추출과 embedding은 별도의 후속 범위다.

### 3차: MeetingReport 문서 변경 근거

- MeetingReport는 Activity Log를 Workspace 일치, recording 시간 범위, 해당 시점 actual participant 조건으로만 조회한다.
- 같은 문서의 여러 log는 recording 안의 첫 `beforeVersion`부터 마지막 `afterVersion`까지의 순변경으로 합친다.
- LLM에는 raw Activity Log가 아니라, 전후 snapshot에서 계산한 변경 블록과 bounded diff evidence만 전달한다.
- 문서 편집 중에는 LLM을 호출하지 않는다.

### 이후 확장

- Markdown/TXT import를 editable native 문서로 변환
- DOCX 구조 변환, PDF text extraction
- 문서 version history/restore UI
- 댓글, 멘션, 문서별 권한
- 이미지, 표, 토글과 기타 블록
- PDF annotation과 공동 포인터 확장

## 오류 처리

- realtime 연결이 끊기면 editor는 `재연결 중`을 표시하고 local Yjs update를 보관한다.
- 영속 저장 실패가 계속되면 `저장 실패`를 표시하고 browser session 동안 local 변경을 유지한다.
- 문서 삭제 후에는 저장, 첨부, 새 Activity Log append를 막는다.
- PDF viewer 오류는 다운로드 동작을 막지 않는다.
- RAG/LLM은 1차 문서 작성 경로에서 호출하지 않으므로 provider 장애가 협업 편집을 막지 않는다.

## 검증 기준

- 두 사용자가 같은 문단을 동시에 편집해도 두 변경이 병합된다.
- 새로고침, 재연결, realtime-server 재시작 뒤 마지막 durable 문서 상태가 복구된다.
- Workspace owner/member 모두 문서를 만들고 편집, 이동, 이름 변경, 삭제할 수 있다.
- 문서, 파일, 폴더가 `/files`에서 같은 lifecycle으로 보인다.
- 기존 Drive PDF를 문서에 첨부하고 앱 내 viewer와 다운로드를 사용할 수 있다.
- 같은 PDF를 보는 멤버의 page와 같은 page의 pointer가 보이며, follow mode는 opt-in이다.
- 문서 mutation과 Activity Log append가 같은 transaction에서 성공하거나 함께 rollback된다.
- keystroke, cursor, presence, polling, autosave 자체는 Activity Log를 만들지 않는다.
- App Server API, realtime-server room/auth/reconnect, frontend editor/PDF viewer, DB migration/Activity Log에 단위 및 통합 테스트를 둔다.

## 구현 분리

1. Document/Drive 계약과 DB migration: `document` item, document storage, Activity Log registry action
2. 문서 lifecycle API와 `/files` 목록 통합
3. Tiptap editor, supported blocks, auto-save, Drive file attachment, PDF viewer
4. Yjs document realtime room, durability, reconnect, cursor/presence
5. 공동 PDF viewer room과 follow mode
6. 문서 lifecycle/Activity Log/realtime/PDF QA와 API/운영 문서

각 단계는 독립 PR로 나눈다. RAG와 MeetingReport integration은 이 1차 구현 PR에 넣지 않는다.
