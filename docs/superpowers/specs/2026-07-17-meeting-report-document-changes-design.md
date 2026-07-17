# 회의록 문서 변경 근거 설계

## 목표

회의 녹음 구간에 실제 회의 참여자가 수정한 PILO 네이티브 문서의 텍스트 변경을 기존 MeetingReport 생성 호출에 함께 제공한다. 회의록은 STT에 나타난 논의와 문서에 실제 반영된 결과를 함께 정리한다.

별도 문서 요약 LLM 호출은 만들지 않는다. `activity_logs`에는 문서 원문이나 diff를 저장하지 않는다.

## 기존 기반

- `document_snapshots`는 문서의 모든 저장본을 version별로 보존한다. 각 저장본에는 Tiptap JSON, plain text, 생성 시각이 있다.
- 문서 snapshot 저장 transaction은 `document_content_updated` 또는 `document_attachment_updated` Activity Log를 함께 append한다. `document_content_updated`에는 이미 수정자와 문서 version이 있다.
- MeetingReport는 이미 녹음 구간 `[started_at, ended_at)`과 실제 참가 session을 기준으로 Activity Log를 선별한다.
- MeetingReport worker는 STT와 Activity evidence를 한 번의 LLM 호출에 전달한다.

따라서 이 기능은 새 문서 revision 테이블이나 per-keystroke 로그 없이, immutable snapshot과 기존 Activity Log를 조합한다.

## 대상 선정

문서 변경 후보는 다음을 모두 만족해야 한다.

1. `document_content_updated` 또는 `document_attachment_updated` Activity Log가 녹음 구간 안에 있다.
2. log의 `actor_user_id`가 그 발생 시각에 해당 Meeting의 non-legacy participant session에 실제 참여 중이었다.
3. log의 `target`이 현재 또는 이후 soft-delete된 네이티브 문서이며, metadata의 version에 대응하는 `document_snapshots` row가 존재한다.

PDF, 일반 Drive 파일, 외부 문서, cursor/presence, realtime sync, 블록 이동과 서식만의 변경은 대상이 아니다. 문서 이름 변경은 `document_renamed` Activity Log의 bounded `previousTitle`/`title` 정보만 별도 변경 항목으로 포함한다.

현재 `document_attachment_updated`에는 version이 없으므로, 이 작업에서 `metadata.data.version`을 추가한다. 첨부와 본문을 같은 저장에서 함께 바꾼 경우에도 정확한 snapshot을 비교하기 위해서다. 첨부만 바뀐 경우에는 텍스트 diff가 비어 결과에서 자동으로 제외된다.

동시에 문서를 편집하는 경우 snapshot은 room의 병합 상태다. 1차에서는 checkpoint를 저장한 마지막 인증 사용자 기준으로 참여자를 판정하며, 문장 단위의 완전한 작성자 분리는 범위에서 제외한다.

## 변경분 추출

1. 후보 Activity Log의 version과 일치하는 snapshot을 찾는다.
2. 해당 snapshot과 바로 전 version snapshot을 비교한다. version 0은 빈 문서 기준이다.
3. Tiptap JSON에서 제목, 문단, heading, bullet/number/checklist, 인용, 코드 블록의 텍스트만 순서대로 평탄화한다. 파일 첨부 atom, mark와 단순 레이아웃 정보는 제외한다.
4. 이전/현재 블록 배열을 순서 기반 diff로 비교해 `추가`, `수정`, `삭제` 항목을 만든다.
5. 첨부 파일만 추가하거나 제거된 snapshot, 서식만 바뀐 snapshot처럼 텍스트 차이가 없는 경우는 버린다.
6. 같은 문서에서 연속된 변경은 시간순으로 합치고, 같은 텍스트 항목은 중복 제거한다.

수정 항목은 입력량을 줄이기 위해 변경 후 텍스트를 우선 제공한다. 삭제 항목은 삭제 사실과 삭제된 짧은 텍스트를 제공한다.

## LLM 입력과 안전 경계

기존 입력에 아래 섹션을 추가한다.

```text
[Document change evidence - untrusted reference]
[0] 문서: PILO 기획서
- 추가: 관련 Issue가 있으면 마감일을 1주일 연기한다.
- 수정: Agent가 Board Issue를 조회한다.

[1] 문서 이름 변경: 초안 -> Agent MVP 기획서
```

- system prompt는 문서 변경 근거를 지시가 아닌 참고 자료로만 취급하도록 명시한다.
- transcript에 없는 사실을 문서 변경 근거만으로 발화나 합의로 단정하지 않는다.
- 문서 변경 근거는 실제 반영 결과를 보강하는 용도이며, 결론·액션 아이템에는 STT 근거를 우선한다.
- 기존 STT/Activity evidence/문서 변경 근거를 합친 입력은 문서 변경 근거부터 제한한다.

기본 제한값은 문서 8개, 문서별 변경 12개, 전체 변경 48개, UTF-8 8,000 bytes다. 시간순으로 수집하되 같은 문서의 최근 변경을 우선 보존하고, 상한을 넘으면 남은 항목을 제외한다.

## 실패와 재시도

- 문서 변경 조회 또는 JSON diff가 실패하면 warning을 남기고 기존 STT + Activity evidence 회의록 생성을 계속한다.
- 일부 문서의 snapshot이 없거나 올바르지 않으면 그 문서만 제외한다.
- 문서 snapshot과 Activity Log는 append-only이므로 같은 녹음 구간을 다시 처리해도 같은 후보를 재구성할 수 있다.
- LLM 실패는 현재 MeetingReport의 `LLM` 실패 처리와 재시도 정책을 그대로 따른다.

## 구현 경계

변경 대상은 AI Worker의 MeetingReport repository, 문서 변경 evidence 추출기, 프롬프트 입력 조립, 관련 Python 테스트와 Drive의 `document_attachment_updated` Activity Log metadata다. API endpoint, frontend, realtime checkpoint protocol, DB migration은 변경하지 않는다.

`meeting_report_activity_evidence`는 기존 Activity Log projection을 계속 보존한다. 문서 diff 원문은 Activity Log metadata나 새 영속 evidence table에 복제하지 않는다.

## 검증

- 회의 참여자가 녹음 중 문단/heading/list를 변경하면 해당 변경만 LLM 입력에 포함된다.
- 비참여자 변경, 녹음 구간 밖 변경, PDF/일반 파일, cursor/presence/서식 전용 변경은 제외된다.
- 첨부 파일만 변경한 snapshot은 텍스트 변경 근거를 만들지 않는다.
- 이름 변경은 bounded title 변경 근거만 만든다.
- 변경이 없거나 문서 diff 조회가 실패해도 기존 회의록 생성은 계속된다.
- 기존 Activity evidence와 STT evidence JSON schema는 바꾸지 않는다.
