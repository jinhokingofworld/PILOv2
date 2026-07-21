# Agent 회의록 요약 완료 판정 설계

## 문제

`meeting.report.summary` capability는 `list_meeting_reports`와
`summarize_meeting_report`를 순서대로 포함한다. 회의록 제목이나 이전 선택 문맥으로
`summarize_meeting_report`가 직접 성공한 경우에도 현재 Worker는 앞선 목록 Tool이
실행되지 않았다는 이유로 `workflowIncomplete=true`를 전달한다. 동시에 최종 Tool이
완료되어 `completionAllowed=true`가 되므로 Planner 계약이 서로 모순된다.

## 설계

`meeting.report.summary` capability에서 선택적인 검색 Tool인
`list_meeting_reports`를 제거하고 실제 작업 Tool인 `summarize_meeting_report`만
등록한다. 요약 Tool 자체가 제목·기간·이전 선택 문맥을 해소하고 필요할 때 후보
선택을 요청하므로 별도 목록 Tool은 필수 선행 단계가 아니다.

Worker의 공통 완료 판정은 변경하지 않는다. 따라서 `담당자 변경 → 승인`처럼 모든
중간 단계가 실제로 필요한 mutation workflow의 보호 규칙은 유지된다.

## 범위

- App Server의 capability registry와 파생 snapshot만 수정한다.
- Tool schema, API 및 DB 계약은 변경하지 않는다.
- 회의록 요약 capability가 요약 Tool만 포함하는지 회귀 테스트로 검증한다.

## 성공 기준

- `meeting.report.summary`가 `summarize_meeting_report`만 노출한다.
- 요약 Tool 성공 후 선택되지 않은 `list_meeting_reports` 때문에
  `workflowIncomplete=true`가 되지 않는다.
- 필수 mutation chain의 capability 정의는 변경되지 않는다.
