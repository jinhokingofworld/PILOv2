# Agent Post-MVP

작성일: 2026-07-07

이 문서는 PILO MVP 시연 이후 기획과 구현에 들어갈 Agent 기능의 작업 기준을
정리한다. 현재 구현 기준 API 계약 문서는 아니며, 실제 개발에 착수할 때는
`docs/api/agent-api.md`를 별도로 만들고 DB migration, app-server module,
frontend feature 범위를 확정한다.

## 목표

PILO Agent는 단순 LLM 답변 기능이 아니라, PILO 내부 기능을 자연어로 조합해
실행하는 업무 실행 layer다.

사용자는 한 문장으로 요청하고, Agent는 Workspace 문맥과 PILO 데이터를 읽은 뒤
필요한 기능을 선택해 실행 계획을 만든다. 읽기 작업은 자동으로 수행할 수 있고,
외부 상태나 팀 데이터를 바꾸는 작업은 사용자 확인 후 실행한다.

기본 실행 모델:

```text
Read -> Plan -> Confirm -> Act
```

## 제품 포지션

Agent는 "LLM 딸깍" 기능이 아니다.

단순 LLM 기능은 보통 사용자 입력을 받아 텍스트 답변을 생성하는 데서 끝난다. PILO
Agent는 아래 흐름까지 포함한다.

- 현재 사용자의 Workspace 권한 확인
- PILO 도메인 기능을 tool로 선택
- 기획서, 보드, 회의록, 캘린더, PR Review 등에서 필요한 context 조회
- 실행 계획 생성
- 위험도 판단
- 사용자 확인
- 실제 API 실행
- 실행 로그와 audit trail 저장
- 결과 요약과 실패 처리

따라서 핵심 가치는 LLM 모델 자체보다 PILO의 업무 데이터와 도메인 기능을 안전하게
연결하는 tool layer, permission layer, confirmation gate, audit log에 있다.

## 1주일 목표 범위

5명이 agent-assisted로 1주일 집중 구현한다고 가정하면, 목표는 완전 자율 Agent가
아니라 확인 기반 업무 Agent MVP다.

가능한 목표:

- 기획서/API 문서/회의록을 읽고 답변한다.
- Board issue를 검색하고 관련 후보를 추론한다.
- Calendar 일정을 조회, 생성, 수정한다.
- Meeting report를 요약하고 action item 후보를 뽑는다.
- PR Review session 조회와 제한적인 생성 흐름을 연결한다.
- GitHub sync 실행을 제안하고, 확인 후 실행한다.
- Board issue status를 확인 후 이동한다.
- Agent 실행 로그를 저장한다.
- 실행 전 확인 UI를 제공한다.
- 권한 없음, GitHub token 없음, provider 실패를 사용자에게 설명한다.

제외 또는 후순위:

- 모든 기능의 완전 자동 실행
- PR Review 자동 제출
- GitHub issue label, assignee, milestone, due date 변경
- Board due date 자동 변경
- Canvas 자유 편집 자동 생성/수정
- Meeting 녹음 시작/종료 자동 실행
- 자동 rollback
- 장기 비동기 workflow orchestration
- 모든 tool에 대한 정교한 평가/eval 체계

## 대표 시나리오

### 시나리오 A: 기획서 기반 issue 탐색

```text
PILO 기획서 읽어보고, 보드에서 관련 issue 있는지 찾아봐.
```

처리:

1. `read_project_plan`으로 기획서 주요 section을 읽는다.
2. 사용자 요청에서 키워드와 도메인을 추출한다.
3. `search_board_issues`로 Board issue 후보를 찾는다.
4. 관련도와 근거를 정리해 답변한다.

### 시나리오 B: 확인 후 일정 생성

```text
지난 회의록에서 액션 아이템 후보 뽑고 이번 주 캘린더에 후속 회의 잡아줘.
```

처리:

1. `list_meeting_reports`, `get_meeting_report`로 최근 회의록을 찾는다.
2. action item 후보를 요약한다.
3. `list_calendar_events`로 충돌 가능 시간을 확인한다.
4. 새 일정 생성 계획을 보여준다.
5. 사용자가 확인하면 `create_calendar_event`를 실행한다.

### 시나리오 C: Board 상태 이동

```text
PR Review 관련 open issue 중 바로 착수할 만한 것들을 In Progress로 옮겨줘.
```

처리:

1. `search_board_issues`로 후보를 찾는다.
2. `list_board_columns`로 이동 가능한 column을 확인한다.
3. 후보 issue와 변경 예정 status를 보여준다.
4. 사용자가 확인하면 `move_board_issue_status`를 실행한다.

