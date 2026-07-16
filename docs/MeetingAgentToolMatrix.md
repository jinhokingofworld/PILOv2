# Meeting·MeetingReport Agent Tool 매트릭스

이 문서는 회의/회의록 API 중 Chatbot Agent가 실제로 호출할 수 있는 tool과 아직
등록되지 않은 후보를 사용자 의도 기준으로 정리한다.

`현재 구현`은 `dev`의 App Server `AgentToolRegistryService`에 등록된 definition을 뜻한다.
`계약 확정·구현 PR 분리`는 이 문서에서 입출력·안전 경계를 확정하지만 코드 구현은 별도 PR로
진행하는 tool이다. Meeting API endpoint가 존재하더라도 Agent tool adapter가 없으면 **미구현**으로
표기한다.

## 확정된 다음 설계

- 저장된 action item은 회의의 후속작업이며, 승인하면 Calendar 일정과 Board issue를 자동 생성한다.
- 생성 자원은 action item과 FK 관계로 저장하고, 해당 생성 Activity Log는 action item을 parent로 기록한다.
- decision evidence는 같은 decision item을 직접 가리키는 reference가 있을 때만 보여준다.
- Chatbot은 Meeting 참여·나가기·녹음 시작·종료를 confirmation 후 직접 제어한다.
- Agent는 한 run 안에서 여러 tool을 순서대로 실행한다. 이전 사용자 입력·질문·bounded tool
  결과를 저장하는 run 범위 multi-turn memory를 다음 planner turn에 전달하고, 필요한 정보·확인에서만
  사람에게 제어를 넘긴다.

상세 계약과 구현 체크리스트는 [Meeting Agent 다단계 Workflow 설계](MeetingAgentWorkflowDesign.md)를
따른다. 이 설계는 현재 구현 API가 아니라 다음 확장 기준이다.

| 사용자 의도 | 이용하는 Tool | 예시 발화 | 실행 성격 |
| --- | --- | --- | --- |
| 회의방 목록과 방별 진행 상태를 본다 | **계약 확정·구현 PR 분리** `list_meeting_rooms`.<br>기존 API: `GET /workspaces/{workspaceId}/meeting-rooms`, `GET /workspaces/{workspaceId}/meeting-rooms/{meetingRoomId}/current` | “우리 워크스페이스 회의방이랑 지금 진행 중인 방 보여줘” | 자동 실행. 최대 100개 방의 현재 Meeting·녹음 상태를 요약한다 |
| 회의방에 참여하거나 재입장한다 | **미구현** — 후보 `join_meeting`.<br>기존 API: `POST /workspaces/{workspaceId}/meetings/{meetingId}/participants/me` | “디자인 회의에 들어가줘” | 미구현. LiveKit token 발급 뒤 Frontend 연결이 필요하고 녹음 동의 확인이 따르므로 별도 UI 계약이 필요 |
| 회의의 현재·과거 참여자를 본다 | **계약 확정·구현 PR 분리** `get_meeting_participants`.<br>기존 API: `GET /workspaces/{workspaceId}/meetings/{meetingId}/participants` | “오늘 디자인 회의에 누가 참여했어?” | 자동 실행. 최대 100명의 사용자별 참여 요약을 반환 |
| 내가 참여 중인 회의와 방을 본다 | **계약 확정·구현 PR 분리** `get_active_meeting`.<br>기존 API: `GET /me/meetings/active` | “내가 지금 들어가 있는 회의가 뭐야?” | 자동 실행. 현재 사용자의 active Meeting이 없으면 명시적으로 없음으로 반환 |
| 진행 중인 회의 시간을 본다 | **계약 확정·구현 PR 분리** `get_active_meeting`의 `durationSec` | “지금 회의 몇 분째야?” | 자동 실행. active Meeting의 `startedAt`과 현재 시각으로 계산 |
| 회의방에서 나간다 | **미구현** — 후보 `leave_meeting`.<br>기존 API: `DELETE /workspaces/{workspaceId}/meetings/{meetingId}/participants/me` | “회의에서 나가줘” | 미구현. 마지막 참여자면 회의 종료·녹음 종료가 연쇄될 수 있어 확인 후 실행 |
| 회의 녹음을 시작한다 | **미구현** — 후보 `start_meeting_recording`.<br>기존 API: `POST /workspaces/{workspaceId}/meetings/{meetingId}/recordings` | “지금 회의 녹음 시작해줘” | 미구현. 참여자 동의 재검증과 외부 Egress 시작이 있으므로 확인 후 실행 |
| 회의 녹음을 끝내고 회의록 생성을 요청한다 | **미구현** — 후보 `end_meeting_recording`.<br>기존 API: `POST /workspaces/{workspaceId}/meetings/{meetingId}/recordings/{recordingId}/end` | “녹음 끝내고 회의록 만들어줘” | 미구현. 녹음 종료·비동기 회의록 생성이 발생하므로 확인 후 실행 |
| 최근 또는 상태별 회의록을 찾는다 | **현재 구현** `list_meeting_reports` | “최근 회의록 보여줘”, “실패한 회의록만 보여줘” | 자동 실행. 현재 입력은 `status`, `limit`뿐이며 제목·기간 검색은 지원하지 않음 |
| 특정 회의록 상세와 생성 상태를 본다 | **현재 구현** `get_meeting_report` | “이 회의록이 왜 실패했어?” | 자동 실행. `reportId`가 필요하며 status/failed step을 반환 |
| 요약·논의사항·결정사항·후속 작업 후보만 정리한다 | **현재 구현** `summarize_meeting_report`.<br>report ID가 없으면 우선 `list_meeting_reports`로 최신 후보를 찾는다. | “어제 회의 결정사항과 후속 작업만 알려줘” | 자동 실행. summary/discussion/decisions와 `actionItemCandidates`를 bounded projection으로 반환 |
| transcript 근거로 회의 내용을 질문한다 | **계약 확정·구현 PR 분리** `search_meeting_transcript` | “API 버전은 왜 v2로 결정했어?” | 자동 실행, 근거 기반 답변. 권한 있는 transcript source만 별도 grounded-answer 경로로 사용 |
| 결정사항을 Activity evidence까지 포함해 검증한다 | **미구현** — 후보 `get_meeting_decision_evidence` | “v2 결정의 transcript와 Activity 근거를 함께 보여줘” | 미구현. 도입 시 자동 조회. 현재 `get_meeting_report`/`summarize_meeting_report` Agent projection에는 Activity evidence를 넣지 않음 |
| 내 담당 후속 작업을 상태·담당자 기준으로 찾는다 | **부분 구현** `summarize_meeting_report`는 특정 report의 후보를 반환한다.<br>후보 `find_action_items`는 아직 없음 | “내가 맡은 회의 후속 작업이 뭐야?” | 부분 구현. 현재는 assignee/status 전역 필터와 저장 action item 검색을 지원하지 않음 |
| 후속 작업을 수정·승인·반려한다 | **미구현** — 후보 `update_meeting_report_action_item`, `approve_meeting_report_action_item`, `dismiss_meeting_report_action_item`.<br>기존 API: action item `PATCH`/`approve`/`dismiss` | “2번 할 일을 은재에게 넘기고 승인해줘” | 미구현. 모두 확인 후 실행. **현행 API의 승인**은 Calendar·Board·GitHub를 변경하지 않으며, 확정 설계에서는 승인 뒤 자동 전달로 바뀐다 |
| 회의록에 없는 새 후속 작업을 만든다 | **미구현** — 제안된 `create_meeting_report_action_item`에 대응하는 현재 Meeting API도 없음 | “회의록에 문서 정리 할 일을 추가해줘” | 미구현. 먼저 Meeting API/저장 모델 계약이 필요하며, 이후 확인 후 실행 |
| 후속 작업을 일정으로 만든다 | **부분 구현** `create_calendar_event`.<br>`create_calendar_event_from_action_item`은 없음 | “이 할 일을 금요일 3시에 일정으로 잡아줘” | 확인 후 실행. 현재 Calendar tool은 일정을 만들지만 Meeting action item과의 연결·상태 변경은 하지 않음 |
| 기존 일정을 수정한다 | **현재 구현** `update_calendar_event` | “금요일 문서 정리 일정을 4시로 미뤄줘” | 확인 후 실행. 제목·명시적 날짜로 후보가 정확히 하나일 때만 실행 |
| 후속 작업을 이슈로 전환한다 | **미구현** — 후보 `create_board_issue_from_action_item` 또는 GitHub Issue 전용 tool.<br>현재 Board tool은 `search_board_issues` 조회만 지원 | “이 후속 작업을 이슈로 등록해줘” | 미구현. 이슈 생성과 Meeting action item 연결 정책을 먼저 정한 뒤 확인 후 실행 |
| 회의록 생성 상태를 확인하거나 실패한 회의록을 재생성한다 | 상태 조회는 **현재 구현** `list_meeting_reports`/`get_meeting_report`.<br>재생성 후보 `regenerate_meeting_report`는 미구현.<br>기존 API: `POST /workspaces/{workspaceId}/meeting-reports/{reportId}/regeneration-jobs` | “회의록 왜 아직 안 나왔어?”, “실패한 회의록을 다시 만들어줘” | 상태 조회는 자동 실행. 재생성은 미구현이며 도입 시 확인 후 실행 |

