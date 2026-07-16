# Meeting·MeetingReport Agent Tool 매트릭스

이 문서는 회의/회의록 API 중 Chatbot Agent가 실제로 호출할 수 있는 tool과 아직
등록되지 않은 후보를 사용자 의도 기준으로 정리한다.

`현재 구현`은 App Server의 `AgentToolRegistryService`에 등록된 definition을 뜻한다.
Meeting API endpoint가 존재하더라도 Agent tool adapter가 없으면 **미구현**으로 표기한다.
표는 각 행에서 현재 구현과 아직 남은 후보를 구분한다.

## 확정된 설계 결정 기록

이 절은 현재 구현과 후속 확장에서 계속 지켜야 할 제품 기준이다.

### 회의록·후속작업

- 저장된 action item은 회의의 **후속작업**이다. 아직 승인·저장되지 않은 AI 후보는 후속작업으로
  취급하지 않는다.
- action item을 승인하면 사용자가 선택한 **하나의** Calendar 일정 또는 Board issue를 자동 생성한다.
- 생성한 Calendar 일정 또는 Board issue는 원본 action item과의 관계를 저장한다. Activity Log는
  delivery FK가 가리키는 resource의 기존 target 관계를 따라 조회한다.
- decision evidence는 **같은 decision item을 직접 가리키는** evidence reference가 있을 때만 표시한다.

### Agent loop

- Agent는 하나의 run 안에서 planner → tool → planner를 여러 번 순서대로 실행할 수 있다.
  이전 사용자 입력·질문·bounded tool 결과는 run 범위 multi-turn memory로 다음 planner turn에 전달한다.
- 사람에게 제어를 넘기는 시점은 후보 선택, 필요한 동의·confirmation, 또는 필수 정보 누락일 때로
  제한한다. 그 외에는 Agent가 다음 tool 호출을 계속 결정한다.

### Chatbot의 직접 Meeting 제어

- Chatbot은 `start_meeting_in_room`, `join_meeting`/재입장, `leave_meeting`,
  `start_meeting_recording`, `end_meeting_recording`을 직접 제어 범위로 둔다.
- 시작·참여 전에 서버의 `workspace_recording_consents`에서 현재 사용자·Workspace의 유효한 녹음
  동의를 확인한다. 유효한 동의가 있으면 별도 confirmation 없이 진행하고, 없으면 Chatbot이 사용자
  대신 동의를 받은 뒤 동의 값을 포함해 호출한다. 브라우저 `localStorage`는 이 판단의 기준이 아니다.
- 이름이 모호하거나 회의가 없으면 AI는 추측으로 바로 실행하지 않고 “이 회의를 찾으셨나요?”와 함께
  회의방 후보를 최대 3개 제시해 선택받는다.
- 참여 성공은 서버 participant session 생성과 브라우저 LiveKit 연결 성공이 모두 확인된 상태다.
  token은 한 번만 넘기는 handoff로 처리하며, Frontend는 20초 안에 연결 결과를 반환해야 한다.
  실패·시간 초과이면 Agent run을 실패 처리하고 participant session을 정리한다.
- 사용자가 다른 회의에 참여 중이면 `현재 회의에서 나간 뒤 참여`를 하나의 결합 confirmation으로
  받는다. 반면 사용자가 명시적으로 요청한 일반 나가기는 confirmation 없이 실행한다.
- 녹음 시작·종료는 대상 Meeting과 영향을 명시한 confirmation 뒤 실행한다. 권한 대상은 host만이
  아니라 모든 active participant다.
- 마지막 참여자의 일반 나가기는 기존 도메인 흐름대로 녹음 종료 → 회의 종료 → 회의록 생성을
  자동으로 이어간다.

상세 계약과 구현 체크리스트는 [Meeting Agent 다단계 Workflow 설계](MeetingAgentWorkflowDesign.md)를
따른다. 이 설계와 현재 Agent API 계약을 함께 구현 기준으로 사용한다.

