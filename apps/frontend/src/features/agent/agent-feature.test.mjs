import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readFeatureFile(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const [agentTypes, agentApiClient, agentChatWidget] = await Promise.all([
  readFeatureFile("./types.ts"),
  readFeatureFile("./api/client.ts"),
  readFeatureFile("./components/agent-chat-widget.tsx")
]);

assert.match(agentTypes, /export type AgentRunStatus/);
assert.match(agentTypes, /"planning"/);
assert.match(agentTypes, /"waiting_confirmation"/);
assert.match(agentTypes, /"completed"/);
assert.match(agentTypes, /export type AgentRun/);
assert.match(agentTypes, /export type CreateAgentRunInput/);
assert.match(agentTypes, /export type AgentRunDetailPayload/);

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
assert.match(agentApiClient, /\/agent\/runs/);
assert.match(agentApiClient, /method: "POST"/);
assert.match(agentApiClient, /method: "GET"/);

assert.match(agentChatWidget, /useAuthSession/);
assert.match(agentChatWidget, /activeWorkspaceId/);
assert.match(agentChatWidget, /createAgentApiClient/);
assert.match(agentChatWidget, /createRun/);
assert.match(agentChatWidget, /getRun/);
assert.match(agentChatWidget, /AGENT_RUN_POLL_INTERVAL_MS/);
assert.match(agentChatWidget, /waiting_confirmation/);
assert.match(agentChatWidget, /completed/);
assert.match(agentChatWidget, /failed/);
assert.match(agentChatWidget, /cancelled/);
assert.match(agentChatWidget, /finalAnswer/);
assert.match(agentChatWidget, /errorMessage/);
assert.match(agentChatWidget, /Agent를 사용하려면 로그인과 워크스페이스 선택이 필요합니다/);
assert.match(agentChatWidget, /승인\/거절 UI는 다음 단계에서 연결됩니다/);
assert.match(agentChatWidget, /activeRunAbortControllerRef\.current/);
assert.doesNotMatch(agentChatWidget, /createMockAssistantReply/);
assert.doesNotMatch(agentChatWidget, /Mockup/);
