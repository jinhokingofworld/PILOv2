"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SqlErdSourceLockPayload } from "@/features/sql-erd/api/client";

import { getSourceLockIntervalRequest } from "./source-lock-state";

export const SOURCE_LOCK_RENEW_INTERVAL_MS = 10_000;

export type SqlErdSourceLockState =
  | { status: "disabled" }
  | { status: "acquiring" }
  | { lease: SqlErdSourceLockPayload; status: "held" }
  | { message: string; status: "read_only" };

type SourceLockClient = {
  acquireSourceLock: (leaseId: string) => Promise<SqlErdSourceLockPayload>;
  releaseSourceLock: (leaseId: string) => Promise<unknown>;
  renewSourceLock: (leaseId: string) => Promise<SqlErdSourceLockPayload>;
};

function createLeaseId() {
  return crypto.randomUUID();
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "SQL source is read-only.";
}

export function useSqlErdSourceLock({
  active,
  client
}: {
  active: boolean;
  client: SourceLockClient;
}) {
  const [state, setState] = useState<SqlErdSourceLockState>({ status: "disabled" });
  const clientRef = useRef(client);
  const stateRef = useRef<SqlErdSourceLockState>(state);
  const leaseIdRef = useRef<string | null>(null);
  const heldLeaseIdRef = useRef<string | null>(null);

  const setLockState = useCallback((nextState: SqlErdSourceLockState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const acquire = useCallback(async () => {
    const leaseId = createLeaseId();
    leaseIdRef.current = leaseId;
    heldLeaseIdRef.current = null;
    setLockState({ status: "acquiring" });

    try {
      const lease = await clientRef.current.acquireSourceLock(leaseId);
      if (leaseIdRef.current !== leaseId) return;

      heldLeaseIdRef.current = leaseId;
      setLockState({ lease, status: "held" });
    } catch (error) {
      if (leaseIdRef.current !== leaseId) return;

      setLockState({ message: readErrorMessage(error), status: "read_only" });
    }
  }, [setLockState]);

  const renew = useCallback(async () => {
    const leaseId = heldLeaseIdRef.current;
    if (!leaseId) return;

    try {
      const lease = await clientRef.current.renewSourceLock(leaseId);
      if (heldLeaseIdRef.current === leaseId) {
        setLockState({ lease, status: "held" });
      }
    } catch (error) {
      if (heldLeaseIdRef.current !== leaseId) return;

      heldLeaseIdRef.current = null;
      setLockState({ message: readErrorMessage(error), status: "read_only" });
    }
  }, [setLockState]);

  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  useEffect(() => {
    if (!active) {
      leaseIdRef.current = null;
      heldLeaseIdRef.current = null;
      setLockState({ status: "disabled" });
      return;
    }

    let disposed = false;
    void acquire();

    const renewTimer = window.setInterval(() => {
      if (disposed) return;

      const request = getSourceLockIntervalRequest(stateRef.current.status);
      if (request === "acquire") {
        void acquire();
      } else if (request === "renew") {
        void renew();
      }
    }, SOURCE_LOCK_RENEW_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(renewTimer);
      const heldLeaseId = heldLeaseIdRef.current;
      leaseIdRef.current = null;
      heldLeaseIdRef.current = null;
      if (heldLeaseId) {
        void client.releaseSourceLock(heldLeaseId).catch(() => undefined);
      }
    };
  }, [active, acquire, client, renew, setLockState]);

  return useMemo(
    () => ({
      ...state,
      canEdit: state.status === "held",
      renew
    }),
    [renew, state]
  );
}
