"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createSqlErdRealtimeSocket,
  getSqlErdRealtimeServerUrl,
  type SqlErdRealtimeSocket
} from "./sql-erd-realtime-client";
import {
  bufferSqlErdOperation,
  catchUpSqlErdOperationPages,
  takeContiguousSqlErdOperations
} from "./operation-sync-state";
import type {
  SqlErdOperationPayload,
  SqlErdRealtimeConfig
} from "./sql-erd-realtime-types";

export type SqlErdOperationCatchupPayload = {
  items: SqlErdOperationPayload[];
  latestOpSeq: number;
  nextAfterSeq: number | null;
};

export type SqlErdOperationSyncState = {
  lastError: string | null;
  lastSeenOpSeq: number;
  latestOpSeq: number;
  status: "disabled" | "idle" | "catching_up" | "caught_up" | "failed";
};

type SqlErdOperationSyncOptions = {
  applyOperations: (operations: SqlErdOperationPayload[]) => Promise<void> | void;
  catchUpOperations: (
    afterSeq: number,
    signal?: AbortSignal
  ) => Promise<SqlErdOperationCatchupPayload>;
  initialLatestOpSeq: number;
  writeProtocol: "snapshot" | "operations_v1";
};

const disabledState: SqlErdOperationSyncState = {
  lastError: null,
  lastSeenOpSeq: 0,
  latestOpSeq: 0,
  status: "disabled"
};

function isUsableConfig(
  config: SqlErdRealtimeConfig | null | undefined
): config is SqlErdRealtimeConfig & {
  authToken: string;
  currentUser: NonNullable<SqlErdRealtimeConfig["currentUser"]>;
} {
  return Boolean(
    config?.enabled &&
      config.workspaceId.trim() &&
      config.sessionId.trim() &&
      config.authToken?.trim() &&
      config.currentUser?.userId.trim()
  );
}

function normalizeSequence(value: number) {
  return Math.max(0, Math.trunc(value));
}

function isSameRoom(
  payload: { sessionId: string; workspaceId: string },
  room: { sessionId: string; workspaceId: string }
) {
  return payload.sessionId === room.sessionId && payload.workspaceId === room.workspaceId;
}

