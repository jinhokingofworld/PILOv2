"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createSqlErdSourceLockController,
  type SqlErdSourceLockClient,
  type SqlErdSourceLockState
} from "./source-lock-controller";

export const SOURCE_LOCK_RENEW_INTERVAL_MS = 10_000;

function createLeaseId() {
  return crypto.randomUUID();
}

export function useSqlErdSourceLock({
  active,
  client
}: {
  active: boolean;
  client: SqlErdSourceLockClient;
}) {
  const [state, setState] = useState<SqlErdSourceLockState>({ status: "disabled" });
  const controllerRef = useRef<ReturnType<typeof createSqlErdSourceLockController> | null>(
    null
  );

  const setLockState = useCallback((nextState: SqlErdSourceLockState) => {
    setState(nextState);
  }, []);

  const renew = useCallback(async () => {
    await controllerRef.current?.renew();
  }, []);

  useEffect(() => {
    const controller = createSqlErdSourceLockController({
      client,
      createLeaseId,
      onStateChange: setLockState
    });
    controllerRef.current = controller;

    if (!active) {
      void controller.stop();
      return () => {
        if (controllerRef.current === controller) controllerRef.current = null;
      };
    }

    void controller.start();
    const renewTimer = window.setInterval(() => {
      void controller.tick();
    }, SOURCE_LOCK_RENEW_INTERVAL_MS);

    return () => {
      window.clearInterval(renewTimer);
      void controller.stop();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [active, client, setLockState]);

  return useMemo(
    () => ({
      ...state,
      canEdit: state.status === "held",
      renew
    }),
    [renew, state]
  );
}