주의: issue due date를 1주일 뒤로 미루는 기능은 현재 Board API 범위를 넘어선다.
GitHub ProjectV2 Date field write tool을 별도 구현해야 한다.

## 1차 Tool 범위

| Tool | 위험도 | 설명 |
| --- | --- | --- |
| `read_project_plan` | 낮음 | `Project_Planning_Document.md`에서 관련 section을 읽는다. |
| `read_api_docs` | 낮음 | `docs/api/*.md`에서 현재 API 계약을 읽는다. |
| `list_boards` | 낮음 | 현재 Workspace의 Board 목록을 조회한다. |
| `search_board_issues` | 낮음 | Board issue 목록 API의 `search`, `state`, `label`, `assignee` 필터를 사용한다. |
| `get_board_issue` | 낮음 | issue 상세와 관련 PR 후보를 조회한다. |
| `list_calendar_events` | 낮음 | 일정 충돌 확인용으로 Calendar event를 조회한다. |
| `list_meeting_reports` | 낮음 | 최근 회의록 목록을 조회한다. |
| `get_meeting_report` | 낮음 | 회의록 상세를 조회한다. |
| `list_pr_review_sessions` | 낮음 | PR Review session 후보를 조회한다. |
| `start_github_sync` | 중간 | GitHub sync를 시작한다. 확인 필요. |
| `create_calendar_event` | 중간 | Calendar event를 생성한다. 확인 필요. |
| `update_calendar_event` | 중간 | Calendar event를 수정한다. 확인 필요. |
| `move_board_issue_status` | 중간 | ProjectV2 Status field를 변경한다. 확인 필요. |
| `create_pr_review_session` | 중간 | PR Review session을 생성한다. 확인 필요. |

고위험 tool은 1차 범위에서 제외한다.

- `submit_pr_review`
- `delete_*`
- `start_meeting_recording`
- `end_meeting_recording`
- `update_github_issue_label`
- `update_github_issue_assignee`
- `update_github_project_due_date`

## 안전 정책

Agent는 작업을 위험도 기준으로 분류한다.

| 위험도 | 예시 | 정책 |
| --- | --- | --- |
| 낮음 | 문서 읽기, 목록 조회, 요약 | 자동 실행 가능 |
| 중간 | 일정 생성, Board status 이동, GitHub sync | 사용자 확인 후 실행 |
| 높음 | 삭제, PR Review 제출, 외부 GitHub issue metadata 변경 | post-MVP 후순위 또는 별도 강한 확인 |

모든 write tool은 아래 정보를 confirmation payload에 포함해야 한다.

- 변경 대상
- 현재 값
- 변경 예정 값
- 호출할 API 또는 provider
- 실패 시 영향
- 실행 사용자

Agent는 request body의 `workspaceId`, `userId`를 신뢰하지 않고, 기존 API와 동일하게
현재 bearer session과 path의 `workspaceId` 기준으로 권한을 확인한다.

## Backend 구조 초안

새 도메인 module:

```text
apps/app-server/src/modules/agent/
  agent.module.ts
  agent.controller.ts
  agent.service.ts
  agent-runtime.service.ts
  agent-tool-registry.service.ts
  agent-confirmation.service.ts
  tools/
    project-plan.tool.ts
    board.tool.ts
    calendar.tool.ts
    meeting.tool.ts
    pr-review.tool.ts
    github-sync.tool.ts
  dto/
  types/
```

`src/app.module.ts`에 `AgentModule`을 등록해야 하므로 app-server 공통 영역 변경에
해당한다. 작업 시작 전 `apps/app-server/APP_SERVER_COMMON_AREAS.md` 기준으로 영향
범위를 정리한다.

## DB 초안

### `agent_runs`

Agent 대화 또는 실행 요청 한 건을 저장한다.

```sql
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'low',
  final_answer TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT agent_runs_status_check
    CHECK (status IN ('planning', 'waiting_confirmation', 'running', 'completed', 'failed', 'cancelled')),
  CONSTRAINT agent_runs_risk_level_check
    CHECK (risk_level IN ('low', 'medium', 'high'))
);
```

### `agent_steps`

Agent가 어떤 tool을 어떤 입력으로 호출했고 어떤 결과를 받았는지 저장한다.

```sql
CREATE TABLE agent_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'low',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT agent_steps_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  CONSTRAINT agent_steps_risk_level_check
    CHECK (risk_level IN ('low', 'medium', 'high')),
  CONSTRAINT agent_steps_run_order_unique
    UNIQUE (run_id, step_order)
);
```

### `agent_confirmations`

중간 이상 위험도의 실행 계획에 대해 사용자 확인 상태를 저장한다.

```sql
CREATE TABLE agent_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending',
  plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_confirmations_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
);
```