export function useSqlErdOperationSync(
  config: SqlErdRealtimeConfig | null | undefined,
  {
    applyOperations,
    catchUpOperations,
    initialLatestOpSeq,
    writeProtocol
  }: SqlErdOperationSyncOptions
) {
  const [state, setState] = useState<SqlErdOperationSyncState>(disabledState);
  const socketRef = useRef<SqlErdRealtimeSocket | null>(null);
  const lastSeenOpSeqRef = useRef(0);
  const liveOperationBufferRef = useRef<SqlErdOperationPayload[]>([]);
  const activeCatchUpAbortRef = useRef<AbortController | null>(null);
  const applyOperationsRef = useRef(applyOperations);
  const catchUpOperationsRef = useRef(catchUpOperations);
  const runCatchUpRef = useRef<(afterSeq: number) => void>(() => {});
  const usableConfig = useMemo(
    () => (isUsableConfig(config) ? config : null),
    [
      config?.authToken,
      config?.currentUser?.displayName,
      config?.currentUser?.userId,
      config?.enabled,
      config?.sessionId,
      config?.workspaceId
    ]
  );
  const enabled = Boolean(
    usableConfig &&
      writeProtocol === "operations_v1" &&
      getSqlErdRealtimeServerUrl()
  );

  useEffect(() => {
    applyOperationsRef.current = applyOperations;
    catchUpOperationsRef.current = catchUpOperations;
  }, [applyOperations, catchUpOperations]);

  const setLastSeen = useCallback((nextSequence: number) => {
    const normalized = normalizeSequence(nextSequence);
    lastSeenOpSeqRef.current = normalized;
    setState((current) => ({
      ...current,
      lastError: null,
      lastSeenOpSeq: normalized,
      latestOpSeq: Math.max(current.latestOpSeq, normalized)
    }));
  }, []);

  const flushBufferedOperations = useCallback(async () => {
    const { operations, state: nextState } = takeContiguousSqlErdOperations({
      bufferedOperations: liveOperationBufferRef.current,
      lastSeenOpSeq: lastSeenOpSeqRef.current
    });
    if (!operations.length) return;

    await applyOperationsRef.current(operations);
    liveOperationBufferRef.current = nextState.bufferedOperations;
    setLastSeen(nextState.lastSeenOpSeq);
  }, [setLastSeen]);

  const runCatchUp = useCallback(
    (afterSeq: number) => {
      activeCatchUpAbortRef.current?.abort();
      const abortController = new AbortController();
      activeCatchUpAbortRef.current = abortController;
      const normalizedAfterSeq = normalizeSequence(afterSeq);
      setState((current) => ({
        ...current,
        lastError: null,
        status: "catching_up"
      }));

      void catchUpSqlErdOperationPages({
        afterSeq: normalizedAfterSeq,
        applyOperations: applyOperationsRef.current,
        fetchPage: (pageAfterSeq) =>
          catchUpOperationsRef.current(pageAfterSeq, abortController.signal)
      })
        .then(async (nextSeq) => {
          if (abortController.signal.aborted) return;

          lastSeenOpSeqRef.current = nextSeq;
          await flushBufferedOperations();

          if (abortController.signal.aborted) return;
          setState((current) => ({
            lastError: null,
            lastSeenOpSeq: lastSeenOpSeqRef.current,
            latestOpSeq: Math.max(current.latestOpSeq, nextSeq),
            status: "caught_up"
          }));

          if (liveOperationBufferRef.current.length) {
            runCatchUpRef.current(lastSeenOpSeqRef.current);
          }
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) return;
          setState((current) => ({
            ...current,
            lastError:
              error instanceof Error ? error.message : "SQLtoERD operation catch-up failed.",
            status: "failed"
          }));
        })
        .finally(() => {
          if (activeCatchUpAbortRef.current === abortController) {
            activeCatchUpAbortRef.current = null;
          }
        });
    },
    [flushBufferedOperations]
  );

  useEffect(() => {
    runCatchUpRef.current = runCatchUp;
  }, [runCatchUp]);

  const reconcileOperation = useCallback(
    (operation: SqlErdOperationPayload) => {
      const lastSeen = lastSeenOpSeqRef.current;
      if (operation.opSeq <= lastSeen) return;

      setState((current) => ({
        ...current,
        latestOpSeq: Math.max(current.latestOpSeq, operation.opSeq)
      }));
      const nextBufferState = bufferSqlErdOperation(
        {
          bufferedOperations: liveOperationBufferRef.current,
          lastSeenOpSeq: lastSeen
        },
        operation
      );
      liveOperationBufferRef.current = nextBufferState.bufferedOperations;

      if (activeCatchUpAbortRef.current || operation.opSeq > lastSeen + 1) {
        if (!activeCatchUpAbortRef.current) runCatchUp(lastSeen);
        return;
      }

      void flushBufferedOperations().catch(() => runCatchUp(lastSeen));
    },
    [flushBufferedOperations, runCatchUp]
  );

  useEffect(() => {
    activeCatchUpAbortRef.current?.abort();
    activeCatchUpAbortRef.current = null;
    liveOperationBufferRef.current = [];
    lastSeenOpSeqRef.current = normalizeSequence(initialLatestOpSeq);

    if (!enabled || !usableConfig) {
      setState(disabledState);
      socketRef.current = null;
      return;
    }

    setState({
      lastError: null,
      lastSeenOpSeq: lastSeenOpSeqRef.current,
      latestOpSeq: lastSeenOpSeqRef.current,
      status: "idle"
    });
    const socket = createSqlErdRealtimeSocket({
      authToken: usableConfig.authToken,
      currentUser: usableConfig.currentUser
    });
    if (!socket) return;

    const room = { sessionId: usableConfig.sessionId, workspaceId: usableConfig.workspaceId };
    socketRef.current = socket;
    socket.on("connect", () => socket.emit("sql-erd:join", room));
    socket.on("sql-erd:joined", (payload) => {
      if (!isSameRoom(payload, room)) return;
      setState((current) => ({
        ...current,
        latestOpSeq: Math.max(current.latestOpSeq, payload.latestOpSeq)
      }));
      if (payload.latestOpSeq > lastSeenOpSeqRef.current) {
        runCatchUp(lastSeenOpSeqRef.current);
      }
    });
    socket.on("sql-erd:operation", (operation) => {
      if (isSameRoom(operation, room)) reconcileOperation(operation);
    });
    socket.on("sql-erd:error", (error) => {
      setState((current) => ({ ...current, lastError: error.message }));
    });
    socket.connect();

    return () => {
      activeCatchUpAbortRef.current?.abort();
      activeCatchUpAbortRef.current = null;
      if (socket.connected) socket.emit("sql-erd:leave", room);
      socket.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [enabled, initialLatestOpSeq, reconcileOperation, runCatchUp, usableConfig]);

  return useMemo(
    () => ({ enabled, ...state }),
    [enabled, state]
  );
}
