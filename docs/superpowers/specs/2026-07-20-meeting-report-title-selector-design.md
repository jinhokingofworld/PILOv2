# 회의록 제목 Selector 설계

## 목표

Agent가 사용자가 언급한 회의록 제목을 회의방 이름과 혼동하지 않고, Workspace 접근 권한과 기존 기간·상태 조건 안에서 정확히 일치하는 MeetingReport를 선택한다.

## 설계

- MeetingReport selector에 `reportTitle`을 추가하고 `roomName`과 별도 필드로 유지한다.
- App Server는 `reportTitle`을 1~500자의 문자열로 검증해 기존 contextual resolution에 전달한다.
- Meeting 도메인의 Agent 전용 조회는 `COALESCE(user_title, title)`을 공백 축약·소문자화한 값으로 정확히 비교한다. 사용자가 수정한 제목이 있으면 그 제목이 우선한다.
- `from`, `to`, `status`, `roomName`, `reportTitle`은 함께 사용할 수 있다. context reference 또는 선택된 후보와 필터 묶음은 기존처럼 함께 사용할 수 없다.
- 결과가 하나면 바로 선택하고, 같은 제목이 여러 개면 기존 후보 선택 흐름을 유지한다.
- 회의록 후보의 label은 요약문이 아니라 회의록 제목을 사용하며, 제목이 없을 때만 `회의록`을 사용한다.

## 범위

- DB schema와 공개 Meeting REST API는 변경하지 않는다.
- Planner 이름 하드코딩이나 AI Worker 변경은 하지 않는다. App Server가 제공하는 Tool schema에 `reportTitle`이 노출되므로 Planner가 해당 필드를 사용할 수 있다.
- 부분 일치나 의미 검색은 추가하지 않는다. 잘못된 회의록 선택을 막기 위해 정확히 일치만 지원한다.

## 검증

- `summarize_meeting_report`가 `reportTitle`을 검증하고 resolver로 전달한다.
- Meeting Agent 조회 SQL이 사용자 제목을 우선해 정규화된 정확 일치를 적용한다.
- 후보가 여러 개일 때 제목이 label로 노출된다.
- 기존 Meeting Agent Tool 테스트와 App Server TypeScript 빌드를 통과한다.
