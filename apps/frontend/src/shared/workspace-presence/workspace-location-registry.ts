import type {
  WorkspaceLocationAdapter,
  WorkspacePresenceLocation,
  WorkspacePresencePage,
} from "./workspace-presence-types";

export const WORKSPACE_JUMP_ERROR_MESSAGE =
  "해당 팀원의 화면으로 이동할 수 없습니다";
const WORKSPACE_JUMP_TIMEOUT_MS = 8_000;
type WorkspaceJumpTimer = ReturnType<typeof globalThis.setTimeout>;

export type WorkspacePendingJump = {
  expiresAt: number;
  sourceHref: string;
  sourceLocation: WorkspacePresenceLocation | null;
  targetLocation: WorkspacePresenceLocation;
};

export function toWorkspaceLocationHref(location: WorkspacePresenceLocation) {
  return `${location.route.pathname}${location.route.search}`;
}

export function createWorkspaceLocationRegistry() {
  const adapters = new Map<WorkspacePresencePage, WorkspaceLocationAdapter>();
  let activePage: WorkspacePresencePage | null = null;

  return {
    capture() {
      if (!activePage) return null;
      const adapter = adapters.get(activePage);
      return adapter?.ready ? adapter.capture() : null;
    },
    isReady(page: WorkspacePresencePage) {
      return adapters.get(page)?.ready === true;
    },
    register(adapter: WorkspaceLocationAdapter) {
      adapters.set(adapter.page, adapter);
      activePage = adapter.page;
      return () => {
        if (adapters.get(adapter.page) === adapter) {
          adapters.delete(adapter.page);
          if (activePage === adapter.page) activePage = null;
        }
      };
    },
    async restore(location: WorkspacePresenceLocation) {
      const adapter = adapters.get(location.page);
      if (!adapter?.ready) return false;
      return adapter.restore(location);
    },
  };
}

export type WorkspaceLocationRegistry = ReturnType<
  typeof createWorkspaceLocationRegistry
>;

export function createWorkspaceJumpCoordinator({
  clearTimer = (timer) => globalThis.clearTimeout(timer),
  getCurrentHref,
  navigate,
  now = () => Date.now(),
  onError,
  registry,
  rollback,
  setTimer = (callback, timeoutMs) => globalThis.setTimeout(callback, timeoutMs),
}: {
  clearTimer?: (timer: WorkspaceJumpTimer) => void;
  getCurrentHref: () => string;
  navigate: (href: string) => void | Promise<void>;
  now?: () => number;
  onError: (message: string) => void;
  registry: WorkspaceLocationRegistry;
  rollback: (href: string) => void | Promise<void>;
  setTimer?: (
    callback: () => void,
    timeoutMs: number,
  ) => WorkspaceJumpTimer;
}) {
  let pending: WorkspacePendingJump | null = null;
  let timeout: WorkspaceJumpTimer | null = null;

  function clearPending() {
    if (timeout !== null) clearTimer(timeout);
    timeout = null;
    pending = null;
  }

  async function fail() {
    const failedJump = pending;
    clearPending();
    if (failedJump) await rollback(failedJump.sourceHref);
    onError(WORKSPACE_JUMP_ERROR_MESSAGE);
  }

  return {
    async destinationReady() {
      if (!pending) return false;
      if (getCurrentHref() !== toWorkspaceLocationHref(pending.targetLocation)) {
        return false;
      }
      if (!registry.isReady(pending.targetLocation.page)) return false;

      const restored = await registry.restore(pending.targetLocation);
      if (!restored) {
        await fail();
        return false;
      }
      clearPending();
      return true;
    },
    getPending() {
      return pending;
    },
    async jump(targetLocation: WorkspacePresenceLocation) {
      clearPending();
      const sourceHref = getCurrentHref();
      const sourceLocation = registry.capture();
      const targetHref = toWorkspaceLocationHref(targetLocation);

      if (sourceHref === targetHref) {
        const restored = await registry.restore(targetLocation);
        if (!restored) onError(WORKSPACE_JUMP_ERROR_MESSAGE);
        return restored;
      }

      pending = {
        expiresAt: now() + WORKSPACE_JUMP_TIMEOUT_MS,
        sourceHref,
        sourceLocation,
        targetLocation,
      };
      timeout = setTimer(() => {
        void fail();
      }, WORKSPACE_JUMP_TIMEOUT_MS);

      try {
        await navigate(targetHref);
        return true;
      } catch {
        await fail();
        return false;
      }
    },
  };
}

export type WorkspaceJumpCoordinator = ReturnType<
  typeof createWorkspaceJumpCoordinator
>;
