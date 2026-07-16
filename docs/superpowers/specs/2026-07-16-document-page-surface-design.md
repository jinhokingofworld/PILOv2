# 프레임 없는 문서 페이지 설계

## 목표

`/files?documentId=...` 문서 화면을 입력 폼 카드가 아닌 읽기와 작성에 집중한 하나의
문서 페이지로 바꾼다. 자동 저장, 현재 지원하는 block 명령, 오류 복구는 유지한다.

## 문제

현재 화면은 제목 영역과 editor card가 분리되고, editor에 테두리·고정 최소 높이·항상
보이는 도구막대가 붙어 있다. 빈 문서가 넓은 입력 상자처럼 보이므로 페이지 위에서
자유롭게 글을 시작한다는 느낌이 약하다.

## 확정한 방향

### 페이지 구조

- 바깥 editor card의 border, rounded corner, 별도 toolbar container를 제거한다.
- 뒤로가기, 제목, 저장 상태, 본문을 하나의 `max-width: 52rem` 문서 컬럼에 둔다.
- 컬럼은 desktop에서 화면 중앙에 두고, mobile에서는 안정적인 좌우 padding만 유지한다.
- 본문은 fixed canvas가 아니라 내용에 따라 자연스럽게 아래로 이어지는 세로 페이지다.
- 문서 제목은 본문 시작점의 큰 heading으로 표시한다. 이번 범위에서는 rename 동작을
  추가하지 않고 현재 이름 표시를 유지한다.

### 편집 chrome

- 저장 상태는 제목 바로 아래의 작은 상태 텍스트로 유지한다. 수동 저장은 기존 동작을
  보존하되 header의 보조 icon action으로만 둔다.
- 현재의 undo/redo와 block 명령은 제거하지 않는다. 다만 editor를 감싸던 두꺼운 toolbar
  container를 없애고, 본문 시작 전의 얇고 borderless한 command strip으로 낮춘다.
- command strip은 문서 컬럼 폭 안에만 있고, 본문과 같은 배경을 사용한다. 선택된 command만
  차분하게 강조한다.
- 저장 실패와 충돌은 문서 컬럼 안에서 본문 위에 inline alert로 보여주며, editor 자체를
  다시 카드로 감싸지 않는다.

### 본문과 빈 상태

- Tiptap 본문에는 card padding 대신 문서 컬럼의 수평 padding을 사용한다.
- 첫 빈 paragraph에는 "입력하려면 /" placeholder를 표시한다. 실제 slash command는 다음
  interaction 작업에서 추가한다.
- typography, list, quote, code block, divider의 현재 규칙은 유지하되 문단 간 여백을 문서
  작성 흐름에 맞게 유지한다.

## 범위와 제외

이번 작업은 `apps/frontend/src/features/drive/components/document-editor.tsx`와
`document-editor.module.css` 중심의 visual/layout 개선이다. API, DB schema, autosave
transport, Drive 목록 동작은 바꾸지 않는다.

다음 작업으로 분리한다.

- `/` slash command menu
- 선택 텍스트 bubble menu
- block hover handle과 drag-and-drop
- inline title rename
- 파일 첨부 picker와 PDF viewer

## 상태와 오류 처리

- loading, not-found/unauthorized, save error, version conflict의 기존 상태 의미는 유지한다.
- 저장 상태가 layout을 밀거나 제목과 겹치지 않게 고정된 text 영역을 둔다.
- `409 CONFLICT`에서는 기존처럼 editor를 readonly로 바꾸고 reload action을 제공한다.

## 검증

- frontend contract test에 frame-free surface, command strip, placeholder, autosave 유지 조건을
  추가한다.
- desktop과 mobile에서 빈 문서, 긴 문서, 저장 중, 저장 실패, conflict 화면을 확인한다.
- `apps/frontend`의 format, lint, test를 실행한다.

## 성공 기준

문서가 `/files` 안에서 열려도 하나의 독립된 작성 페이지처럼 보이고, 본문이 카드 테두리에
갇혀 보이지 않아야 한다. 기존 사용자는 저장과 현재 서식 명령을 잃지 않아야 한다.
