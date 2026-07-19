import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  didAgentRunAcceptInput,
  getLatestAgentRunMessageSequence
} from "./run-input-recovery.ts";
import {
  presentCanvasAgentDelegationRunOnce,
  registerCanvasAgentDelegationAdapter
} from "./canvas-delegation-context.ts";
import { readAgentRequestContext } from "./request-context.ts";
import {
  getAgentResourceLinks,
  parseSqlErdAgentTableFocusResource
} from "./resource-links.ts";
import * as agentResourceUtilities from "./resource-links.ts";
import {
  consumeStagedSqlErdAgentTableFocus,
  createSqlErdModelFingerprint,
  getSqlErdFocusedRelationRole,
  getSqlErdFocusedTableRole,
  isSqlErdAgentTableFocusCurrent,
  isSqlErdShapeDimmedByTableFocus,
  stageSqlErdAgentTableFocus
} from "../sql-erd/utils/agent-table-focus.ts";

async function readFeatureFile(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const [
  agentTypes,
  agentApiClient,
  agentConfirmationCard,
  agentChatWidget,
  agentResourceLinks,
  agentCandidateSelections
] =
  await Promise.all([
    readFeatureFile("./types.ts"),
    readFeatureFile("./api/client.ts"),
    readFeatureFile("./components/agent-confirmation-card.tsx"),
    readFeatureFile("./components/agent-chat-widget.tsx"),
    readFeatureFile("./components/agent-resource-links.tsx"),
    readFeatureFile("./components/agent-candidate-selections.tsx")
  ]);

assert.match(agentTypes, /export type AgentRunStatus/);
assert.match(agentTypes, /"planning"/);
assert.match(agentTypes, /"waiting_user_input"/);
assert.match(agentTypes, /"waiting_confirmation"/);
assert.match(agentTypes, /"completed"/);
assert.match(agentTypes, /export type AgentRun/);
assert.match(agentTypes, /export type CreateAgentRunInput/);
assert.match(agentTypes, /export type SubmitAgentRunInput/);
assert.match(agentTypes, /kind: "sql_erd_session"/);
assert.match(agentTypes, /kind: "candidate"/);
assert.match(agentTypes, /selection\?: AgentRunInputSelection/);
assert.match(agentTypes, /export type AgentRunMessage/);
assert.match(agentTypes, /messages: AgentRunMessage\[\]/);
assert.match(agentTypes, /export type AgentRunDetailPayload/);
assert.match(agentTypes, /export type AgentConfirmationActionPayload/);
assert.match(agentTypes, /export type AgentRunRequestContext/);
assert.match(agentTypes, /surface: "canvas"/);
assert.match(agentTypes, /canvasContext/);
assert.match(agentTypes, /resourceId\?: string \| null/);
assert.match(agentTypes, /resourceType\?: string \| null/);
assert.match(agentTypes, /kind: "choice"/);
assert.match(agentTypes, /selectedChoiceId: string \| null/);

assert.match(agentApiClient, /createAgentApiClient/);
assert.match(agentApiClient, /AgentApiError/);
assert.match(agentApiClient, /\/api\/v1/);
assert.match(agentApiClient, /NEXT_PUBLIC_PILO_APP_SERVER_URL/);
assert.match(agentApiClient, /Authorization/);
assert.match(agentApiClient, /credentials: "same-origin"/);
assert.match(agentApiClient, /cache: "no-store"/);
assert.match(agentApiClient, /success === true/);
assert.match(agentApiClient, /createRun/);
assert.match(agentApiClient, /getRun/);

assert.doesNotMatch(agentChatWidget, /thread-run-recovery/);
assert.doesNotMatch(agentChatWidget, /sessionStorage/);
assert.match(agentApiClient, /submitRunInput/);
assert.match(agentApiClient, /agentRunInputsPath/);
assert.match(agentApiClient, /\/inputs/);
assert.match(agentApiClient, /approveConfirmation/);
assert.match(agentApiClient, /rejectConfirmation/);
assert.match(agentApiClient, /\/agent\/runs/);
assert.match(agentApiClient, /method: "POST"/);
assert.match(agentApiClient, /method: "GET"/);
assert.match(agentApiClient, /\/confirmations\/\$\{encodeURIComponent/);
assert.match(agentApiClient, /"approve"/);
assert.match(agentApiClient, /"reject"/);
assert.match(
  agentApiClient,
  /approveConfirmation[\s\S]*withJsonBody\(body/,
  "choice confirmation should send only the selected choice"
);
assert.doesNotMatch(
  agentApiClient,
  /rejectConfirmation[\s\S]*withJsonBody/,
  "reject confirmation should not send request body"
);

assert.match(agentConfirmationCard, /AgentConfirmationCard/);
assert.match(agentConfirmationCard, /confirmation\.status === "pending"/);
assert.match(agentConfirmationCard, /expiresAtMs <= nowMs/);
assert.match(agentConfirmationCard, /onApprove/);
assert.match(agentConfirmationCard, /onReject/);
assert.match(agentConfirmationCard, /plan\?\.summary/);
assert.match(agentConfirmationCard, /renderObjectSummary\(plan\.before\)/);
assert.match(agentConfirmationCard, /renderObjectSummary\(plan\.after\)/);
assert.match(agentConfirmationCard, /plan\.kind === "choice"/);
assert.match(agentConfirmationCard, /selectedChoiceId/);
assert.match(agentConfirmationCard, /aria-pressed/);
assert.match(agentConfirmationCard, /작업 대상/);
assert.match(agentConfirmationCard, /isInternalPlanKey/);
assert.match(agentConfirmationCard, /idempotencykey/);
assert.match(agentConfirmationCard, /plan\.target\.label/);
assert.match(agentConfirmationCard, /pending: "선택 대기"/);
assert.match(agentConfirmationCard, /approved: "승인됨"/);
assert.match(agentConfirmationCard, /rejected: "거절됨"/);
assert.match(agentConfirmationCard, /expired: "만료됨"/);
assert.doesNotMatch(agentConfirmationCard, /riskLevelLabels/);
assert.doesNotMatch(agentConfirmationCard, />Tool</);
assert.doesNotMatch(agentConfirmationCard, /실행 호출 정보/);
assert.doesNotMatch(agentConfirmationCard, /renderObjectSummary\(plan\.call\)/);
assert.doesNotMatch(agentConfirmationCard, /<input/);
assert.doesNotMatch(agentConfirmationCard, /<textarea/);

assert.match(agentChatWidget, /useAuthSession/);
assert.match(agentChatWidget, /activeWorkspaceId/);
assert.match(agentChatWidget, /createAgentApiClient/);
assert.match(agentChatWidget, /createRun/);
assert.match(agentChatWidget, /readAgentRequestContext/);
assert.match(agentChatWidget, /requestContext/);
assert.match(agentChatWidget, /getRun/);
assert.match(agentChatWidget, /approveConfirmation/);
assert.match(agentChatWidget, /rejectConfirmation/);
assert.match(agentChatWidget, /AgentConfirmationCard/);
assert.match(agentChatWidget, /AgentResourceLinks/);
assert.match(agentChatWidget, /AgentCandidateSelections/);
assert.match(agentChatWidget, /AgentCanvasArtifact/);
assert.match(agentChatWidget, /buildRequestContext\(isCanvasToolHelpMode\)/);
assert.match(agentChatWidget, /기능 설명/);
assert.match(agentChatWidget, /GroundedCitationList/);
assert.match(agentChatWidget, /getGroundedCitations/);
assert.match(agentChatWidget, /sourceType === "transcript"/);
assert.match(agentChatWidget, /회의 발언/);
assert.match(agentChatWidget, /실제 활동/);
assert.match(agentChatWidget, /citationSources/);
assert.match(agentChatWidget, /handleConfirmationAction/);
assert.match(agentChatWidget, /confirmationActionHandled/);
assert.match(agentChatWidget, /getConfirmationRefreshErrorMessage/);
assert.match(agentChatWidget, /getConfirmationOutcomeUnknownMessage/);
assert.match(agentChatWidget, /서버에서 처리되었습니다/);
assert.match(agentChatWidget, /서버에서 처리되었을 수 있으므로/);
assert.match(agentChatWidget, /choiceId/);
assert.match(agentChatWidget, /CONFIRMATION_EXPIRED/);
assert.match(agentChatWidget, /CONFIRMATION_NOT_PENDING/);
assert.match(agentChatWidget, /hasActiveAgentRequest/);
assert.match(
  agentChatWidget,
  /confirmationAction \|\|\s+isBusy \|\|\s+activeRunAbortControllerRef\.current !== null/
);
assert.match(
  agentChatWidget,
  /disabled=\{\s*!accessToken\?\.trim\(\) \|\| hasActiveAgentRequest/
);
assert.match(agentChatWidget, /const canSend = draft\.trim\(\)\.length > 0 && !hasActiveAgentRequest/);
assert.match(agentChatWidget, /AGENT_RUN_POLL_INTERVAL_MS/);
assert.match(agentChatWidget, /AGENT_PLANNING_POLL_TIMEOUT_MS = 270_000/);
assert.match(agentChatWidget, /createAgentPlanningPollingTimeoutError/);
assert.match(agentChatWidget, /currentRun\.status === "planning"/);
assert.match(agentChatWidget, /previousStatus !== "planning"/);
assert.match(agentChatWidget, /getActivePlannerStepId/);
assert.match(agentChatWidget, /nextActivePlannerStepId !== activePlannerStepId/);
assert.doesNotMatch(
  agentChatWidget,
  /forgetAgentRunId\(window\.sessionStorage, currentRun\.workspaceId\)/
);
assert.match(agentChatWidget, /waiting_confirmation/);
assert.match(agentChatWidget, /waiting_user_input/);
assert.match(agentChatWidget, /isRunAwaitingClarification/);
assert.match(
  agentChatWidget,
  /outputSummary\?\.status === "needs_clarification"/
);
assert.match(agentChatWidget, /submitRunInput/);
assert.match(agentChatWidget, /appendRunInput/);
assert.match(agentChatWidget, /displayMessage/);
assert.match(agentChatWidget, /\{ \.\.\.input, message: displayMessage \}/);
assert.match(agentChatWidget, /latestAssistantMessage/);
assert.match(agentChatWidget, /같은 요청을 이어서 처리합니다/);
assert.match(agentChatWidget, /enqueueMeetingConnectionAction/);
assert.match(agentChatWidget, /applyAgentSqlErdTableFocus/);
assert.match(agentChatWidget, /appliedSqlErdFocusActionKeysRef/);
assert.match(agentChatWidget, /clientAction/);
assert.match(agentChatWidget, /connect_meeting/);
assert.match(agentChatWidget, /router\.push\("\/meeting"\)/);
assert.match(agentChatWidget, /workspaceId: run\.workspaceId/);
assert.match(agentChatWidget, /currentRun\.workspaceId/);
assert.match(agentChatWidget, /submitRunInput\(\s*run\.workspaceId/);
assert.match(agentChatWidget, /getRun\(\s*run\.workspaceId/);
assert.match(agentChatWidget, /inputWasAccepted/);
assert.match(agentChatWidget, /refreshRun\.status !== "waiting_user_input"/);
assert.match(agentChatWidget, /completed/);
assert.match(agentChatWidget, /failed/);
assert.match(agentChatWidget, /cancelled/);
assert.match(agentChatWidget, /finalAnswer/);
assert.doesNotMatch(agentChatWidget, /run\.errorMessage/);
assert.match(
  agentChatWidget,
  /요청 처리 중 문제가 발생했습니다\. 잠시 후 다시 시도해주세요\./
);
assert.match(agentChatWidget, /Agent를 사용하려면 로그인과 워크스페이스 선택이 필요합니다/);
assert.match(agentChatWidget, /activeRunAbortControllerRef\.current/);
assert.match(agentChatWidget, /fixed inset-y-0 right-0/);
assert.match(agentChatWidget, /max-w-\[420px\]/);
assert.match(agentChatWidget, /오늘 일정 보기/);
assert.match(agentChatWidget, /prompt: "오늘 일정 보여줘"/);
assert.doesNotMatch(agentChatWidget, /내 이슈 확인/);
assert.doesNotMatch(agentChatWidget, /현재 PR 보기/);
assert.doesNotMatch(agentChatWidget, /prompt: "내 이슈 보여줘"/);
assert.doesNotMatch(agentChatWidget, /prompt: "현재 PR 보여줘"/);
assert.doesNotMatch(agentChatWidget, /Board 이슈 검색/);
assert.doesNotMatch(agentChatWidget, /label: "일정 생성"/);
assert.match(agentChatWidget, /handleDraftKeyDown/);
assert.match(agentChatWidget, /event\.key !== "Enter"/);
assert.match(agentChatWidget, /event\.shiftKey/);
assert.match(agentChatWidget, /event\.nativeEvent\.isComposing/);
assert.doesNotMatch(agentChatWidget, /createMockAssistantReply/);
assert.doesNotMatch(agentChatWidget, /Mockup/);

assert.match(agentResourceLinks, /getAgentResourceLinks/);
assert.match(agentResourceLinks, /<Link/);
assert.match(agentResourceLinks, /stageSqlErdAgentTableFocus/);
assert.match(agentResourceLinks, /link\.focus/);
assert.match(agentCandidateSelections, /getAgentCandidateSelections/);
assert.match(agentCandidateSelections, /disabled=\{disabled\}/);
assert.match(agentCandidateSelections, /candidate\.selection/);
assert.match(agentCandidateSelections, /다시 찾기/);
assert.equal(
  typeof agentResourceUtilities.getSqlErdSessionCandidates,
  "function",
  "waiting SQLtoERD clarification candidates need a validated parser"
);

const presentedCanvasRuns = [];
const unregisterCanvasDelegationAdapter = registerCanvasAgentDelegationAdapter({
  canvasId: "canvas-once",
  buildRequestContext: async () => null,
  presentRun: (run) => presentedCanvasRuns.push(run.id)
});
const delegatedCanvasRun = { id: "canvas-run-once" };

assert.equal(
  presentCanvasAgentDelegationRunOnce({
    canvasId: "canvas-once",
    run: delegatedCanvasRun,
    selectedScene: null
  }),
  true
);
assert.equal(
  presentCanvasAgentDelegationRunOnce({
    canvasId: "canvas-once",
    run: delegatedCanvasRun,
    selectedScene: null
  }),
  false,
  "remounting a completed Canvas artifact must not replay its client action"
);
assert.deepEqual(presentedCanvasRuns, ["canvas-run-once"]);
unregisterCanvasDelegationAdapter();

const previousMessages = [
  {
    id: "assistant-1",
    sequence: 1,
    role: "assistant",
    content: "몇 시인가요?",
    createdAt: "2026-07-16T00:00:00.000Z"
  }
];
const acceptedMessages = [
  ...previousMessages,
  {
    id: "user-2",
    sequence: 2,
    role: "user",
    content: "오후 3시",
    createdAt: "2026-07-16T00:00:01.000Z"
  },
  {
    id: "assistant-3",
    sequence: 3,
    role: "assistant",
    content: "종료 시간도 알려주세요.",
    createdAt: "2026-07-16T00:00:02.000Z"
  }
];

assert.equal(getLatestAgentRunMessageSequence(previousMessages), 1);
assert.equal(didAgentRunAcceptInput(acceptedMessages, 1, "오후 3시"), true);
assert.equal(didAgentRunAcceptInput(previousMessages, 1, "오후 3시"), false);

const sqlErdSessionId = "77777777-7777-4777-8777-777777777777";
const expectedSqlErdContext = {
  surface: "sql_erd",
  sessionId: sqlErdSessionId
};

assert.deepEqual(
  readAgentRequestContext(
    "/sql-erd/session",
    `sessionId=${sqlErdSessionId}`
  ),
  expectedSqlErdContext
);
assert.deepEqual(
  readAgentRequestContext(
    "/sql-erd/session/",
    `sessionId=${sqlErdSessionId}`
  ),
  expectedSqlErdContext
);
assert.equal(
  readAgentRequestContext(
    "/sql-erd/session/extra/",
    `sessionId=${sqlErdSessionId}`
  ),
  null
);
assert.equal(
  readAgentRequestContext("/sql-erd/session/", "sessionId=not-a-uuid"),
  null
);

const prReviewSessionId = "99999999-9999-4999-8999-999999999999";
const expectedPrReviewContext = {
  surface: "pr_review",
  sessionId: prReviewSessionId
};

assert.deepEqual(
  readAgentRequestContext("/pr-review", `reviewSessionId=${prReviewSessionId}`),
  expectedPrReviewContext
);
assert.equal(
  readAgentRequestContext(
    "/pr-review/rooms",
    `reviewSessionId=${prReviewSessionId}`
  ),
  null
);
assert.equal(
  readAgentRequestContext("/pr-review", "reviewSessionId=not-a-uuid"),
  null
);
assert.match(agentChatWidget, /z-\[70\]/);

const resourceSessionId = "88888888-8888-4888-8888-888888888888";
const candidateSessionId = "77777777-7777-4777-8777-777777777777";
const sqlErdCandidateRun = {
  status: "waiting_user_input",
  steps: [
    {
      id: "step-older",
      order: 1,
      type: "tool",
      status: "completed",
      toolName: "inspect_sql_erd_schema",
      outputSummary: {
        status: "needs_clarification",
        candidates: [
          {
            selectionToken: resourceSessionId,
            title: "이전 후보",
            updatedAt: "2026-07-15T00:00:00.000Z",
            tableCount: 1,
            relationCount: 0
          }
        ]
      },
      resourceRefs: []
    },
    {
      id: "step-latest",
      order: 2,
      type: "tool",
      status: "completed",
      toolName: "inspect_sql_erd_schema",
      outputSummary: {
        status: "needs_clarification",
        candidates: [
          {
            selectionToken: candidateSessionId,
            title: "  결제\n\tERD\u0000 ",
            updatedAt: "2026-07-17T00:00:00.000Z",
            tableCount: 4,
            relationCount: 3
          },
          {
            selectionToken: resourceSessionId,
            title: "결제 ERD",
            updatedAt: "2026-07-16T00:00:00.000Z",
            tableCount: 2,
            relationCount: 1
          }
        ]
      },
      resourceRefs: []
    }
  ]
};

assert.deepEqual(
  agentResourceUtilities.getSqlErdSessionCandidates(sqlErdCandidateRun),
  [
    {
      selectionToken: candidateSessionId,
      title: "결제 ERD",
      updatedAt: "2026-07-17T00:00:00.000Z",
      tableCount: 4,
      relationCount: 3
    },
    {
      selectionToken: resourceSessionId,
      title: "결제 ERD",
      updatedAt: "2026-07-16T00:00:00.000Z",
      tableCount: 2,
      relationCount: 1
    }
  ]
);
assert.deepEqual(agentResourceUtilities.getAgentCandidateSelections(sqlErdCandidateRun), [
  {
    key: `sql-erd:${candidateSessionId}`,
    label: "결제 ERD",
    description: "수정 2026-07-17T00:00:00.000Z · 테이블 4개 · 관계 3개",
    status: null,
    selection: {
      kind: "sql_erd_session",
      token: candidateSessionId
    }
  },
  {
    key: `sql-erd:${resourceSessionId}`,
    label: "결제 ERD",
    description: "수정 2026-07-16T00:00:00.000Z · 테이블 2개 · 관계 1개",
    status: null,
    selection: {
      kind: "sql_erd_session",
      token: resourceSessionId
    }
  }
]);
const meetingCandidateSelectionId = "99999999-9999-4999-8999-999999999999";
assert.deepEqual(
  agentResourceUtilities.getAgentCandidateSelections({
    status: "waiting_user_input",
    steps: [
      {
        id: "meeting-candidate-step",
        order: 1,
        type: "tool",
        status: "completed",
        toolName: "resolve_meeting_resource",
        outputSummary: {
          status: "needs_clarification",
          candidateSelections: [
            {
              candidateSelectionId: meetingCandidateSelectionId,
              resourceType: "meeting_report",
              label: "주간 개발 회의록",
              description: "2026년 7월 17일",
              status: "completed"
            }
          ]
        },
        resourceRefs: []
      }
    ]
  }),
  [
    {
      key: `candidate:${meetingCandidateSelectionId}`,
      label: "주간 개발 회의록",
      description: "2026년 7월 17일",
      status: "completed",
      selection: {
        kind: "candidate",
        candidateSelectionId: meetingCandidateSelectionId
      }
    }
  ]
);
const sqlCandidateSelectionId = "77777777-7777-4777-8777-777777777777";
assert.deepEqual(
  agentResourceUtilities.getAgentCandidateSelections({
    status: "waiting_user_input",
    steps: [
      {
        id: "sql-candidate-step",
        order: 1,
        type: "tool",
        status: "completed",
        toolName: "inspect_sql_erd_schema",
        outputSummary: {
          status: "needs_clarification",
          candidateSelections: [
            {
              candidateSelectionId: sqlCandidateSelectionId,
              resourceType: "session",
              label: "결제 ERD",
              description: "테이블 4개 · 관계 3개",
              status: null
            }
          ]
        },
        resourceRefs: []
      }
    ]
  }),
  [
    {
      key: `candidate:${sqlCandidateSelectionId}`,
      label: "결제 ERD",
      description: "테이블 4개 · 관계 3개",
      status: null,
      selection: {
        kind: "candidate",
        candidateSelectionId: sqlCandidateSelectionId
      }
    }
  ]
);
assert.deepEqual(
  agentResourceUtilities.getSqlErdSessionCandidates({
    ...sqlErdCandidateRun,
    status: "completed"
  }),
  []
);
assert.deepEqual(
  agentResourceUtilities.getSqlErdSessionCandidates({
    ...sqlErdCandidateRun,
    steps: [
      ...sqlErdCandidateRun.steps,
      {
        ...sqlErdCandidateRun.steps[1],
        id: "newer-calendar-step",
        order: 3,
        toolName: "list_calendar_events"
      }
    ]
  }),
  []
);
assert.deepEqual(
  agentResourceUtilities.getSqlErdSessionCandidates({
    ...sqlErdCandidateRun,
    steps: [
      {
        ...sqlErdCandidateRun.steps[1],
        outputSummary: {
          status: "needs_clarification",
          candidates: Array.from({ length: 6 }, (_, index) => ({
            selectionToken: `${index + 1}0000000-0000-4000-8000-000000000000`,
            title: `후보 ${index + 1}`,
            updatedAt: "2026-07-17T00:00:00.000Z",
            tableCount: 1,
            relationCount: 0
          }))
        }
      }
    ]
  }),
  []
);
assert.deepEqual(
  agentResourceUtilities.getSqlErdSessionCandidates({
    ...sqlErdCandidateRun,
    steps: [
      {
        ...sqlErdCandidateRun.steps[1],
        outputSummary: {
          status: "needs_clarification",
          candidates: [
            ...sqlErdCandidateRun.steps[1].outputSummary.candidates,
            {
              ...sqlErdCandidateRun.steps[1].outputSummary.candidates[0],
              title: "중복 token"
            }
          ]
        }
      }
    ]
  }),
  []
);
assert.deepEqual(
  agentResourceUtilities.getSqlErdSessionCandidates({
    ...sqlErdCandidateRun,
    steps: [
      {
        ...sqlErdCandidateRun.steps[1],
        outputSummary: {
          status: "needs_clarification",
          candidates: [
            sqlErdCandidateRun.steps[1].outputSummary.candidates[1],
            {
              selectionToken: "not-a-uuid",
              title: "잘못된 UUID",
              updatedAt: "2026-07-17T00:00:00.000Z",
              tableCount: 1,
              relationCount: 0
            },
            {
              selectionToken: candidateSessionId,
              title: "잘못된 날짜",
              updatedAt: "2026-02-30T00:00:00.000Z",
              tableCount: 1,
              relationCount: 0
            },
            {
              selectionToken: "99999999-9999-4999-8999-999999999999",
              title: "잘못된 개수",
              updatedAt: "2026-07-17T00:00:00.000Z",
              tableCount: -1,
              relationCount: 0
            },
            {
              selectionToken: "66666666-6666-4666-8666-666666666666",
              title: "\u0000\n\t",
              updatedAt: "2026-07-17T00:00:00.000Z",
              tableCount: 1,
              relationCount: 0
            }
          ]
        }
      }
    ]
  }),
  []
);
const validResourceRef = {
  domain: "sqltoerd",
  resourceType: "session",
  resourceId: resourceSessionId,
  label: "주문 관리",
  url: `/sql-erd/session?sessionId=${resourceSessionId}`
};
const completedRun = {
  id: "run-focus",
  status: "completed",
  steps: [
    {
      id: "step-1",
      status: "completed",
      resourceRefs: [validResourceRef, validResourceRef]
    }
  ]
};

const canvasResourceCanvasId = "44444444-4444-4444-8444-444444444444";
const canvasResourceRunId = "55555555-5555-4555-8555-555555555555";
const canvasResourceRef = {
  domain: "canvas",
  resourceType: "canvas_agent_run",
  resourceId: canvasResourceRunId,
  url: `/canvas?canvasId=${canvasResourceCanvasId}&canvasAgentRunId=${canvasResourceRunId}`,
  metadata: { canvasId: canvasResourceCanvasId }
};
assert.deepEqual(
  getAgentResourceLinks({
    status: "completed",
    steps: [
      {
        id: "canvas-step",
        status: "completed",
        outputSummary: {},
        resourceRefs: [canvasResourceRef]
      }
    ]
  }),
  [
    {
      href: canvasResourceRef.url,
      key: `canvas:agent-run:${canvasResourceRunId}`,
      label: "캔버스에서 열기"
    }
  ]
);
assert.deepEqual(
  getAgentResourceLinks({
    status: "completed",
    steps: [
      {
        id: "canvas-drive-step",
        status: "completed",
        outputSummary: { clientActionType: "insert_drive_file" },
        resourceRefs: [canvasResourceRef]
      }
    ]
  }),
  [
    {
      href: canvasResourceRef.url,
      key: `canvas:agent-run:${canvasResourceRunId}`,
      label: "캔버스에 추가하고 열기"
    }
  ]
);
assert.deepEqual(
  getAgentResourceLinks({
    status: "completed",
    steps: [
      {
        id: "canvas-unsafe-step",
        status: "completed",
        outputSummary: {},
        resourceRefs: [
          {
            ...canvasResourceRef,
            url: `/canvas?canvasId=${canvasResourceCanvasId}`
          }
        ]
      }
    ]
  }),
  []
);

assert.deepEqual(getAgentResourceLinks(completedRun), [
  {
    href: `/sql-erd/session?sessionId=${resourceSessionId}`,
    key: `sqltoerd:session:${resourceSessionId}`,
    label: "ERD 및 DDL 열기"
  }
]);

const meetingReportId = "77777777-7777-4777-8777-777777777771";
const relatedDocumentId = "88888888-8888-4888-8888-888888888881";
assert.deepEqual(
  getAgentResourceLinks({
    status: "completed",
    steps: [
      {
        id: "meeting-summary-step",
        status: "completed",
        outputSummary: {},
        resourceRefs: [
          {
            domain: "meeting",
            resourceType: "meeting_report",
            resourceId: meetingReportId,
            url: `/report?reportId=${meetingReportId}`,
          },
          {
            domain: "drive",
            resourceType: "document",
            resourceId: relatedDocumentId,
            label: "Async Processing Design",
            url: `/files?documentId=${relatedDocumentId}`,
          },
        ],
      },
    ],
  }),
  [
    {
      href: `/report?reportId=${meetingReportId}`,
      key: `meeting:report:${meetingReportId}`,
      label: "회의록 보기",
    },
    {
      href: `/files?documentId=${relatedDocumentId}`,
      key: `drive:document:${relatedDocumentId}`,
      label: "Async Processing Design 보기",
    },
  ],
);

for (const resourceRef of [
  {
    domain: "meeting",
    resourceType: "meeting_report",
    resourceId: meetingReportId,
    url: `/report?reportId=${meetingReportId}&extra=1`,
  },
  {
    domain: "meeting",
    resourceType: "meeting_report",
    resourceId: meetingReportId,
    url: `https://example.com/report?reportId=${meetingReportId}`,
  },
  {
    domain: "drive",
    resourceType: "document",
    resourceId: relatedDocumentId,
    label: "Async Processing Design",
    url: `/wrong?documentId=${relatedDocumentId}`,
  },
  {
    domain: "drive",
    resourceType: "document",
    resourceId: relatedDocumentId,
    label: "Async Processing Design",
    url: `\\files?documentId=${relatedDocumentId}`,
  },
]) {
  assert.deepEqual(
    getAgentResourceLinks({
      status: "completed",
      steps: [
        {
          id: "unsafe-resource-step",
          status: "completed",
          outputSummary: {},
          resourceRefs: [resourceRef],
        },
      ],
    }),
    [],
  );
}

const focusedResourceRef = {
  ...validResourceRef,
  status: "focused",
  metadata: {
    version: 1,
    view: "table_focus",
    sessionRevision: 7,
    modelFingerprint: createSqlErdModelFingerprint({
      version: 1,
      schema: { tables: [{ id: "table-orders" }], relations: [] }
    }),
    featureLabel: "결제 기능",
    primaryTableIds: ["table-orders", "table-payments"],
    relatedTableIds: ["table-payment-attempts"],
    relationIds: ["relation-orders-attempts", "relation-payments-attempts"],
    confidence: "medium"
  }
};
const expectedFocus = {
  version: 1,
  view: "table_focus",
  sessionId: resourceSessionId,
  sessionRevision: 7,
  modelFingerprint: createSqlErdModelFingerprint({
    version: 1,
    schema: { tables: [{ id: "table-orders" }], relations: [] }
  }),
  featureLabel: "결제 기능",
  primaryTableIds: ["table-orders", "table-payments"],
  relatedTableIds: ["table-payment-attempts"],
  relationIds: ["relation-orders-attempts", "relation-payments-attempts"],
  confidence: "medium"
};
assert.equal(
  createSqlErdModelFingerprint({
    schema: { relations: [], tables: [{ id: "table-orders" }] },
    version: 1
  }),
  "fnv1a32:276fb69c"
);

assert.deepEqual(
  parseSqlErdAgentTableFocusResource(focusedResourceRef),
  expectedFocus
);
assert.deepEqual(
  getAgentResourceLinks({
    ...completedRun,
    steps: [{ ...completedRun.steps[0], resourceRefs: [focusedResourceRef] }]
  }),
  [
    {
      focus: expectedFocus,
      href: `/sql-erd/session?sessionId=${resourceSessionId}`,
      key: `sqltoerd:session:${resourceSessionId}`,
      label: "집중 보기 열기"
    }
  ]
);

{
  const applyFocus = agentResourceUtilities.applyAgentSqlErdTableFocus;
  const appliedActionKeys = new Set();
  const appliedFocuses = [];
  const focusedRun = {
    ...completedRun,
    steps: [{ ...completedRun.steps[0], resourceRefs: [focusedResourceRef] }]
  };
  const result =
    typeof applyFocus === "function"
      ? {
          calls: [
            applyFocus(
              focusedRun,
              { surface: "sql_erd", sessionId: resourceSessionId },
              appliedActionKeys,
              (focus) => appliedFocuses.push(focus)
            ),
            applyFocus(
              focusedRun,
              { surface: "sql_erd", sessionId: resourceSessionId },
              appliedActionKeys,
              (focus) => appliedFocuses.push(focus)
            )
          ],
          appliedFocuses
        }
      : null;

  assert.deepEqual(result, {
    calls: [true, false],
    appliedFocuses: [expectedFocus]
  });
}

{
  const applyFocus = agentResourceUtilities.applyAgentSqlErdTableFocus;
  const appliedFocuses = [];
  const result =
    typeof applyFocus === "function"
      ? applyFocus(
          {
            ...completedRun,
            steps: [
              { ...completedRun.steps[0], resourceRefs: [focusedResourceRef] }
            ]
          },
          {
            surface: "sql_erd",
            sessionId: "99999999-9999-4999-8999-999999999999"
          },
          new Set(),
          (focus) => appliedFocuses.push(focus)
        )
      : null;

  assert.equal(result, false);
  assert.deepEqual(appliedFocuses, []);
}

{
  const appliedFocuses = [];
  const result = agentResourceUtilities.applyAgentSqlErdTableFocus(
    {
      ...completedRun,
      steps: [
        {
          ...completedRun.steps[0],
          resourceRefs: [{ ...focusedResourceRef, domain: "calendar" }]
        }
      ]
    },
    { surface: "sql_erd", sessionId: resourceSessionId },
    new Set(),
    (focus) => appliedFocuses.push(focus)
  );

  assert.equal(result, false);
  assert.deepEqual(appliedFocuses, []);
}
assert.deepEqual(
  getAgentResourceLinks({
    ...completedRun,
    steps: [
      {
        ...completedRun.steps[0],
        resourceRefs: [{ ...focusedResourceRef, status: "created" }]
      }
    ]
  }),
  [
    {
      href: `/sql-erd/session?sessionId=${resourceSessionId}`,
      key: `sqltoerd:session:${resourceSessionId}`,
      label: "ERD 및 DDL 열기"
    }
  ]
);

for (const invalidMetadata of [
  { ...focusedResourceRef.metadata, sessionRevision: 0 },
  { ...focusedResourceRef.metadata, primaryTableIds: [] },
  {
    ...focusedResourceRef.metadata,
    relatedTableIds: ["table-orders"]
  },
  { ...focusedResourceRef.metadata, confidence: "certain" },
  { ...focusedResourceRef.metadata, primaryTableIds: ["", "table-orders"] }
]) {
  assert.equal(
    parseSqlErdAgentTableFocusResource({
      ...focusedResourceRef,
      metadata: invalidMetadata
    }),
    null
  );
}

assert.equal(getSqlErdFocusedTableRole(expectedFocus, "table-orders"), "primary");
assert.equal(
  getSqlErdFocusedTableRole(expectedFocus, "table-payment-attempts"),
  "related"
);
assert.equal(getSqlErdFocusedTableRole(expectedFocus, "table-users"), "dimmed");
assert.equal(
  getSqlErdFocusedRelationRole(expectedFocus, "relation-orders-attempts"),
  "focused"
);
assert.equal(
  getSqlErdFocusedRelationRole(expectedFocus, "relation-users-orders"),
  "dimmed"
);
assert.equal(
  isSqlErdAgentTableFocusCurrent(expectedFocus, {
    sessionId: resourceSessionId,
    sessionRevision: 7,
    modelJson: {
      schema: { relations: [], tables: [{ id: "table-orders" }] },
      version: 1
    },
    revisionValidated: false
  }),
  true
);
assert.equal(
  isSqlErdAgentTableFocusCurrent(expectedFocus, {
    sessionId: resourceSessionId,
    sessionRevision: 8,
    modelJson: {
      schema: { relations: [], tables: [{ id: "table-orders" }] },
      version: 1
    },
    revisionValidated: false
  }),
  false
);
assert.equal(
  isSqlErdAgentTableFocusCurrent(expectedFocus, {
    sessionId: resourceSessionId,
    sessionRevision: 8,
    modelJson: {
      schema: { relations: [], tables: [{ id: "table-orders" }] },
      version: 1
    },
    revisionValidated: true
  }),
  true
);
assert.equal(
  isSqlErdAgentTableFocusCurrent(expectedFocus, {
    sessionId: resourceSessionId,
    sessionRevision: 8,
    modelJson: {
      schema: { relations: [], tables: [{ id: "table-payments" }] },
      version: 1
    },
    revisionValidated: true
  }),
  false
);
assert.equal(
  isSqlErdShapeDimmedByTableFocus(expectedFocus, {
    type: "sqltoerd_table",
    props: { tableId: "table-users" }
  }),
  true
);
assert.equal(
  isSqlErdShapeDimmedByTableFocus(expectedFocus, {
    type: "sqltoerd_table",
    props: { tableId: "table-orders" }
  }),
  false
);
assert.equal(
  isSqlErdShapeDimmedByTableFocus(expectedFocus, {
    type: "sqltoerd_relation",
    props: { relationId: "relation-users-orders" }
  }),
  true
);
assert.equal(
  isSqlErdShapeDimmedByTableFocus(expectedFocus, {
    type: "sqltoerd_note",
    props: { noteId: "note-1" }
  }),
  false
);

const stagedFocusStorage = new Map();
const stagedFocusEvents = [];
const previousCustomEvent = globalThis.CustomEvent;
const previousWindow = globalThis.window;
globalThis.CustomEvent = class {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};
globalThis.window = {
  dispatchEvent(event) {
    stagedFocusEvents.push(event);
  },
  sessionStorage: {
    getItem(key) {
      return stagedFocusStorage.get(key) ?? null;
    },
    removeItem(key) {
      stagedFocusStorage.delete(key);
    },
    setItem(key, value) {
      stagedFocusStorage.set(key, value);
    }
  }
};
stageSqlErdAgentTableFocus(expectedFocus);
assert.equal(stagedFocusStorage.size, 1);
assert.deepEqual(stagedFocusEvents[0].detail, expectedFocus);
assert.deepEqual(
  consumeStagedSqlErdAgentTableFocus(resourceSessionId),
  expectedFocus
);
assert.equal(stagedFocusStorage.size, 0);
assert.equal(consumeStagedSqlErdAgentTableFocus(resourceSessionId), null);
if (previousWindow === undefined) {
  delete globalThis.window;
} else {
  globalThis.window = previousWindow;
}
if (previousCustomEvent === undefined) {
  delete globalThis.CustomEvent;
} else {
  globalThis.CustomEvent = previousCustomEvent;
}
assert.deepEqual(
  getAgentResourceLinks({ ...completedRun, status: "running" }),
  []
);
assert.deepEqual(
  getAgentResourceLinks({
    ...completedRun,
    steps: [
      {
        ...completedRun.steps[0],
        status: "running"
      }
    ]
  }),
  []
);

for (const invalidUrl of [
  `https://evil.example/sql-erd/session?sessionId=${resourceSessionId}`,
  `//evil.example/sql-erd/session?sessionId=${resourceSessionId}`,
  `javascript:alert(1)`,
  `/sql-erd/session?sessionId=${resourceSessionId}#danger`,
  `/sql-erd/session?sessionId=${resourceSessionId}&next=https://evil.example`,
  `/sql-erd/session?sessionId=99999999-9999-4999-8999-999999999999`,
  `/sql-erd/other?sessionId=${resourceSessionId}`,
  `\\evil.example\sql-erd\session?sessionId=${resourceSessionId}`
]) {
  assert.deepEqual(
    getAgentResourceLinks({
      ...completedRun,
      steps: [
        {
          ...completedRun.steps[0],
          resourceRefs: [{ ...validResourceRef, url: invalidUrl }]
        }
      ]
    }),
    [],
    `unsafe SQLtoERD resource URL should be rejected: ${invalidUrl}`
  );
}

assert.deepEqual(
  getAgentResourceLinks({
    ...completedRun,
    steps: [
      {
        ...completedRun.steps[0],
        resourceRefs: [
          { ...validResourceRef, domain: "calendar" },
          { ...validResourceRef, resourceType: "table" },
          { ...validResourceRef, resourceId: "not-a-uuid" }
        ]
      }
    ]
  }),
  []
);
