# PR Review Agent 핵심 파일 추천 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR Review 세션 화면에서만 Agent가 저장된 revision 분석 결과를 이용해 꼭 확인할 파일 최대 3개와 관련 파일 최대 2개를 추천한다.

**Architecture:** 기존 Agent `requestContext`/`contextual` execution foundation을 `pr_review` surface로 확장한다. Agent 공통부는 optional `contextRequirement` metadata로 Planner snapshot과 실행 전 surface guard를 처리하고, PR Review Tool은 검증된 session context로만 분석 결과를 읽어 서버에서 우선순위를 계산한다.

**Tech Stack:** NestJS, TypeScript, PostgreSQL migration, Python AI Worker, Next.js/React, Node assertion scripts.

## Global Constraints

- 새 Agent context foundation을 만들지 않는다. 기존 `requestContext`와 `agent_runs.request_context_json`을 사용한다.
- `requestContext`는 `{ surface: "sql_erd" | "pr_review", sessionId: UUID } | null`만 허용한다.
- URL의 session ID는 힌트다. App Server가 run 생성과 Tool `prepareExecution`에서 Workspace와 `pr_review_sessions -> pr_review_rooms.workspace_id` 소속을 검증한다.
- `contextRequirement`가 없는 Tool은 global Tool이며 모든 surface에서 기존처럼 노출한다.
- `recommend_pr_review_focus`만 `contextRequirement: { surface: "pr_review" }`와 `executionMode: "contextual"`을 선언한다.
- Tool input/output, Agent run/step에는 raw diff, 코드 원문, patch, 사용자 comment, token, provider raw payload를 넣지 않는다.
- Tool은 읽기 전용이다. confirmation과 PR Review Activity Log를 만들지 않는다. 기존 Agent run/step 이력은 유지한다.
- analyzing/failed revision은 추천하지 않고 각각 분석 완료/재시도 안내를 반환한다.
- DB/App Server/AI Worker가 새 context를 수용한 뒤 Frontend가 context를 전송한다.

---

## 파일 구조와 책임

| 파일 | 책임 |
| --- | --- |
| `db/migrations/093_add_pr_review_agent_request_context.sql` | `pr_review` requestContext DB check constraint 허용 |
| `apps/app-server/src/modules/agent/types/agent-tool.types.ts` | Agent surface/context requirement 타입 |
| `apps/app-server/src/modules/agent/agent.service.ts` | run 생성 requestContext parsing과 PR session/room Workspace 검증 |
| `apps/app-server/src/modules/agent/agent-tool-registry.service.ts` | context별 Tool 목록과 실행 가능한 Tool 조회 |
| `apps/app-server/src/modules/agent/agent-outbox-publisher.service.ts` | context-filtered schema snapshot 생성 |
| `apps/app-server/src/modules/agent/agent-execution.service.ts` | Tool 실행 직전 surface guard |
| `apps/ai-worker/app/agent_processor.py` | `pr_review` requestContext payload parsing |
| `apps/app-server/src/modules/pr-review/pr-review.service.ts` | comment/diff를 제외한 Agent focus projection 제공 |
| `apps/app-server/src/modules/agent/tools/pr-review-agent-tools.service.ts` | context 검증, 상태 안내, deterministic 추천/serialization |
| `apps/app-server/src/modules/agent/agent.module.ts` | PrReviewModule와 PR Review Tool provider 연결 |
| `apps/frontend/src/features/agent/request-context.ts` | PR Review URL을 requestContext로 변환 |
| `apps/frontend/src/features/agent/types.ts` | Frontend requestContext union |
| `apps/frontend/src/features/agent/components/agent-chat-widget.tsx` | Canvas 위에서도 기존 우측 하단 AI 진입점과 사이드 패널 유지 |
| `docs/api/agent-api.md`, `docs/api/pr-review-api.md` | 공통 Agent contract와 PR Tool 안전 경계 문서화 |

## Task 1: Agent requestContext에 PR Review surface를 추가한다

**Owner:** Agent 공통 담당

**Files:**

