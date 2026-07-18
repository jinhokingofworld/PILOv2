import type {
  WorkspaceLocationAdapter,
  WorkspaceLocationRestoreContext,
  WorkspacePresenceLocation,
  WorkspacePresencePage,
} from "./workspace-presence-types";

export const WORKSPACE_JUMP_ERROR_MESSAGE =
  "해당 팀원의 화면으로 이동할 수 없습니다";
const WORKSPACE_JUMP_TIMEOUT_MS = 8_000;
type WorkspaceJumpTimer = ReturnType<typeof globalThis.setTimeout>;

export type WorkspacePendingJump = {
  expiresAt: number;
  phase: "rollback" | "target";
  requestId: number;
  source: "follow-start" | "jump";
  sourceHref: string;
  sourceLocation: WorkspacePresenceLocation | null;
  targetLocation: WorkspacePresenceLocation;
};

export type WorkspacePendingFollow = {
  expiresAt: number;
  phase: "target";
  requestId: number;
  source: "follow";
  targetLocation: WorkspacePresenceLocation;
};

type WorkspacePendingLocation = WorkspacePendingFollow | WorkspacePendingJump;

export function toWorkspaceLocationHref(location: WorkspacePresenceLocation) {
  return `${location.route.pathname}${location.route.search}`;
}

function normalizeWorkspaceLocationHref(href: string) {
  const searchIndex = href.indexOf("?");
  const pathname = searchIndex === -1 ? href : href.slice(0, searchIndex);
  const search = searchIndex === -1 ? "" : href.slice(searchIndex);
  const normalizedPathname =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  return `${normalizedPathname}${search}`;
}