| 사용자 의도 | 이용하는 Tool | 예시 발화 | 실행 성격 |
| --- | --- | --- | --- |
| 회의방 목록과 방별 진행 상태를 본다 | **현재 구현** `list_meeting_rooms`.<br>기존 API: `GET /workspaces/{workspaceId}/meeting-rooms`, `GET /workspaces/{workspaceId}/meeting-rooms/{meetingRoomId}/current` | “우리 워크스페이스 회의방이랑 지금 진행 중인 방 보여줘” | 자동 실행. 최대 100개 방의 현재 Meeting·녹음 상태를 요약한다 |
| 회의방에서 회의를 시작한다 | `start_meeting_in_room` | “디자인 회의실에서 회의 시작해줘” | 확인 후 실행. 동의가 없으면 먼저 사용자에게 묻고, 성공하면 token 대신 `connect_meeting` client action을 반환 |
| 회의방에 참여하거나 재입장한다 | `join_meeting` | “디자인 회의에 들어가줘” | 확인 후 실행. 다른 회의에 참여 중이면 확인 계획에 기존 회의 퇴장을 함께 표시하고, 성공하면 `connect_meeting` client action을 반환 |
| 회의의 현재·과거 참여자를 본다 | **현재 구현** `get_meeting_participants`.<br>기존 API: `GET /workspaces/{workspaceId}/meetings/{meetingId}/participants` | “오늘 디자인 회의에 누가 참여했어?” | 자동 실행. 최대 100명의 사용자별 참여 요약을 반환 |
| 내가 참여 중인 회의와 방을 본다 | **현재 구현** `get_active_meeting`.<br>기존 API: `GET /me/meetings/active` | “내가 지금 들어가 있는 회의가 뭐야?” | 자동 실행. 현재 사용자의 active Meeting이 없으면 명시적으로 없음으로 반환 |
| 진행 중인 회의 시간을 본다 | **현재 구현** `get_active_meeting`의 `durationSec` | “지금 회의 몇 분째야?” | 자동 실행. active Meeting의 `startedAt`과 현재 시각으로 계산 |
| 회의방에서 나간다 | `leave_meeting` | “회의에서 나가줘” | 명시적 일반 나가기는 자동 실행. 마지막 참여자면 기존 흐름대로 녹음 종료·회의 종료·회의록 생성이 연쇄될 수 있다 |
| 회의 녹음을 시작한다 | `start_meeting_recording` | “지금 회의 녹음 시작해줘” | 참여자 동의 재검증과 외부 Egress 시작이 있으므로 확인 후 실행 |
| 회의 녹음을 끝내고 회의록 생성을 요청한다 | `end_meeting_recording` | “녹음 끝내고 회의록 만들어줘” | 확인 후 실행. Agent는 recording ID를 받거나 추측하지 않고 서버가 current recording을 해소 |
| 최근 또는 상태별 회의록을 찾는다 | **현재 구현** `list_meeting_reports` | “최근 회의록 보여줘”, “실패한 회의록만 보여줘” | 자동 실행. 현재 입력은 `status`, `limit`뿐이며 제목·기간 검색은 지원하지 않음 |
| 특정 회의록 상세와 생성 상태를 본다 | **현재 구현** `get_meeting_report` | “이 회의록이 왜 실패했어?” | 자동 실행. `reportId`가 필요하며 status/failed step을 반환 |
| 요약·논의사항·결정사항·후속 작업 후보만 정리한다 | **현재 구현** `summarize_meeting_report`.<br>report ID가 없으면 우선 `list_meeting_reports`로 최신 후보를 찾는다. | “어제 회의 결정사항과 후속 작업만 알려줘” | 자동 실행. summary/discussion/decisions와 `actionItemCandidates`를 bounded projection으로 반환 |
| 회의 발언·실제 활동 근거로 회의 내용을 질문한다 | **현재 구현** `search_meeting_transcript` | “왜 다음 주로 미뤘고, 실제로 무엇을 했어?” | 자동 실행, 근거 기반 답변. 권한 있는 transcript와 안전한 Activity evidence source를 별도 grounded-answer 경로로 사용 |
| 결정사항을 Activity evidence까지 포함해 검증한다 | `get_meeting_decision_evidence` | “v2 결정의 transcript와 Activity 근거를 함께 보여줘” | 자동. 같은 decision sourceIndex에 직접 연결된 evidence만 반환 |
| 내 담당 후속 작업을 상태·담당자 기준으로 찾는다 | **현재 구현** `find_action_items` | “내가 맡은 회의 후속 작업이 뭐야?” | 자동 실행. 저장된 후속작업을 담당자·상태 기준으로 조회 |
| 후속 작업을 수정·승인·반려한다 | `update_meeting_report_action_item`, `approve_meeting_report_action_item`, `dismiss_meeting_report_action_item` | “2번 할 일을 은재에게 넘기고 승인해줘” | 확인 후 실행. 승인은 하나의 Calendar 일정 또는 Board issue를 생성하고 관계를 저장한다 |
| 회의록에 없는 새 후속 작업을 만든다 | **미구현** — 제안된 `create_meeting_report_action_item`에 대응하는 현재 Meeting API도 없음 | “회의록에 문서 정리 할 일을 추가해줘” | 미구현. 먼저 Meeting API/저장 모델 계약이 필요하며, 이후 확인 후 실행 |
| 후속 작업을 일정으로 만든다 | `approve_meeting_report_action_item`의 `calendar_event` delivery | “이 할 일을 금요일 3시에 일정으로 잡아줘” | 확인 후 Calendar badge 하나를 생성하고 action item relation을 저장한다 |
| 기존 일정을 수정한다 | **현재 구현** `update_calendar_event` | “금요일 문서 정리 일정을 4시로 미뤄줘” | 확인 후 실행. 제목·명시적 날짜로 후보가 정확히 하나일 때만 실행 |
| 후속 작업을 이슈로 전환한다 | `approve_meeting_report_action_item`의 `pilo_issue` delivery. Board 선택에는 등록된 Board context tool을 연쇄 사용 | “이 후속 작업을 이슈로 등록해줘” | 확인 후 issue badge 하나를 생성하고 action item relation을 저장한다 |
| 회의록 생성 상태를 확인하거나 실패한 회의록을 재생성한다 | 상태 조회는 `list_meeting_reports`/`get_meeting_report`, 재생성은 `regenerate_meeting_report`.<br>기존 API: `POST /workspaces/{workspaceId}/meeting-reports/{reportId}/regeneration-jobs` | “회의록 왜 아직 안 나왔어?”, “실패한 회의록을 다시 만들어줘” | 상태 조회는 자동 실행. 재생성은 확인 후 실행 |