- Create: `db/migrations/093_add_pr_review_agent_request_context.sql`
- Modify: `apps/app-server/src/modules/agent/types/agent-tool.types.ts`
- Modify: `apps/app-server/src/modules/agent/agent.service.ts`
- Modify: `apps/ai-worker/app/agent_processor.py`
- Modify: `apps/ai-worker/tests/test_agent_processor.py`
- Modify: `apps/app-server/scripts/agent/run-api.test.mjs`
- Modify: `apps/app-server/scripts/agent/logging.test.mjs`
- Modify: `apps/app-server/scripts/agent/agent-job.test.mjs`
- Modify: `docs/api/agent-api.md`

**Consumes:** existing SQLtoERD `requestContext` persistence, outbox payload, and idempotency comparison.

**Produces:** a verified `{ surface: "pr_review", sessionId }` run context that can safely reach Agent Tool execution.

- [ ] **Step 1: Write migration and API-contract assertions first**

  Extend `run-api.test.mjs` to require migration `093` and to assert that the DB constraint accepts both surfaces but rejects extra keys or invalid UUIDs.

  ```js
  assert.match(migration, /request_context_json->>'surface' IN \('sql_erd', 'pr_review'\)/);
  assert.match(migration, /request_context_json - 'surface' - 'sessionId'\) = '\{\}'::jsonb/);
  ```

  Add run API cases for a valid PR Review context, a different Workspace session, and a same `clientRequestId` with a different `requestContext`.

- [ ] **Step 2: Run the focused contract test and observe the expected failure**

  Run: `node scripts/agent/run-api.test.mjs`

  Expected: FAIL because migration `093` and the `pr_review` parser branch do not exist.

- [ ] **Step 3: Add the migration and shared TypeScript context union**

  Create migration `093_add_pr_review_agent_request_context.sql`. Drop and recreate only
  `agent_runs_request_context_shape_check`; preserve the existing JSON object and 2 KiB checks.

  ```sql
  ALTER TABLE public.agent_runs
    DROP CONSTRAINT agent_runs_request_context_shape_check;

  ALTER TABLE public.agent_runs
    ADD CONSTRAINT agent_runs_request_context_shape_check
    CHECK (
      request_context_json IS NULL
      OR ((CASE
        WHEN jsonb_typeof(request_context_json) = 'object' THEN
          request_context_json ?& ARRAY['surface', 'sessionId']
          AND (request_context_json - 'surface' - 'sessionId') = '{}'::jsonb
          AND request_context_json->>'surface' IN ('sql_erd', 'pr_review')
          AND request_context_json->>'sessionId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ELSE FALSE
      END) IS TRUE)
    );
  ```

  In `agent-tool.types.ts`, introduce the reusable surface alias and union.

  ```ts
  export type AgentSurface = "sql_erd" | "pr_review";

  export type AgentRunRequestContext =
    | { surface: "sql_erd"; sessionId: string }
    | { surface: "pr_review"; sessionId: string }
    | null;
  ```

- [ ] **Step 4: Validate and revalidate PR Review context on the App Server**

  Make `readRequestContext` accept only exact two-key objects with either known surface and a UUID. Keep returning a normalized object, never the original request object.

  In `assertRequestContextAccess`, branch on `surface`. For PR Review use a server-side join through the room, not a client claim:

  ```sql
  SELECT review_session.id
  FROM pr_review_sessions AS review_session
  JOIN pr_review_rooms AS review_room
    ON review_room.id = review_session.room_id
  WHERE review_session.id = $1
    AND review_room.workspace_id = $2
  ```

  Return `404 Review session not found` when this query has no row. Keep the existing
  SQLtoERD validation branch unchanged.

- [ ] **Step 5: Extend the Worker parser without widening payload shape**

  In `_parse_request_context`, retain `set(value) == {"surface", "sessionId"}` and UUID validation.
  Accept only `surface in {"sql_erd", "pr_review"}`.

  ```py
  if surface not in {"sql_erd", "pr_review"} or not isinstance(session_id, str):
      raise ValueError("Invalid requestContext")
  return {"surface": surface, "sessionId": session_id}
  ```

  Add Worker tests that preserve a valid `pr_review` payload and reject unknown surfaces, extra keys, and invalid UUIDs.