function areWorkspaceLocationHrefsEqual(left: string, right: string) {
  return (
    normalizeWorkspaceLocationHref(left) ===
    normalizeWorkspaceLocationHref(right)
  );
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
    async restore(
      location: WorkspacePresenceLocation,
      context: WorkspaceLocationRestoreContext,
    ) {
      const adapter = adapters.get(location.page);
      if (!adapter?.ready) return false;
      return adapter.restore(location, context);
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
  onFollowError = () => {},
  registry,
  rollback,
  setTimer = (callback, timeoutMs) => globalThis.setTimeout(callback, timeoutMs),
}: {
  clearTimer?: (timer: WorkspaceJumpTimer) => void;
  getCurrentHref: () => string;
  navigate: (href: string) => void | Promise<void>;
  now?: () => number;
  onError: (message: string) => void;
  onFollowError?: () => void;
  registry: WorkspaceLocationRegistry;
  rollback: (href: string) => void | Promise<void>;
  setTimer?: (
    callback: () => void,
    timeoutMs: number,
  ) => WorkspaceJumpTimer;
}) {
  let pending: WorkspacePendingLocation | null = null;
  let restoreController: AbortController | null = null;
  let timeout: WorkspaceJumpTimer | null = null;
  let requestSequence = 0;
  const followStartCompletions = new Map<
    number,
    (restored: boolean) => void
  >();
  const restoresInFlight = new Set<string>();

  function clearPending(restored = false) {
    const current = pending;
    if (timeout !== null) clearTimer(timeout);
    timeout = null;
    pending = null;
    if (current?.source === "follow-start") {
      followStartCompletions.get(current.requestId)?.(restored);
      followStartCompletions.delete(current.requestId);
    }
  }

  function abortRestore() {
    restoreController?.abort();
    restoreController = null;
  }

  function replacePending() {
    abortRestore();
    clearPending();
  }

  function isCurrentRequest(
    requestId: number,
    phase?: WorkspacePendingJump["phase"],
  ) {
    return Boolean(
      pending?.requestId === requestId &&
        (phase === undefined || pending.phase === phase),
    );
  }

  function finishWithError(requestId: number) {
    if (!isCurrentRequest(requestId) || pending?.source !== "jump") return;
    abortRestore();
    clearPending();
    onError(WORKSPACE_JUMP_ERROR_MESSAGE);
  }

  function finishFollowWithError(requestId: number) {
    if (!isCurrentRequest(requestId) || pending?.source !== "follow") return;
    abortRestore();
    clearPending();
    onFollowError();
  }

  function finishFollowStart(requestId: number) {
    if (!isCurrentRequest(requestId) || pending?.source !== "follow-start") {
      return;
    }
    abortRestore();
    clearPending();
  }

  function scheduleTimeout(
    requestId: number,
    phase: WorkspacePendingJump["phase"],
  ) {
    if (timeout !== null) clearTimer(timeout);
    timeout = setTimer(() => {
      if (pending?.source === "follow") {
        finishFollowWithError(requestId);
        return;
      }
      if (pending?.source === "follow-start") {
        finishFollowStart(requestId);
        return;
      }
      if (phase === "target") {
        return beginRollback(requestId);
      }
      finishWithError(requestId);
    }, WORKSPACE_JUMP_TIMEOUT_MS);
  }

  async function beginRollback(requestId: number) {
    if (
      !isCurrentRequest(requestId, "target") ||
      !pending ||
      pending.source !== "jump"
    ) {
      return false;
    }
    abortRestore();
    restoreController = new AbortController();
    pending = {
      ...pending,
      expiresAt: now() + WORKSPACE_JUMP_TIMEOUT_MS,
      phase: "rollback",
    };
    scheduleTimeout(requestId, "rollback");

    try {
      await rollback(pending.sourceHref);
    } catch {
      finishWithError(requestId);
      return false;
    }

    if (!isCurrentRequest(requestId, "rollback")) return false;
    await destinationReady();
    return false;
  }

  async function restorePending(
    requestId: number,
    phase: WorkspacePendingJump["phase"],
    location: WorkspacePresenceLocation,
  ) {
    const restoreKey = `${requestId}:${phase}`;
    if (restoresInFlight.has(restoreKey)) return false;

    const current = pending;
    const controller = restoreController;
    if (!current || current.requestId !== requestId || !controller) return false;
    restoresInFlight.add(restoreKey);

    let restored = false;
    try {
      restored = await registry.restore(location, {
        signal: controller.signal,
        source: current.source === "follow" ? "follow" : "jump",
      });
    } catch {
      restored = false;
    } finally {
      restoresInFlight.delete(restoreKey);
    }

    if (!isCurrentRequest(requestId, phase)) return false;
    if (phase === "rollback") {
      finishWithError(requestId);
      return false;
    }
    if (!restored) {
      if (current.source === "follow") {
        finishFollowWithError(requestId);
        return false;
      }
      if (current.source === "follow-start") {
        finishFollowStart(requestId);
        return false;
      }
      await beginRollback(requestId);
      return false;
    }

    restoreController = null;
    clearPending(true);
    return true;
  }

  async function destinationReady() {
    const current = pending;
    if (!current) return false;

    if (current.phase === "rollback") {
      if (!areWorkspaceLocationHrefsEqual(getCurrentHref(), current.sourceHref)) {
        return false;
      }
      if (!current.sourceLocation) {
        finishWithError(current.requestId);
        return false;
      }
      if (!registry.isReady(current.sourceLocation.page)) return false;
      return restorePending(
        current.requestId,
        "rollback",
        current.sourceLocation,
      );
    }

    if (
      !areWorkspaceLocationHrefsEqual(
        getCurrentHref(),
        toWorkspaceLocationHref(current.targetLocation),
      )
    ) {
      return false;
    }
    if (!registry.isReady(current.targetLocation.page)) return false;
    return restorePending(
      current.requestId,
      "target",
      current.targetLocation,
    );
  }

  return {
    cancelFollow() {
      if (!pending || pending.source === "jump") return;
      requestSequence += 1;
      replacePending();
    },
    destinationReady,
    getPending() {
      return pending;
    },
    async follow(targetLocation: WorkspacePresenceLocation) {
      replacePending();
      const requestId = ++requestSequence;
      const targetHref = toWorkspaceLocationHref(targetLocation);
      restoreController = new AbortController();
      pending = {
        expiresAt: now() + WORKSPACE_JUMP_TIMEOUT_MS,
        phase: "target",
        requestId,
        source: "follow",
        targetLocation,
      };
      scheduleTimeout(requestId, "target");

      if (areWorkspaceLocationHrefsEqual(getCurrentHref(), targetHref)) {
        return destinationReady();
      }

      try {
        await navigate(targetHref);
      } catch {
        finishFollowWithError(requestId);
        return false;
      }

      if (!isCurrentRequest(requestId)) return false;
      const restored = await destinationReady();
      return restored || isCurrentRequest(requestId);
    },
    async jump(
      targetLocation: WorkspacePresenceLocation,
      { source = "jump" }: { source?: "follow-start" | "jump" } = {},
    ) {
      replacePending();
      const requestId = ++requestSequence;
      const sourceHref = getCurrentHref();
      const sourceLocation = registry.capture();
      const targetHref = toWorkspaceLocationHref(targetLocation);
      const followStartCompletion =
        source === "follow-start"
          ? new Promise<boolean>((resolve) => {
              followStartCompletions.set(requestId, resolve);
            })
          : null;

      restoreController = new AbortController();
      pending = {
        expiresAt: now() + WORKSPACE_JUMP_TIMEOUT_MS,
        phase: "target",
        requestId,
        source,
        sourceHref,
        sourceLocation,
        targetLocation,
      };
      scheduleTimeout(requestId, "target");

      if (areWorkspaceLocationHrefsEqual(sourceHref, targetHref)) {
        return destinationReady();
      }

      try {
        await navigate(targetHref);
        if (source === "follow-start") {
          if (isCurrentRequest(requestId)) void destinationReady();
          return followStartCompletion ?? false;
        }
        return true;
      } catch {
        if (source === "follow-start") {
          finishFollowStart(requestId);
          return false;
        }
        await beginRollback(requestId);
        return false;
      }
    },
  };
}

export type WorkspaceJumpCoordinator = ReturnType<
  typeof createWorkspaceJumpCoordinator
>;