## 현재 등록된 Meeting tool 확정 목록

- `list_meeting_rooms`: Workspace 회의방과 방별 current Meeting·녹음 상태를 조회한다.
- `get_active_meeting`: 현재 사용자가 참여 중인 Meeting과 회의방, 진행 시간을 조회한다.
- `get_meeting_participants`: 특정 Meeting의 현재·과거 참여자 요약을 조회한다.
- `start_meeting_in_room`: 선택한 방에서 회의를 시작하고 안전한 연결 action을 반환한다.
- `join_meeting`: 회의에 참여·재입장하고 안전한 연결 action을 반환한다.
- `leave_meeting`: 현재 participant session에서 나간다.
- `start_meeting_recording`: active Meeting 녹음을 확인 후 시작한다.
- `end_meeting_recording`: current recording을 확인 후 종료하고 회의록 생성을 요청한다.
- `list_meeting_reports`: Workspace 회의록 목록을 `status`, `limit`으로 조회한다.
- `get_meeting_report`: UUID `reportId`의 상세와 상태를 조회한다.
- `summarize_meeting_report`: 한 회의록의 요약·논의·결정·후속 작업 후보를 Agent용으로 축약한다.
- `search_meeting_transcript`: transcript와 안전한 Activity evidence RAG 검색 후 source type을 구분한 근거 답변 생성 경로를 시작한다.
- `find_action_items`: 저장된 후속작업을 담당자·상태 기준으로 조회한다.
- `get_meeting_decision_evidence`: 같은 decision item에 직접 연결된 근거만 조회한다.
- `update_meeting_report_action_item`: 저장된 후속작업을 확인 후 수정한다.
- `dismiss_meeting_report_action_item`: 저장된 후속작업을 확인 후 반려한다.
- `approve_meeting_report_action_item`: 선택한 일정 또는 이슈 하나를 생성하며 후속작업을 승인한다.
- `regenerate_meeting_report`: 실패한 회의록의 재생성을 확인 후 요청한다.

현재 Calendar tool은 `list_calendar_events`, `create_calendar_event`,
`update_calendar_event`이다. Board tool은 검색·문맥 조회·생성·상태 이동·담당자 변경·동기화
진단을 제공한다. 후속작업에서 생성된 일정·이슈 연결은 Meeting delivery가 담당한다.

## 남은 통합 단위

구현 순서는 고정하지 않는다. 확정된 데이터 모델·상태 전이·Agent loop 계약과 세부
체크리스트는 [Meeting Agent 다단계 Workflow 설계](MeetingAgentWorkflowDesign.md)를 따른다.

- Agent chat UI의 clarification 입력과 `connect_meeting` client action 처리
- 실제 Postgres에서 migration 074의 FK·상태 제약과 RLS 검증
- LiveKit 연결 성공·실패 callback과 participant session 정리의 Frontend E2E 검증
- 새 endpoint가 필요하면 이 문서와 `docs/api/agent-api.md`를 함께 갱신

## 기준 소스

- [Meeting API 계약](api/meeting-api.md)
- [Agent API 계약](api/agent-api.md)
- [Agent Tool 개발 가이드](AgentToolGuide.md)
- `apps/app-server/src/modules/agent/tools/meeting-agent-tools.service.ts`