- [ ] **Step 6: Make focused tests pass and run the complete Agent request-context suite**

  Run:

  ```powershell
  node scripts/agent/run-api.test.mjs
  node scripts/agent/logging.test.mjs
  node scripts/agent/agent-job.test.mjs
  python -m pytest apps/ai-worker/tests/test_agent_processor.py -q
  ```

  Expected: all commands exit 0; valid `pr_review` context survives run persistence and job serialization; cross-Workspace context is rejected.

- [ ] **Step 7: Document the public Agent request contract and commit**

  Update `docs/api/agent-api.md` with the two allowed context shapes, server-side session/room validation, context-aware idempotency, and the DB/App Server/Worker-before-Frontend rollout order.

  ```bash
  git add db/migrations/093_add_pr_review_agent_request_context.sql apps/app-server/src/modules/agent apps/ai-worker/app/agent_processor.py apps/ai-worker/tests/test_agent_processor.py apps/app-server/scripts/agent/run-api.test.mjs apps/app-server/scripts/agent/logging.test.mjs apps/app-server/scripts/agent/agent-job.test.mjs docs/api/agent-api.md
  git commit -m "feat(agent,db): PR Review request context 추가 (#1221)"
  ```

## Task 2: Tool metadata로 context별 Planner snapshot과 실행을 제한한다

**Owner:** Agent 공통 담당

**Files:**

- Modify: `apps/app-server/src/modules/agent/types/agent-tool.types.ts`
- Modify: `apps/app-server/src/modules/agent/agent-tool-registry.service.ts`
- Modify: `apps/app-server/src/modules/agent/agent-outbox-publisher.service.ts`
- Modify: `apps/app-server/src/modules/agent/agent-execution.service.ts`
- Modify: `apps/app-server/scripts/agent/agent-job.test.mjs`
- Modify: `apps/app-server/scripts/agent/execution.test.mjs`
- Modify: `docs/api/agent-api.md`

**Consumes:** Task 1 `AgentSurface` and verified `AgentRunRequestContext`.

**Produces:** a snapshot and execution guard that expose a restricted Tool only on its declared surface while preserving global Tool behavior.

- [ ] **Step 1: Write failing snapshot and execution-guard tests**

  Add a fake Tool definition with `contextRequirement: { surface: "pr_review" }`.
  Assert that it is present for a `pr_review` outbox claim and absent for null and `sql_erd` claims.
  Add execution tests where a handcrafted planner candidate names the restricted Tool from a null or SQLtoERD run; it must not execute the Tool.

- [ ] **Step 2: Run the focused tests and observe the expected failure**

  Run:

  ```powershell
  node scripts/agent/agent-job.test.mjs
  node scripts/agent/execution.test.mjs
  ```

  Expected: FAIL because the registry returns every definition and execution has no surface guard.

- [ ] **Step 3: Add generic, optional context metadata to Tool definitions**

  Add the following type; do not add Tool-name conditionals to any Agent common file.

  ```ts
  export type AgentToolContextRequirement = {
    surface: AgentSurface;
  };

  export interface AgentToolDefinition<TInput> {
    // existing fields
    contextRequirement?: AgentToolContextRequirement;
  }
  ```

  `undefined` means global availability. Existing Calendar, Meeting, Board, and SQLtoERD definitions must remain unchanged and therefore global.

- [ ] **Step 4: Filter registry definitions from validated context**

  Add `listDefinitionsForContext(requestContext)` and `getDefinitionForContext(name, requestContext)` to `AgentToolRegistryService`.

  ```ts
  private isAvailableForContext(
    definition: AgentToolDefinition<unknown>,
    requestContext: AgentRunRequestContext
  ): boolean {
    return !definition.contextRequirement ||
      definition.contextRequirement.surface === requestContext?.surface;
  }
  ```

  Keep `getDefinition(name)` only if existing callers require unrestricted lookup; all Planner snapshot and execution paths added in this task must use the context-aware methods.

