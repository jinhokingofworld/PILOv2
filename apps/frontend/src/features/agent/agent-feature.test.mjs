import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  didAgentRunAcceptInput,
  getLatestAgentRunMessageSequence
} from "./run-input-recovery.ts";
import { readAgentRequestContext } from "./request-context.ts";
import {
  getAgentResourceLinks,
  parseSqlErdAgentTableFocusResource
} from "./resource-links.ts";
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
  agentResourceLinks
] =
  await Promise.all([
    readFeatureFile("./types.ts"),
    readFeatureFile("./api/client.ts"),
    readFeatureFile("./components/agent-confirmation-card.tsx"),
    readFeatureFile("./components/agent-chat-widget.tsx"),
    readFeatureFile("./components/agent-resource-links.tsx")
  ]);

assert.match(agentTypes, /export type AgentRunStatus/);
assert.match(agentTypes, /"planning"/);
assert.match(agentTypes, /"waiting_user_input"/);
assert.match(agentTypes, /"waiting_confirmation"/);
assert.match(agentTypes, /"completed"/);
assert.match(agentTypes, /export type AgentRun/);
assert.match(agentTypes, /export type CreateAgentRunInput/);
assert.match(agentTypes, /export type SubmitAgentRunInput/);
assert.match(agentTypes, /export type AgentRunMessage/);
assert.match(agentTypes, /messages: AgentRunMessage\[\]/);
assert.match(agentTypes, /export type AgentRunDetailPayload/);
assert.match(agentTypes, /export type AgentConfirmationActionPayload/);
assert.match(agentTypes, /export type AgentRunRequestContext/);
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
assert.match(agentChatWidget, /GroundedCitationList/);
assert.match(agentChatWidget, /getGroundedCitations/);
assert.match(agentChatWidget, /sourceType === "transcript"/);
assert.match(agentChatWidget, /회의 발언/);
assert.match(agentChatWidget, /실제 활동/);
assert.match(agentChatWidget, /citationSources/);
assert.match(agentChatWidget, /handleConfirmationAction/);
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
assert.match(agentChatWidget, /waiting_confirmation/);
assert.match(agentChatWidget, /waiting_user_input/);
assert.match(agentChatWidget, /submitRunInput/);
assert.match(agentChatWidget, /appendRunInput/);
assert.match(agentChatWidget, /latestAssistantMessage/);
assert.match(agentChatWidget, /같은 요청을 이어서 처리합니다/);
assert.match(agentChatWidget, /enqueueMeetingConnectionAction/);
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
assert.match(agentChatWidget, /errorMessage/);
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

const resourceSessionId = "88888888-8888-4888-8888-888888888888";
const validResourceRef = {
  domain: "sqltoerd",
  resourceType: "session",
  resourceId: resourceSessionId,
  label: "주문 관리",
  url: `/sql-erd/session?sessionId=${resourceSessionId}`
};
const completedRun = {
  status: "completed",
  steps: [
    {
      id: "step-1",
      status: "completed",
      resourceRefs: [validResourceRef, validResourceRef]
    }
  ]
};

assert.deepEqual(getAgentResourceLinks(completedRun), [
  {
    href: `/sql-erd/session?sessionId=${resourceSessionId}`,
    key: `sqltoerd:session:${resourceSessionId}`,
    label: "ERD 및 DDL 열기"
  }
]);

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
