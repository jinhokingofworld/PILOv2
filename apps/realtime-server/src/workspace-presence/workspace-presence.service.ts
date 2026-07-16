import type {
  WorkspacePresenceClearResult,
  WorkspacePresenceIdentity,
  WorkspacePresenceState,
  WorkspacePresenceUpdatePayload,
} from "./workspace-presence-types";

type StoredPresence = WorkspacePresenceState & {
  activitySequence: number;
  socketId: string;
};

export type WorkspacePresenceService = ReturnType<
  typeof createWorkspacePresenceService
>;

export function createWorkspacePresenceService({
  now = () => new Date(),
}: { now?: () => Date } = {}) {
  const presenceByWorkspace = new Map<string, Map<string, StoredPresence>>();
  let activitySequence = 0;

  function toPresenceState({
    activitySequence: _activitySequence,
    socketId: _socketId,
    ...presence
  }: StoredPresence): WorkspacePresenceState {
    return presence;
  }

  function getRepresentative(
    workspacePresence: Map<string, StoredPresence>,
    userId: string,
  ) {
    return [...workspacePresence.values()]
      .filter((presence) => presence.userId === userId)
      .sort((left, right) => {
        const leftRank = left.focused && left.visible ? 2 : left.visible ? 1 : 0;
        const rightRank = right.focused && right.visible ? 2 : right.visible ? 1 : 0;
        return (
          rightRank - leftRank ||
          Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt) ||
          right.activitySequence - left.activitySequence
        );
      })[0] ?? null;
  }

  function getOrCreateWorkspace(workspaceId: string) {
    let workspacePresence = presenceByWorkspace.get(workspaceId);
    if (!workspacePresence) {
      workspacePresence = new Map();
      presenceByWorkspace.set(workspaceId, workspacePresence);
    }
    return workspacePresence;
  }

  function getClearResult(
    workspaceId: string,
    workspacePresence: Map<string, StoredPresence>,
    removedPresence: StoredPresence,
  ): WorkspacePresenceClearResult {
    const replacement = getRepresentative(
      workspacePresence,
      removedPresence.userId,
    );
    return replacement
      ? { kind: "update", presence: toPresenceState(replacement) }
      : {
          kind: "leave",
          payload: { userId: removedPresence.userId, workspaceId },
        };
  }

  return {
    clearSocket(socketId: string) {
      const results: WorkspacePresenceClearResult[] = [];
      for (const [workspaceId, workspacePresence] of presenceByWorkspace) {
        const presence = workspacePresence.get(socketId);
        if (!presence) continue;
        workspacePresence.delete(socketId);
        results.push(getClearResult(workspaceId, workspacePresence, presence));
        if (workspacePresence.size === 0) {
          presenceByWorkspace.delete(workspaceId);
        }
      }
      return results;
    },
    getWorkspacePresence(workspaceId: string) {
      const workspacePresence = presenceByWorkspace.get(workspaceId);
      if (!workspacePresence) return [];

      const userIds = new Set(
        [...workspacePresence.values()].map((presence) => presence.userId),
      );
      return [...userIds]
        .map((userId) => getRepresentative(workspacePresence, userId))
        .filter((presence): presence is StoredPresence => Boolean(presence))
        .map(toPresenceState);
    },
    joinSocket(
      socketId: string,
      identity: WorkspacePresenceIdentity,
      workspaceId: string,
    ) {
      const state: StoredPresence = {
        activitySequence: ++activitySequence,
        displayName: identity.displayName,
        focused: false,
        lastActiveAt: now().toISOString(),
        location: null,
        socketId,
        userId: identity.userId,
        visible: false,
        workspaceId,
      };
      const workspacePresence = getOrCreateWorkspace(workspaceId);
      workspacePresence.set(socketId, state);
      const representative = getRepresentative(workspacePresence, state.userId);
      return toPresenceState(representative ?? state);
    },
    leaveSocket(socketId: string, workspaceId: string) {
      const workspacePresence = presenceByWorkspace.get(workspaceId);
      const presence = workspacePresence?.get(socketId);
      if (!workspacePresence || !presence) return null;

      workspacePresence.delete(socketId);
      const result = getClearResult(workspaceId, workspacePresence, presence);
      if (workspacePresence.size === 0) presenceByWorkspace.delete(workspaceId);
      return result;
    },
    updateSocket(socketId: string, payload: WorkspacePresenceUpdatePayload) {
      const workspacePresence = presenceByWorkspace.get(payload.workspaceId);
      const current = workspacePresence?.get(socketId);
      if (!workspacePresence || !current) return null;

      const isActive = payload.focused && payload.visible;
      const state: StoredPresence = {
        ...current,
        ...payload,
        ...(isActive
          ? {
              activitySequence: ++activitySequence,
              lastActiveAt: now().toISOString(),
            }
          : {}),
      };
      workspacePresence.set(socketId, state);
      const representative = getRepresentative(workspacePresence, state.userId);
      return representative ? toPresenceState(representative) : null;
    },
  };
}
