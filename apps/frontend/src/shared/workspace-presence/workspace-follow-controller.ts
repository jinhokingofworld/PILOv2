import type { WorkspacePresenceLocation } from "./workspace-presence-types";

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

const WORKSPACE_FOLLOW_SCROLL_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

export function isWorkspaceFollowManualKey(
  key: string,
  {
    isFollowTrigger,
    isNavigationTarget,
  }: { isFollowTrigger: boolean; isNavigationTarget: boolean },
) {
  if (key === "Enter") return !isFollowTrigger && isNavigationTarget;
  if (key === " " && isFollowTrigger) return false;
  return WORKSPACE_FOLLOW_SCROLL_KEYS.has(key);
}

export function isWorkspaceFollowManualPointer(
  kind: "down" | "move",
  {
    buttons,
    isFollowTrigger,
    isNavigationTarget,
  }: {
    buttons: number;
    isFollowTrigger: boolean;
    isNavigationTarget: boolean;
  },
) {
  if (isFollowTrigger) return false;
  return kind === "move" ? buttons !== 0 : isNavigationTarget;
}

export function createWorkspaceFollowSession({
  cancelFollow,
  controller = createWorkspaceFollowController(),
  jump,
  onFollowingUserIdChange,
}: {
  cancelFollow: () => void;
  controller?: ReturnType<typeof createWorkspaceFollowController>;
  jump: (
    location: WorkspacePresenceLocation,
    options: { source: "follow-start" },
  ) => Promise<boolean>;
  onFollowingUserIdChange: (userId: string | null) => void;
}) {
  const stop = (reason: WorkspaceFollowStopReason) => {
    controller.stop(reason);
    cancelFollow();
    onFollowingUserIdChange(null);
  };

  return {
    getState: controller.getState,
    stop,
    async toggle(
      userId: string,
      targetLocation: WorkspacePresenceLocation | null,
    ) {
      const followState = controller.getState();
      if (followState.status !== "idle" && followState.userId === userId) {
        stop("same-avatar");
        return false;
      }

      cancelFollow();
      onFollowingUserIdChange(null);
      if (!targetLocation) {
        controller.stop("restore-failed");
        return false;
      }

      const requestId = controller.start(userId);
      const restored = await jump(targetLocation, { source: "follow-start" });
      if (!restored) {
        const currentState = controller.getState();
        if (
          currentState.status === "starting" &&
          currentState.requestId === requestId
        ) {
          controller.stop("restore-failed");
        }
        return false;
      }
      if (!controller.confirm(requestId)) return false;

      onFollowingUserIdChange(userId);
      return true;
    },
  };
}