## 이번 계약에 명시된 Meeting tool

- `list_meeting_rooms`: Workspace 회의방과 방별 current Meeting·녹음 상태를 조회한다.
- `get_active_meeting`: 현재 사용자가 참여 중인 Meeting과 회의방, 진행 시간을 조회한다.
- `get_meeting_participants`: 특정 Meeting의 현재·과거 참여자 요약을 조회한다.
- `list_meeting_reports`: Workspace 회의록 목록을 `status`, `limit`으로 조회한다.
- `get_meeting_report`: UUID `reportId`의 상세와 상태를 조회한다.
- `summarize_meeting_report`: 한 회의록의 요약·논의·결정·후속 작업 후보를 Agent용으로 축약한다.
- `search_meeting_transcript`: transcript RAG 검색 후 source 근거를 사용한 답변 생성 경로를 시작한다.

현재 Calendar tool은 `list_calendar_events`, `create_calendar_event`,
`update_calendar_event`이고, Board tool은 `search_board_issues`다. 이들은 회의
후속 작업과 자동 연결되지 않는다.

## 다음 구현 단위

구현 순서는 고정하지 않는다. 확정된 데이터 모델·상태 전이·Agent loop 계약과 세부
체크리스트는 [Meeting Agent 다단계 Workflow 설계](MeetingAgentWorkflowDesign.md)를 따른다.

- 저장된 후속작업 조회와, 직접 evidence reference가 있는 결정 근거 조회
- 후속작업 승인에 따른 Calendar 일정·Board issue 자동 생성 및 전달 관계 저장
- 회의 입장·퇴장·녹음 제어와 LiveKit token을 노출하지 않는 client action
- `waiting_user_input`·confirmation·다음 tool 실행을 잇는 다단계 Agent loop
- 새 endpoint가 필요하면 이 문서와 `docs/api/agent-api.md`를 함께 갱신

## 기준 소스

- [Meeting API 계약](api/meeting-api.md)
- [Agent API 계약](api/agent-api.md)
- [Agent Tool 개발 가이드](AgentToolGuide.md)
- `apps/app-server/src/modules/agent/tools/meeting-agent-tools.service.ts`
