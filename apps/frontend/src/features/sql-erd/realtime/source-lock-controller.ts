import type { SqlErdSourceLockPayload } from "@/features/sql-erd/api/client";

import { getSourceLockIntervalRequest } from "./source-lock-state";

export type SqlErdSourceLockState =
  | { status: "disabled" }
  | { status: "acquiring" }
  | { lease: SqlErdSourceLockPayload; status: "held" }
  | { message: string; status: "read_only" };

export type SqlErdSourceLockClient = {
  acquireSourceLock: (leaseId: string) => Promise<SqlErdSourceLockPayload>;
  releaseSourceLock: (leaseId: string) => Promise<unknown>;
  renewSourceLock: (leaseId: string) => Promise<SqlErdSourceLockPayload>;
};

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "SQL source is read-only.";
}

export function createSqlErdSourceLockController({
  client,
  createLeaseId,
  onStateChange = () => undefined
}: {
  client: SqlErdSourceLockClient;
  createLeaseId: () => string;
  onStateChange?: (state: SqlErdSourceLockState) => void;
}) {
  let active = false;
  let state: SqlErdSourceLockState = { status: "disabled" };
  let currentLeaseId: string | null = null;
  let heldLeaseId: string | null = null;

  function setState(nextState: SqlErdSourceLockState) {
    state = nextState;
    onStateChange(nextState);
  }

  async function acquire() {
    const leaseId = createLeaseId();
    currentLeaseId = leaseId;
    heldLeaseId = null;
    setState({ status: "acquiring" });

    try {
      const lease = await client.acquireSourceLock(leaseId);
      if (!active || currentLeaseId !== leaseId) {
        await client.releaseSourceLock(leaseId).catch(() => undefined);
        return;
      }

      heldLeaseId = leaseId;
      setState({ lease, status: "held" });
    } catch (error) {
      if (!active || currentLeaseId !== leaseId) return;

      setState({ message: readErrorMessage(error), status: "read_only" });
    }
  }

  async function renew() {
    const leaseId = heldLeaseId;
    if (!leaseId) return;

    try {
      const lease = await client.renewSourceLock(leaseId);
      if (!active || heldLeaseId !== leaseId) return;

      setState({ lease, status: "held" });
    } catch (error) {
      if (!active || heldLeaseId !== leaseId) return;

      heldLeaseId = null;
      setState({ message: readErrorMessage(error), status: "read_only" });
    }
  }

  return {
    getState: () => state,
    renew,
    start: async () => {
      active = true;
      await acquire();
    },
    stop: async () => {
      active = false;
      currentLeaseId = null;
      const leaseId = heldLeaseId;
      heldLeaseId = null;
      setState({ status: "disabled" });
      if (leaseId) await client.releaseSourceLock(leaseId).catch(() => undefined);
    },
    tick: async () => {
      if (!active) return;

      const request = getSourceLockIntervalRequest(state.status);
      if (request === "acquire") await acquire();
      if (request === "renew") await renew();
    }
  };
}
