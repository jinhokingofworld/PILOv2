# PR Review Agent 핵심 파일 추천 설계

## 목적

특정 PR Review 세션 화면에서 Agent에게 “핵심만 골라줘”라고 요청하면, 이미 저장된
PR Review 분석 결과를 바탕으로 실제로 확인할 가치가 큰 파일만 짧게 추천한다.

Agent는 raw diff나 코드 원문을 다시 분석하지 않는다. PR Review Worker가 해당 revision에
이미 저장한 위험도, 역할, 변경 요약, review point, 파일 관계와 파일 판단 상태만 사용한다.

## 범위

V1 Tool은 읽기 전용 `recommend_pr_review_focus` 하나다.

- 현재 PR Review session을 기준으로 반드시 확인할 파일을 최대 3개 추천한다.
- 선택된 핵심 파일과 직접 관계가 있는 테스트 또는 API 계약 파일을 최대 2개 보조 추천한다.
- 사용자가 API, 백엔드, 프론트엔드, 테스트를 명시하면 해당 역할 범위에서 우선 추천한다.
- 일반 Agent 화면과 SQLtoERD 화면에서는 Tool을 Planner에 제공하지 않는다.

다음은 V1 범위가 아니다.

- raw diff, 코드 원문, patch, 사용자 comment 전달 또는 재분석
- 파일 판단 자동 저장, GitHub Review 제출, conflict apply, PR merge
- 전체 파일 목록 또는 기존 review order를 Agent가 다시 설명하는 기능
- Dashboard에서 PR을 검색하거나 여러 Review room 중 하나를 고르는 기능
- Activity Log 추가 기록

## 현재 foundation과 확장 원칙

Agent에는 이미 SQLtoERD를 위한 `requestContext`, `contextual` execution, immutable tool
schema snapshot이 있다. 새 Agent context foundation을 만들지 않고 이 계약을 PR Review까지
확장한다.

```ts
type AgentRunRequestContext =
  | { surface: "sql_erd"; sessionId: string }
  | { surface: "pr_review"; sessionId: string }
  | null;
```

`sessionId`는 Frontend URL의 `reviewSessionId`에서 얻는 힌트일 뿐이다. App Server는 run 생성
시 현재 사용자의 Workspace 접근 권한을 확인한 뒤, `pr_review_sessions`가 연결된
`pr_review_rooms.workspace_id`와 path의 Workspace가 일치하는지 서버에서 재검증한다.

검증된 context만 `agent_runs.request_context_json`에 저장하고 outbox, SQS payload,
tool schema snapshot, AgentToolContext로 전달한다. 같은 `clientRequestId` 재시도는
prompt, timezone, requestContext가 모두 같을 때만 기존 run을 반환한다.

## 화면별 Tool 노출 정책

Tool마다 선택적인 `contextRequirement` metadata를 선언한다.

```ts
type AgentToolContextRequirement = {
  surface: "pr_review" | "sql_erd";
};

type AgentToolDefinition<TInput> = {
  // existing fields
  contextRequirement?: AgentToolContextRequirement;
};
```

- `contextRequirement`가 없는 기존 Calendar, Meeting, Board, SQLtoERD Tool은 global Tool로
  모든 화면에서 현재 동작을 유지한다.
- `recommend_pr_review_focus`만 `{ surface: "pr_review" }`를 선언한다.
- Agent 공통부는 Tool 이름을 비교하지 않는다. 검증·저장된 run requestContext의 surface와
  metadata가 일치하는 Tool만 schema snapshot에 넣는다.
- snapshot filtering은 Planner가 잘못된 Tool을 선택하지 않게 하는 사용성 규칙이다.
- 실행 전 surface guard와 Tool의 `prepareExecution` 재검증은 실제 실행을 막는 보안 규칙이다.

따라서 Tool 제공 범위는 다음과 같다.

| Agent 실행 위치 | `recommend_pr_review_focus` |
| --- | --- |
| 일반 Chat/Dashboard (`requestContext = null`) | 제공하지 않음 |
| SQLtoERD (`surface = sql_erd`) | 제공하지 않음 |
| PR Review session (`surface = pr_review`) | 제공 |