- [ ] **Step 5: Apply the policy at both trust boundaries**

  Change `buildToolSchemaSnapshot` to accept the outbox claim's `request_context_json` and call `listDefinitionsForContext`.

  ```ts
  tools: this.buildToolSchemaSnapshot(claim.request_context_json)
  ```

  In `AgentExecutionService`, resolve the definition with the stored run context after loading it. If no context-eligible definition exists, fail the run with a safe `AGENT_TOOL_CONTEXT_UNAVAILABLE` error before input validation or Tool execution.

- [ ] **Step 6: Run focused tests and update the API contract**

  Run:

  ```powershell
  node scripts/agent/agent-job.test.mjs
  node scripts/agent/execution.test.mjs
  ```

  Expected: restricted definitions are absent from invalid snapshots and cannot execute if injected; unrestricted definitions remain available in every context.

  Document `contextRequirement` as server-only Tool metadata and distinguish snapshot filtering from the execution-time guard in `docs/api/agent-api.md`.

- [ ] **Step 7: Commit the context-aware Tool availability contract**

  ```bash
  git add apps/app-server/src/modules/agent/types/agent-tool.types.ts apps/app-server/src/modules/agent/agent-tool-registry.service.ts apps/app-server/src/modules/agent/agent-outbox-publisher.service.ts apps/app-server/src/modules/agent/agent-execution.service.ts apps/app-server/scripts/agent/agent-job.test.mjs apps/app-server/scripts/agent/execution.test.mjs docs/api/agent-api.md
  git commit -m "feat(agent): 화면 context별 Tool 노출 제한 (#1221)"
  ```

## Task 3: PR Review의 안전한 Agent focus projection을 만든다

**Owner:** PR Review 담당

**Files:**

- Modify: `apps/app-server/src/modules/pr-review/pr-review.service.ts`
- Modify: `apps/app-server/scripts/pr-review/decision-progress.test.mjs`

**Consumes:** verified Workspace/user/session identifiers from Agent Tool context.

**Produces:** one immutable revision의 분석 상태, safe file metadata, semantic relation만 반환하는 `getReviewSessionAgentFocusData` service method.

- [ ] **Step 1: Add a failing PR Review service test**

  Extend the existing PR Review service fake database test to cover a new public method:

  ```ts
  await service.getReviewSessionAgentFocusData(USER_ID, WORKSPACE_ID, SESSION_ID);
  ```

  Assert that the query joins `pr_review_sessions` to `pr_review_rooms` with
  `review_room.workspace_id = $2`, returns risk/role/summary/review points/current decision/relations, and does not expose comment, diff, patch, GitHub URL, or raw provider values.

- [ ] **Step 2: Run the focused test and observe the expected failure**

  Run: `node scripts/pr-review/decision-progress.test.mjs`

  Expected: FAIL because `getReviewSessionAgentFocusData` is not defined.

- [ ] **Step 3: Define a narrow Agent focus projection in PrReviewService**

  Add exported payload types adjacent to existing PR Review payloads.

  ```ts
  export interface PrReviewAgentFocusFilePayload {
    reviewFileId: string;
    filePath: string;
    roleType: PrReviewFileRoleType;
    riskLevel: PrReviewFileRiskLevel;
    changeSummary: string | null;
    reviewPoints: string[];
    currentStatus: PrReviewFileReviewStatus;
  }

  export interface PrReviewAgentFocusDataPayload {
    reviewSessionId: string;
    reviewRoomId: string;
    status: PrReviewSessionStatus;
    files: PrReviewAgentFocusFilePayload[];
    relations: Array<{
      fromReviewFileId: string;
      toReviewFileId: string;
      relationType: PrReviewRelationType;
    }>;
  }
  ```

  Implement `getReviewSessionAgentFocusData(currentUserId, workspaceId, reviewSessionId)` to:

  1. assert Workspace access;
  2. query the session through `pr_review_rooms.workspace_id`;
  3. read the immutable session's review files and flow relations;
  4. map flow-file relation endpoints back to review file IDs;
  5. return only the declared safe fields.

  Do not call `getReviewSessionCanvas`, because its fallback behavior and UI-shaped output are not a stable Agent data contract.

