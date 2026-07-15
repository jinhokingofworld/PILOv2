import type { WorkspacePresenceState } from "./workspace-presence-types";

export type WorkspacePresenceReducerState = {
  onlineUsers: WorkspacePresenceState[];
};

export type WorkspacePresenceReducerAction =
  | { type: "joined"; presence: WorkspacePresenceState[] }
  | { type: "leave"; userId: string }
  | { type: "reset" }
  | { type: "update"; presence: WorkspacePresenceState };

export function createWorkspacePresenceState(): WorkspacePresenceReducerState {
  return { onlineUsers: [] };
}

export function reduceWorkspacePresence(
  state: WorkspacePresenceReducerState,
  action: WorkspacePresenceReducerAction,
  currentUserId: string | null,
): WorkspacePresenceReducerState {
  switch (action.type) {
    case "reset":
      return createWorkspacePresenceState();
    case "joined":
      return {
        onlineUsers: action.presence.filter(
          (presence) => presence.userId !== currentUserId,
        ),
      };
    case "update":
      if (action.presence.userId === currentUserId) return state;
      return {
        onlineUsers: [
          ...state.onlineUsers.filter(
            (presence) => presence.userId !== action.presence.userId,
          ),
          action.presence,
        ],
      };
    case "leave":
      return {
        onlineUsers: state.onlineUsers.filter(
          (presence) => presence.userId !== action.userId,
        ),
      };
  }
}
