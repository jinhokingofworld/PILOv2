# PR Review Activity File Path Design

## 문제

`file_review_decision_created`는 현재 판단 상태만 `summary`에 기록하므로 MeetingReport의 활동 근거에서 어떤 파일의 판단이 변경됐는지 알 수 없다. MeetingReport는 Activity Log의 raw metadata를 전달하지 않고 `action`과 `summary`만 안전하게 snapshot하므로, 파일 경로는 producer가 사실 문장에 포함해야 한다.

## 결정

- 기존 `file_review_decision_created` action, target type, dedupe key를 유지한다.
- PR Review service가 이미 조회한 review file의 repo-relative `file_path`와 `reviewFileId`를 Activity Log builder에 전달한다.
- `metadata.summary`는 `<filePath> 파일의 PR Review 판단을 <decision> 상태로 변경했습니다.` 형식으로 작성한다.
- `metadata.data`는 `{ reviewSessionId, reviewFileId, filePath, decision }`을 저장한다.
- file path는 한 줄로 정규화하고 최대 400자로 제한한다. 400자를 넘으면 파일명과 가까운 suffix를 보존하도록 앞부분을 `…`로 줄인다.
- API request/response, action enum, DB schema는 변경하지 않는다.

## 대안

1. **repo-relative 전체 경로를 summary와 metadata에 포함 — 채택.** 같은 이름의 파일을 구분할 수 있고 MeetingReport가 추가 조회 없이 표시할 수 있다.
2. basename만 포함 — 경로가 짧지만 `index.ts` 같은 중복 파일을 구분하지 못한다.
3. review file ID만 저장하고 Meeting에서 join — Activity snapshot이 PR Review schema에 결합되고 현재의 안전한 summary-only 경계를 깨므로 제외한다.

## 데이터 흐름

1. 사용자가 review file 판단을 실제로 변경한다.
2. 같은 DB transaction에서 decision row와 Activity Log row를 생성한다.
3. Activity Log summary와 data에 bounded repo-relative path를 기록한다.
4. MeetingReport worker는 기존 방식대로 summary를 snapshot하고 LLM 및 활동 근거 UI에 전달한다.

## 검증

- builder 단위 테스트에서 file path가 summary와 metadata에 포함되는지 확인한다.
- 400자를 넘는 path가 suffix 보존 방식으로 제한되고 summary가 500자를 넘지 않는지 확인한다.
- service transaction 테스트에서 review file ID/path가 builder 결과에 전달되는지 확인한다.
- PR Review focused tests와 App Server 전체 테스트, format, lint, build를 통과한다.

## 기존 데이터

이미 생성된 Activity Log와 MeetingReport snapshot에는 경로가 없으므로 소급 보강하지 않는다. 배포 후 새로 생성되는 file decision Activity Log부터 적용한다.