DB schema 변경이므로 DB Schema owner 확인이 필요하다.

## API 초안

실제 구현 시작 시 `docs/api/agent-api.md`로 승격한다.

```http
POST /api/v1/workspaces/{workspaceId}/agent/runs
GET /api/v1/workspaces/{workspaceId}/agent/runs
GET /api/v1/workspaces/{workspaceId}/agent/runs/{runId}
POST /api/v1/workspaces/{workspaceId}/agent/runs/{runId}/confirmations/{confirmationId}/approve
POST /api/v1/workspaces/{workspaceId}/agent/runs/{runId}/confirmations/{confirmationId}/reject
```

1차 구현은 HTTP request/response 방식으로 시작한다. streaming UI는 후순위로 둔다.
필요하면 run polling으로 단계별 진행 상태를 갱신한다.

## Frontend 구조 초안

```text
apps/frontend/src/features/agent/
  page.tsx
  navigation.ts
  api/client.ts
  components/
    agent-chat-panel.tsx
    agent-run-timeline.tsx
    agent-confirmation-card.tsx
    agent-tool-result.tsx
  types/
```

`src/app/agent/page.tsx`는 route bridge로 feature page를 re-export한다.
navigation 등록은 `src/features/navigation.ts` 변경이 필요하다. sidebar 자체 변경은
가능하면 피한다.

## 팀 분장 초안

| 역할 | 담당 범위 |
| --- | --- |
| Agent Runtime | LLM 호출, plan/execute loop, tool schema, tool registry |
| Backend Tools | Board/GitHub/Calendar/Meeting/PR Review tool adapter 구현 |
| Frontend | 채팅 UI, plan preview, confirmation UI, run history |
| DB/API/문서 | `agent_runs`, `agent_steps`, confirmation schema, API 계약 문서 |
| QA/Eval | 대표 시나리오, 권한 실패, provider 실패, hallucination 방지 테스트 |

## 1주일 작업 계획

| 기간 | 목표 |
| --- | --- |
| Day 1 | Agent API 계약, DB migration, module skeleton, 기본 chat UI |
| Day 2 | 문서 read tool, Workspace/Board read tools, issue search |
| Day 3 | Calendar/Meeting/PR Review read tools, planner 응답 정리 |
| Day 4 | confirmation gate, Calendar create/update, Board status move |
| Day 5 | GitHub sync와 PR Review 생성 같은 제한 write, 권한/에러 처리 |
| Day 6 | 통합 UI polish, 실행 로그 화면, 테스트 |
| Day 7 | 시나리오 QA, demo script, 문서/PR 정리 |

## Acceptance Criteria

1차 Agent MVP는 아래 시나리오가 동작하면 성공으로 본다.

- 사용자가 자연어로 기획서 기반 질문을 하면 Agent가 기획서 section을 근거로 답한다.
- 사용자가 자연어로 Board issue 검색을 요청하면 Agent가 관련 issue 후보와 근거를
  반환한다.
- 사용자가 캘린더 일정 생성을 요청하면 Agent가 생성 계획을 보여주고, 확인 후 event를
  생성한다.
- 사용자가 Board issue status 이동을 요청하면 Agent가 대상 issue와 이동할 column을
  보여주고, 확인 후 이동한다.
- Agent run 상세에서 tool 호출 순서, 입력, 출력 요약, 실패 원인을 볼 수 있다.
- 권한이 없는 Workspace나 GitHub write 권한이 없는 작업은 실행하지 않고 이유를
  설명한다.

## 주요 리스크

- 자연어 판단이 틀릴 수 있다. 중간 이상 위험도의 write는 반드시 확인 후 실행한다.
- Board due date, label, assignee, milestone 변경은 현재 Board API 범위 밖이다.
- PR Review 제출은 외부 GitHub 상태를 바꾸는 고위험 작업이므로 1차 범위에서 제외한다.
- Meeting 녹음 시작/종료는 실시간 회의 상태와 연결되므로 1차 범위에서 제외한다.
- LLM provider 장애 또는 timeout이 있을 수 있다. run은 `failed`로 남기고 재시도 정책은
  후순위로 둔다.
- Tool이 너무 넓으면 agent가 잘못된 실행 계획을 세우기 쉽다. 1차는 tool 목록을 작고
  명확하게 유지한다.

## 추후 확장

- Board due date 변경 tool
- GitHub issue label, assignee, milestone 변경 tool
- PR Review 제출 confirmation flow
- Canvas 요약/노드 생성 tool
- agent run streaming
- 반복 작업, 예약 실행, 장기 workflow
- agent eval dataset과 regression test
- 팀별 policy preset
- read-only mode, confirm mode, limited autonomous mode 분리