## 실행 흐름

```text
PR Review 화면 (/pr-review?reviewSessionId=...)
  -> Frontend가 { surface: "pr_review", sessionId } 전송
  -> App Server가 Workspace와 session -> room 소속 검증
  -> agent_runs에 검증된 requestContext 저장
  -> contextRequirement에 맞는 Tool만 schema snapshot 생성
  -> AI Worker Planner가 recommend_pr_review_focus 선택
  -> App Server execution guard가 surface 일치 재검증
  -> PR Review Tool prepareExecution이 session/room/Workspace와 상태 재검증
  -> 저장된 revision 분석 결과에서 bounded 추천 반환
```

`recommend_pr_review_focus`는 `executionMode: "contextual"`을 선언한다.
`prepareExecution`은 다음 중 하나를 반환한다.

- context와 session이 유효하고 session이 분석 완료 상태이면 실행
- session이 `analyzing`이면 분석 완료 후 다시 요청하라는 안내
- session이 `failed`이면 PR Review 화면에서 분석 재시도를 안내
- context가 없거나 surface가 다르거나 session/room/Workspace가 유효하지 않으면 실행 거부

Tool 실행 전에도 session과 room의 Workspace를 다시 조회한다. run 생성 뒤 session이
삭제되거나 현재 Workspace와의 관계가 달라진 경우에도 다른 리소스를 읽지 않는다.

## 추천 입력과 출력

Tool은 session ID를 입력으로 받지 않는다. session은 검증된 requestContext에서만 읽는다.

Planner 입력은 선택적 `focus` 하나만 받는다.

```ts
type RecommendPrReviewFocusInput = {
  focus?: "api" | "backend" | "frontend" | "test";
};
```

사용자가 범위를 명시하지 않으면 전체 분석 결과에서 추천한다.

출력은 다음 정보만 포함한다.

```ts
type FocusFile = {
  filePath: string;
  riskLevel: "high" | "medium" | "low" | "unknown";
  roleType: string;
  changeSummary: string;
  reviewPoints: string[];
  decisionStatus: "not_reviewed" | "approved" | "discussion_needed" | "unknown";
  reasons: string[];
};

type RecommendPrReviewFocusOutput = {
  mustReview: FocusFile[]; // max 3
  relatedFiles: FocusFile[]; // max 2
  deferredFileCount: number;
};
```

각 문자열은 Tool 경계에서 제한한다.

- filePath: 최대 400자
- changeSummary: 최대 300자
- review point와 reason: 항목당 최대 160자, 각각 최대 3개
- raw diff, 코드 원문, patch, 사용자 comment, provider raw payload, token은 입력·출력·run/step
  저장값에 포함하지 않는다.

## 추천 규칙

서버가 우선순위를 결정하고 Agent는 bounded 결과를 설명한다. LLM이 파일 순위를 임의로
만들지 않는다.

추천 후보는 현재 불변 revision의 `review_files`, flow membership, semantic relation,
파일 decision 상태에서만 만든다.

우선순위는 다음 순서로 판단한다.

1. `discussion_needed`, `unknown`, `not_reviewed` 상태를 이미 `approved`인 파일보다 우선한다.
2. `high`, `medium` 위험도를 우선한다.
3. `core_logic`, `api_contract`, `entry` 역할을 우선한다.
4. 같은 수준이면 다른 파일과 직접 semantic relation이 많은 파일을 우선한다.
5. `focus`가 있으면 아래 역할의 후보만 사용한다. 후보가 없으면 안전한 빈 추천과 이유를 반환한다.
   - `api`: `api_contract`
   - `backend`: `entry`, `core_logic`, `support`
   - `frontend`: `ui_state`
   - `test`: `verification`
6. 문서, 단순 support, 낮은 위험도 파일은 상위 후보가 부족할 때만 사용한다.

