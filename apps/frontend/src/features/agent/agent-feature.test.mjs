import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readFeatureFile(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const [agentTypes, agentApiClient, agentConfirmationCard, agentChatWidget] =
  await Promise.all([
    readFeatureFile("./types.ts"),
    readFeatureFile("./api/client.ts"),
    readFeatureFile("./components/agent-confirmation-card.tsx"),
    readFeatureFile("./components/agent-chat-widget.tsx")
  ]);

assert.match(agentTypes, /export type AgentRunStatus/);
assert.match(agentTypes, /"planning"/);
assert.match(agentTypes, /"waiting_confirmation"/);
assert.match(agentTypes, /"completed"/);
assert.match(agentTypes, /export type AgentRun/);
assert.match(agentTypes, /export type CreateAgentRunInput/);
assert.match(agentTypes, /export type AgentRunDetailPayload/);
assert.match(agentTypes, /export type AgentConfirmationActionPayload/);

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
assert.match(agentApiClient, /approveConfirmation/);
assert.match(agentApiClient, /rejectConfirmation/);
assert.match(agentApiClient, /\/agent\/runs/);
assert.match(agentApiClient, /method: "POST"/);
assert.match(agentApiClient, /method: "GET"/);
assert.match(agentApiClient, /\/confirmations\/\$\{encodeURIComponent/);
assert.match(agentApiClient, /"approve"/);
assert.match(agentApiClient, /"reject"/);
assert.doesNotMatch(
  agentApiClient,
  /approveConfirmation[\s\S]*withJsonBody/,
  "approve confirmation should not send request body"
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
assert.match(agentConfirmationCard, /plan\.toolName/);
assert.match(agentConfirmationCard, /renderObjectSummary\(plan\.before\)/);
assert.match(agentConfirmationCard, /renderObjectSummary\(plan\.after\)/);
assert.match(agentConfirmationCard, /renderObjectSummary\(plan\.call\)/);
assert.doesNotMatch(agentConfirmationCard, /<input/);
assert.doesNotMatch(agentConfirmationCard, /<textarea/);

assert.match(agentChatWidget, /useAuthSession/);
assert.match(agentChatWidget, /activeWorkspaceId/);
assert.match(agentChatWidget, /createAgentApiClient/);
assert.match(agentChatWidget, /createRun/);
assert.match(agentChatWidget, /getRun/);
assert.match(agentChatWidget, /approveConfirmation/);
assert.match(agentChatWidget, /rejectConfirmation/);
assert.match(agentChatWidget, /AgentConfirmationCard/);
assert.match(agentChatWidget, /handleConfirmationAction/);
assert.match(agentChatWidget, /CONFIRMATION_EXPIRED/);
assert.match(agentChatWidget, /CONFIRMATION_NOT_PENDING/);
assert.match(agentChatWidget, /hasActiveAgentRequest/);
assert.match(
  agentChatWidget,
  /confirmationAction \|\|\s+isBusy \|\|\s+activeRunAbortControllerRef\.current !== null/
);
assert.match(agentChatWidget, /disabled=\{\s*!workspaceId[\s\S]*hasActiveAgentRequest/);
assert.match(agentChatWidget, /const canSend = draft\.trim\(\)\.length > 0 && !hasActiveAgentRequest/);
assert.match(agentChatWidget, /AGENT_RUN_POLL_INTERVAL_MS/);
assert.match(agentChatWidget, /waiting_confirmation/);
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