- [ ] **Step 4: Run the focused service test**

  Run: `node scripts/pr-review/decision-progress.test.mjs`

  Expected: PASS; a cross-Workspace session and a missing room are rejected, and comment/diff fields are absent from the projection.

- [ ] **Step 5: Commit the PR Review read projection**

  ```bash
  git add apps/app-server/src/modules/pr-review/pr-review.service.ts apps/app-server/scripts/pr-review/decision-progress.test.mjs
  git commit -m "feat(pr-review): Agent 추천용 분석 조회 추가 (#1221)"
  ```

## Task 4: 읽기 전용 PR Review 핵심 파일 추천 Tool을 구현한다

**Owner:** PR Review 담당

**Files:**

- Create: `apps/app-server/src/modules/agent/tools/pr-review-agent-tools.service.ts`
- Create: `apps/app-server/scripts/agent/pr-review-tools.test.mjs`
- Modify: `apps/app-server/src/modules/agent/agent.module.ts`
- Modify: `apps/app-server/src/modules/agent/agent-tool-registry.service.ts`
- Modify: `apps/app-server/package.json`

**Consumes:** Task 2 context-aware registry and Task 3 `getReviewSessionAgentFocusData`.

**Produces:** `recommend_pr_review_focus` with bounded, deterministic `mustReview` and `relatedFiles` output.

- [ ] **Step 1: Write failing Tool tests**

  Create `pr-review-tools.test.mjs` with fake `PrReviewService` data. Cover:

  - definition name, low risk, `executionMode: "contextual"`, and `contextRequirement: { surface: "pr_review" }`;
  - null and SQLtoERD contexts returning a clarification without calling PR Review;
  - analyzing and failed sessions returning safe guidance without a recommendation;
  - max 3 `mustReview`, max 2 non-duplicate `relatedFiles`;
  - focus filtering (`api`, `backend`, `frontend`, `test`);
  - high-risk/core/API/unreviewed candidates outranking approved low-risk support files;
  - string bounds and absence of comment/diff/patch fields.

- [ ] **Step 2: Run the focused test and observe the expected failure**

  Run: `node scripts/agent/pr-review-tools.test.mjs`

  Expected: FAIL because `PrReviewAgentToolsService` and the Tool definition do not exist.

- [ ] **Step 3: Implement strict input validation and contextual preparation**

  In `PrReviewAgentToolsService`, allow only an optional focus field.

  ```ts
  type RecommendPrReviewFocusInput = {
    focus: "api" | "backend" | "frontend" | "test" | null;
  };

  const FOCUS_ROLES = {
    api: ["api_contract"],
    backend: ["entry", "core_logic", "support"],
    frontend: ["ui_state"],
    test: ["verification"]
  } as const;
  ```

  Reject `workspaceId`, `userId`, `sessionId`, unknown keys, and invalid focus values. The Tool obtains the session ID only from `context.requestContext`.

  `prepareExecution` must return a `needs_clarification` result when surface is not `pr_review`; otherwise call the Task 3 projection method. Convert `analyzing` and `failed` to Korean safe guidance and return no files. This call revalidates session/room/Workspace immediately before execution.

- [ ] **Step 4: Implement deterministic selection and bounded serialization**

  Rank candidates in a server-side tuple; do not ask the LLM to invent a score.

  ```ts
  const decisionPriority = {
    discussion_needed: 0,
    unknown: 1,
    not_reviewed: 2,
    approved: 3
  } as const;

  const riskPriority = { high: 0, medium: 1, low: 2, unknown: 3 } as const;
  const rolePriority = { core_logic: 0, api_contract: 1, entry: 2, ui_state: 3, verification: 4, support: 5, unknown: 6 } as const;
  ```

  Sort by decision priority, risk priority, role priority, then direct relation count and stable file path. Select the first three matching files.

  From their `tests`, `uses_api`, and `passes_data_to` relations, select at most two distinct non-primary files as `relatedFiles`.

  Before returning, bound `filePath` to 400 chars, `changeSummary` to 300, each review point and reason to 160, and each list to three entries. Emit resource ref `{ domain: "pr_review", resourceType: "review_session", resourceId }` only.

