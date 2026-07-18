export type WorkspaceFollowState =
  | { status: "idle" }
  | { requestId: number; status: "starting"; userId: string }
  | { status: "following"; userId: string };

export type WorkspaceFollowStopReason =
  | "manual-interaction"
  | "escape"
  | "same-avatar"
  | "target-left"
  | "restore-failed"
  | "workspace-changed";

export function createWorkspaceFollowController() {
  let requestSequence = 0;
  let state: WorkspaceFollowState = { status: "idle" };

  return {
    confirm(requestId: number) {
      if (state.status !== "starting" || state.requestId !== requestId) {
        return false;
      }
      state = { status: "following", userId: state.userId };
      return true;
    },
    getState() {
      return state;
    },
    start(userId: string) {
      const requestId = ++requestSequence;
      state = { requestId, status: "starting", userId };
      return requestId;
    },
    stop(_reason: WorkspaceFollowStopReason) {
      const userId = state.status === "idle" ? null : state.userId;
      requestSequence += 1;
      state = { status: "idle" };
      return userId;
    },
  };
}
