const AGENT_RUN_RECOVERY_PREFIX = "pilo:agent:run:";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AgentRunRecoveryStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function recoveryKey(workspaceId: string) {
  return `${AGENT_RUN_RECOVERY_PREFIX}${workspaceId}`;
}

export function readRecoverableAgentRunId(
  storage: AgentRunRecoveryStorage,
  workspaceId: string
) {
  if (!UUID_PATTERN.test(workspaceId)) return null;
  const runId = storage.getItem(recoveryKey(workspaceId));
  if (!runId || !UUID_PATTERN.test(runId)) {
    storage.removeItem(recoveryKey(workspaceId));
    return null;
  }
  return runId;
}

export function rememberAgentRunId(
  storage: AgentRunRecoveryStorage,
  workspaceId: string,
  runId: string
) {
  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(runId)) return;
  storage.setItem(recoveryKey(workspaceId), runId);
}

export function forgetAgentRunId(
  storage: AgentRunRecoveryStorage,
  workspaceId: string
) {
  if (!UUID_PATTERN.test(workspaceId)) return;
  storage.removeItem(recoveryKey(workspaceId));
}