- [ ] **Step 5: Register without adding a Tool-name special case**

  Import `PrReviewModule` into `AgentModule`, provide `PrReviewAgentToolsService`, and add it as an optional constructor dependency of `AgentToolRegistryService`.

  ```ts
  if (prReviewAgentToolsService) {
    this.registerMany(prReviewAgentToolsService.listDefinitions());
  }
  ```

  Append `node scripts/agent/pr-review-tools.test.mjs` to the App Server `test` script.

- [ ] **Step 6: Run focused Tool and Agent integration tests**

  Run:

  ```powershell
  node scripts/agent/pr-review-tools.test.mjs
  node scripts/agent/agent-job.test.mjs
  node scripts/agent/execution.test.mjs
  ```

  Expected: the Tool appears only in PR Review context snapshots, cannot execute elsewhere, and returns bounded safe output from a completed revision.

- [ ] **Step 7: Commit the Tool**

  ```bash
  git add apps/app-server/src/modules/agent/tools/pr-review-agent-tools.service.ts apps/app-server/src/modules/agent/agent.module.ts apps/app-server/src/modules/agent/agent-tool-registry.service.ts apps/app-server/scripts/agent/pr-review-tools.test.mjs apps/app-server/package.json
  git commit -m "feat(pr-review,agent): 핵심 파일 추천 Tool 추가 (#1221)"
  ```

## Task 5: PR Review 화면 context와 API 문서를 연결한다

**Owner:** PR Review 담당, Agent 공통 담당 review required

**Files:**

- Modify: `apps/frontend/src/features/agent/types.ts`
- Modify: `apps/frontend/src/features/agent/request-context.ts`
- Modify: `apps/frontend/src/features/agent/components/agent-chat-widget.tsx`
- Modify: `apps/frontend/src/features/agent/agent-feature.test.mjs`
- Modify: `docs/api/agent-api.md`
- Modify: `docs/api/pr-review-api.md`

**Consumes:** Task 1 accepted context shape and Task 4 Tool behavior.

**Produces:** only the PR Review URL sends a validated-shape context; API documents explain the read-only scope and rollout order.

- [ ] **Step 1: Add failing Frontend request-context tests**

  Extend `agent-feature.test.mjs` with cases for:

  ```ts
  readAgentRequestContext("/pr-review", "reviewSessionId=77777777-7777-4777-8777-777777777777")
  // => { surface: "pr_review", sessionId: "77777777-7777-4777-8777-777777777777" }

  readAgentRequestContext("/pr-review/rooms", "reviewSessionId=...")
  // => null
  ```

  Also assert invalid UUIDs and unrelated routes return null.

  Add a UI contract assertion that the existing floating trigger and side panel have a stacking level above
  `PrReviewCanvasShell`'s `z-[60]` layer. Do not add a PR Review-only duplicate trigger.

- [ ] **Step 2: Run the Frontend focused test and observe the expected failure**

  Run: `node --experimental-strip-types ./src/features/agent/agent-feature.test.mjs`

  Expected: FAIL until the parser recognizes `/pr-review` and the frontend union includes `pr_review`.

- [ ] **Step 3: Extend Frontend context parsing without trusting the URL**

  Add the same frontend union branch used by the App Server contract.

  ```ts
  export type AgentRunRequestContext =
    | { surface: "sql_erd"; sessionId: string }
    | { surface: "pr_review"; sessionId: string }
    | null;
  ```

  In `readAgentRequestContext`, recognize only normalized pathname `/pr-review`, read query parameter `reviewSessionId`, validate it with the existing UUID pattern, and return the normalized `pr_review` object. Keep `/pr-review/rooms` and all other routes context-free.

  The parser does not grant access; its output remains an App Server-validated hint.

- [ ] **Step 4: Keep the existing floating AI entry point above the PR Review Canvas**

  Raise the existing Agent widget trigger and side panel stacking levels above the Canvas fullscreen layer while
  preserving their current bottom-right placement, size, tooltip, and panel behavior. This is a shared visual-layer
  correction, not a second PR Review button. The widget continues to derive `pr_review` context from the current URL
  only after the user opens it and submits a message.