`relatedFiles`는 선택된 핵심 파일과 `tests`, `uses_api`, `passes_data_to` 관계가 있는
파일을 우선한다. 이미 `mustReview`에 포함된 파일은 중복하지 않는다.

## 변경 책임

### Agent 공통

- `AgentRunRequestContext`에 `pr_review` surface 추가
- run 생성 parser와 `pr_review_sessions -> pr_review_rooms.workspace_id` 검증 추가
- `agent_runs.request_context_json` check constraint를 새 migration에서 확장
- AI Worker requestContext parser 확장
- optional `contextRequirement` metadata, registry filtering, schema snapshot filtering,
  실행 전 surface guard 추가
- Agent API 문서와 공통 Agent 테스트 반영

### PR Review

- `PrReviewAgentToolsService`와 `recommend_pr_review_focus` definition 추가
- `contextRequirement: { surface: "pr_review" }`, `executionMode: "contextual"` 선언
- `prepareExecution`에서 session, room, Workspace, 분석 상태 재검증
- 추천 후보 구성, 정렬, bounded serialization 구현
- PR Review Tool 테스트와 PR Review API 문서 반영

### Frontend

- `/pr-review?reviewSessionId=<uuid>`일 때 Agent requestContext를
  `{ surface: "pr_review", sessionId }`로 생성
- App Server와 AI Worker가 새 context를 배포한 뒤에만 Frontend 전송을 배포

## 오류와 기록 규칙

- `analyzing` session은 추천하지 않고 분석 완료 안내를 반환한다.
- `failed` session은 추천하지 않고 PR Review 분석 재시도 안내를 반환한다.
- 분석 완료 session에 추천할 파일이 없으면 빈 목록과 안전한 설명을 반환한다.
- Tool은 읽기 전용이므로 confirmation과 PR Review Activity Log를 만들지 않는다.
- 기존 `agent_runs`, `agent_steps`, Tool 실행 이력은 그대로 생성·보존한다.

## 배포 순서

1. DB migration, App Server, AI Worker를 배포해 `pr_review` requestContext를 수용한다.
2. Agent 공통부의 schema snapshot filtering과 실행 guard를 배포한다.
3. PR Review Tool을 등록한다.
4. 마지막으로 Frontend가 PR Review URL context를 전송하게 배포한다.

Frontend를 먼저 배포하면 구형 App Server 또는 Worker가 `pr_review` context를 거부할 수 있으므로,
1~3단계를 먼저 완료한다.

## 테스트

- `pr_review` context에서만 추천 Tool이 schema snapshot에 포함된다.
- null, `sql_erd` context에서는 추천 Tool이 snapshot과 실행 단계에서 모두 제외된다.
- context requirement가 없는 기존 Tool은 모든 context에서 계속 노출된다.
- 잘못된 UUID, 다른 Workspace의 session, room이 없는 session은 run 생성에서 거부된다.
- run 생성 뒤 session/room/Workspace가 유효하지 않으면 prepareExecution이 실행을 거부한다.
- DB check constraint와 Worker parser가 `pr_review` context를 보존한다.
- clientRequestId는 requestContext가 같을 때만 재사용되고 다르면 기존 conflict 규칙을 유지한다.
- analyzing, failed, 빈 분석 결과가 raw data 없이 안전한 안내를 반환한다.
- 추천 결과는 mustReview 3개, relatedFiles 2개 및 모든 문자열 경계를 초과하지 않는다.
- raw diff, 코드, patch, comment가 Tool input/output과 Agent run/step 저장값에 없음을 검증한다.

## 완료 기준

- PR Review session 화면에서만 Agent가 핵심 파일 추천 Tool을 선택할 수 있다.
- 추천은 현재 immutable revision의 저장된 분석 결과만 사용한다.
- 사용자는 꼭 확인할 파일 최대 3개와 관련 파일 최대 2개를 이유·review point와 함께 받는다.
- 다른 화면, 다른 Workspace, 분석 중·실패 session에서 잘못된 PR 데이터를 추천하지 않는다.
- 기존 global Agent Tool의 노출과 실행은 변경되지 않는다.