- [ ] **Step 5: Document PR Review Agent behavior and rollout**

  Add to `docs/api/pr-review-api.md`:

  - PR Review Agent focus recommendation is available only in a selected revision screen;
  - it returns at most three required files and two related files;
  - it uses stored analysis fields only and excludes raw diff/code/comment;
  - analyzing/failed revisions return guidance rather than a recommendation;
  - no file decision, Review submission, merge, confirmation, or Activity Log is created.

  In `docs/api/agent-api.md`, document optional context requirements and the required deployment order: DB/App Server/Worker, then Tool registration, then Frontend context transmission.

- [ ] **Step 6: Run Frontend and App Server focused tests**

  Run:

  ```powershell
  node --experimental-strip-types ./src/features/agent/agent-feature.test.mjs
  cd ..\app-server
  node scripts/agent/run-api.test.mjs
  node scripts/agent/pr-review-tools.test.mjs
  ```

  Expected: PR Review route emits only the correct context shape and App Server continues to reject invalid or cross-Workspace values.

- [ ] **Step 7: Commit the UI context and documents**

  ```bash
  git add apps/frontend/src/features/agent/types.ts apps/frontend/src/features/agent/request-context.ts apps/frontend/src/features/agent/components/agent-chat-widget.tsx apps/frontend/src/features/agent/agent-feature.test.mjs docs/api/agent-api.md docs/api/pr-review-api.md
  git commit -m "feat(pr-review,agent): PR Review 화면 context 연결 (#1221)"
  ```

## Task 6: 전체 회귀 검증과 배포 handoff를 완료한다

**Owner:** PR Review 담당, Agent 공통 담당 review required

**Files:**

- Modify only if verification exposes a concrete defect; otherwise no source change.

**Consumes:** Tasks 1–5.

**Produces:** verified release order and complete regression evidence.

- [ ] **Step 1: Run formatting, type checks, and full App Server suite**

  Run:

  ```powershell
  cd apps/app-server
  npm.cmd run format:check
  npm.cmd run lint
  npm.cmd test
  ```

  Expected: every command exits 0. Preserve expected fake-service warnings in test logs, but investigate any non-zero exit status.

- [ ] **Step 2: Run Worker and Frontend targeted regressions**

  Run:

  ```powershell
  python -m pytest apps/ai-worker/tests/test_agent_processor.py -q
  cd apps/frontend
  node --experimental-strip-types ./src/features/agent/agent-feature.test.mjs
  ```

  Expected: `pr_review` context parsing and Worker payload parsing pass without changing existing SQLtoERD behavior.

- [ ] **Step 3: Perform a manual API/UI smoke check in deployment order**

  Verify the following after DB/App Server/Worker deployment and before enabling the Frontend context sender:

  1. Create an Agent run with a valid PR Review session and verify only the PR focus Tool is added beyond global Tools.
  2. Create a null-context and SQLtoERD-context run and verify the PR focus Tool is absent.
  3. In a completed PR Review revision, ask “핵심만 골라줘” and verify three-or-fewer primary files plus two-or-fewer related files without raw code/comment.
  4. Repeat with analyzing and failed revisions and verify only safe completion/retry guidance.

- [ ] **Step 4: Commit only a concrete verification fix, otherwise record the handoff**

  If no source changed, do not create an empty commit. In the PR description, state the deployment order and call out Agent common and PR Review owners as reviewers.

## Final verification checklist

- [ ] `contextRequirement` is optional and global Tools stay global.
- [ ] No Agent common file compares `recommend_pr_review_focus` by name.
- [ ] The Tool cannot enter a non-PR Review snapshot or execution path.
- [ ] Both run creation and Tool preparation query session-to-room Workspace ownership.
- [ ] The Tool never reads or serializes raw diff/code/comment data.
- [ ] Current immutable revision status controls analyzing/failed guidance.
- [ ] Existing Agent run/step history remains intact.
