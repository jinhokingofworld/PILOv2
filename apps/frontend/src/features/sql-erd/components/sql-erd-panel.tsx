"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from "@codemirror/view";
import {
  Database,
  Home,
  List as ListIcon,
  LocateFixed,
  MapPin,
  Redo2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PinOff,
  Undo2
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { useAuthSession } from "@/features/auth/auth-session";
import { isDevPreviewAccessToken } from "@/features/auth/session-storage";
import {
  createSqlErdApiClient,
  SqlErdApiError
} from "@/features/sql-erd/api/client";
import { SqlErdCanvas } from "@/features/sql-erd/components/sql-erd-canvas";
import type {
  SqlErdOperationPayload,
  SqlErdRealtimeConfig
} from "@/features/sql-erd/realtime/sql-erd-realtime-types";
import { useSqlErdOperationSync } from "@/features/sql-erd/realtime/use-sql-erd-operation-sync";
import { useSqlErdSourceLock } from "@/features/sql-erd/realtime/use-sql-erd-source-lock";
import { applySqlErdOperationLayoutPatch } from "@/features/sql-erd/utils/operation-layout";
import { createSqlErdOperationLayoutPatch } from "@/features/sql-erd/utils/operation-patch";
import {
  consumeStagedSqlErdAgentTableFocus,
  isSqlErdAgentTableFocusCurrent,
  parseSqlErdAgentTableFocusValue,
  SQL_ERD_AGENT_TABLE_FOCUS_EVENT,
  type SqlErdAgentTableFocus
} from "@/features/sql-erd/utils/agent-table-focus";
import type {
  SqlErdSelection,
  SqltoerdDialect,
  SqltoerdLayoutJsonV1,
  SqltoerdLayoutPatch,
  SqltoerdModelJsonV1,
  SqltoerdResolvedDialect,
  SqltoerdSessionPayload
} from "@/features/sql-erd/types";
import {
  completeSqlErdAutosave,
  createWorkspaceSqlErdViewSession,
  getLayoutAutosaveBlockReasonForApiError,
  getLayoutAutosaveDelayMs,
  getLayoutAutosavePausedBanner,
  getSqlErdSessionLoadFailureState,
  isSqlErdAutosaveRequestCurrent,
  isLayoutAutosaveTransientStatus,
  shouldApplySqlErdSessionLoadResult,
  tryBeginSqlErdAutosave,
  type LayoutAutosaveBlockReason,
  type LayoutAutosavePausedBannerViewModel,
  type SqlErdAutosaveGateState,
  type SqlErdSessionLoadState,
  type SqlErdViewSession
} from "@/features/sql-erd/utils/session-state";
import {
  createSqlErdInspectorViewModel,
  formatSqlErdRelationEndpoint,
  type RelationSummary,
  type SqlErdInspectorViewModel
} from "@/features/sql-erd/utils/inspector";
import { isSqlErdSourceTextTooLarge } from "@/features/sql-erd/utils/ddl-parser";
import {
  createSqlErdAnnotationForeignKeyConversionCandidate,
  createSqlErdForeignKeyAddCandidate,
  createSqlErdForeignKeyDeleteCandidate,
  createSqlErdForeignKeyUpdateCandidate,
  getSqltoerdForeignKeyTargetColumns,
  type SqltoerdAnnotationForeignKeyConversionFailureReason,
  type SqltoerdAnnotationForeignKeyConversionResult,
  type SqltoerdAnnotationLabelDisposition,
  type SqltoerdForeignKeyAddResult,
  type SqltoerdForeignKeyAddFailureReason,
  type SqltoerdForeignKeyEditFailureReason,
  type SqltoerdForeignKeyEditResult
} from "@/features/sql-erd/utils/foreign-key-add";
import {
  areSqltoerdLayoutsEqual,
  createSqltoerdModelIndex,
  getSqltoerdModelCounts,
  getTableDisplayName,
  type SqlErdRelationCardinality,
  type SqlErdRelationCardinalityEndpoints
} from "@/features/sql-erd/utils/model";
import {
  clearSqlErdTablePin,
  createSqlErdTablePinState,
  pinSqlErdTable
} from "@/features/sql-erd/utils/table-pin";
import {
  createSqlErdParseWorkerCancellation,
  ParseWorkerRequest,
  ParseWorkerResponse
} from "@/features/sql-erd/utils/parse-worker-protocol";
import {
  createSqlErdLayoutAutosaveRequest,
  createSqlErdSourceAutosaveRequest
} from "@/features/sql-erd/utils/layout-autosave";
import {
  beginSqlErdParse,
  createSqlErdEditState,
  isSqlErdDraftDirty,
  isSqlErdParseRequestCurrent,
  reduceSqlErdEditState,
  shouldScheduleSqlErdAutoParse,
  SQL_ERD_AUTO_PARSE_DEBOUNCE_MS,
  type SqlErdEditAction
} from "@/features/sql-erd/utils/sql-edit-state";
import {
  getSqlErdSourceStatus,
  getSqlErdWorkspaceSaveErrorState
} from "@/features/sql-erd/utils/status-copy";
import type { SqlErdSourceAutosaveState } from "@/features/sql-erd/utils/status-copy";
import {
  createSqlSourceEditorDialectReconfigureEffect,
  getSqlSourceEditorLanguageExtension,
  resolveSqlSourceEditorDialect
} from "@/features/sql-erd/utils/sql-editor-dialect";
import { createSqlErdRelationSourceDecorationExtension } from "@/features/sql-erd/utils/sql-source-decoration";
import {
  getSelectedSqlErdRelationSourceRanges,
  type SqltoerdSourceMap,
  type SqltoerdSourceRange
} from "@/features/sql-erd/utils/sql-source-map";
import {
  createSqlErdModelSqlHistory,
  createSqlErdNormalizedSqlPreview,
  createSqlErdSqlLineDiff,
  isSqlErdNormalizedSqlPreviewCurrent,
  isSqlErdViewSessionCurrent,
  recordSqlErdModelSqlHistory,
  redoSqlErdModelSqlHistory,
  undoSqlErdModelSqlHistory,
  type SqlErdModelSqlHistory,
  type SqlErdNormalizedSqlPreview
} from "@/features/sql-erd/utils/sql-diff-apply";
import { cn } from "@/lib/utils";

const emptySqlErdViewSession: SqlErdViewSession = {
  id: null,
  latestOpSeq: 0,
  revision: null,
  title: "Untitled ERD",
  writeProtocol: "snapshot",
  sourceFormat: "sql",
  dialect: "auto",
  sourceText: "",
  modelJson: {
    version: 1,
    schema: {
      tables: [],
      relations: []
    }
  },
  layoutJson: {
    version: 1,
    tableLayouts: []
  },
  settingsJson: {}
};

const SOURCE_PANEL_MIN_WIDTH = 280;
const SOURCE_PANEL_DEFAULT_WIDTH = 360;
const SOURCE_PANEL_MAX_WIDTH = 560;
const INSPECTOR_PANEL_MIN_WIDTH = 320;
const INSPECTOR_PANEL_DEFAULT_WIDTH = 400;
const INSPECTOR_PANEL_MAX_WIDTH = 560;
const MIN_CANVAS_WIDTH = 480;
const PANEL_RESIZE_HANDLE_WIDTH = 4;
const COLLAPSED_PANEL_BUTTON_WIDTH = 48;
const PANEL_RESIZE_KEYBOARD_STEP = 24;
const SQL_ERD_PARSE_TIMEOUT_MS = 5000;

type PendingSqlErdLayoutOperation = {
  clientOperationId: string;
  patch: Record<string, unknown>;
  sessionId: string;
};

type SqlErdParseWorkerController = {
  terminate: () => void;
};

const sqlSourceEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#0f172a",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "13px",
    height: "100%"
  },
  ".cm-scroller": {
    lineHeight: "1.65",
    overflow: "auto"
  },
  ".cm-content": {
    caretColor: "#2563eb",
    minHeight: "100%",
    padding: "14px 16px"
  },
  ".cm-line": {
    padding: "0 2px"
  },
  ".cm-gutters": {
    backgroundColor: "#f8fafc",
    borderRight: "1px solid #e2e8f0",
    color: "#94a3b8"
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "40px",
    padding: "0 10px 0 0",
    textAlign: "right"
  },
  ".cm-activeLine": {
    backgroundColor: "#eff6ff"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#e0f2fe",
    color: "#475569"
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(59, 130, 246, 0.24) !important"
  },
  ".cm-sqltoerd-relation-source": {
    backgroundColor: "rgba(147, 197, 253, 0.28)",
    borderBottom: "2px solid #60a5fa"
  },
  ".cm-focused": {
    outline: "none"
  }
});

function isSqlErdApiConflictError(error: unknown) {
  return error instanceof SqlErdApiError && error.status === 409;
}

function isSqlErdWriteProtocolMismatchError(error: unknown) {
  return (
    error instanceof SqlErdApiError &&
    error.code === "SQL_ERD_WRITE_PROTOCOL_MISMATCH"
  );
}

function getLayoutAutosaveBlockReason(
  error: unknown
): LayoutAutosaveBlockReason | null {
  return getLayoutAutosaveBlockReasonForApiError({
    code: error instanceof SqlErdApiError ? error.code : undefined,
    status: error instanceof SqlErdApiError ? error.status : undefined
  });
}

function isSqlErdApiTransientAutosaveError(error: unknown) {
  return isLayoutAutosaveTransientStatus(
    error instanceof SqlErdApiError ? error.status : undefined
  );
}

export function SqlErdPanel({ sessionId }: { sessionId: string }) {
  const authSession = useAuthSession();
  const activeWorkspaceId = authSession?.activeWorkspaceId ?? null;
  const accessToken = authSession?.accessToken ?? null;
  const realtimeConfig = useMemo<SqlErdRealtimeConfig>(
    () => ({
      authToken: accessToken,
      currentUser: authSession
        ? {
            displayName: authSession.user.displayName || authSession.user.name || "PILO",
            userId: authSession.user.id
          }
        : null,
      enabled: Boolean(
        accessToken &&
          activeWorkspaceId &&
          authSession?.user.id &&
          !isDevPreviewAccessToken(accessToken)
      ),
      sessionId,
      workspaceId: activeWorkspaceId ?? ""
    }),
    [accessToken, activeWorkspaceId, authSession, sessionId]
  );
  const panelContainerRef = useRef<HTMLElement | null>(null);
  const manualAutosaveRetryRef = useRef(false);
  const sessionLoadRequestIdRef = useRef(0);
  const hasLoadedSessionRef = useRef(false);
  const currentSessionIdRef = useRef(sessionId);
  const autosaveGateRef = useRef<SqlErdAutosaveGateState>({
    activeGeneration: null,
    completionEpoch: 0
  });
  const autosaveLifecycleGenerationRef = useRef(0);
  const pendingSourceAutosaveSnapshotRef =
    useRef<SqlErdViewSession | null>(null);
  const parseWorkerRef = useRef<SqlErdParseWorkerController | null>(null);
  const operationPersistedLayoutRef = useRef<{
    layoutJson: SqltoerdLayoutJsonV1;
    revision: number;
    sessionId: string;
  } | null>(null);
  const isWriteProtocolMismatchRef = useRef(false);
  currentSessionIdRef.current = sessionId;
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [panelContainerWidth, setPanelContainerWidth] = useState(0);
  const [sourcePanelWidth, setSourcePanelWidth] = useState(
    SOURCE_PANEL_DEFAULT_WIDTH
  );
  const [inspectorPanelWidth, setInspectorPanelWidth] = useState(
    INSPECTOR_PANEL_DEFAULT_WIDTH
  );
  const [sqlErdEditState, setSqlErdEditState] = useState(() =>
    createSqlErdEditState(emptySqlErdViewSession)
  );
  const sqlErdEditStateRef = useRef(sqlErdEditState);
  const applySqlErdEditAction = useCallback(
    (action: SqlErdEditAction) => {
      const nextState = reduceSqlErdEditState(
        sqlErdEditStateRef.current,
        action
      );

      sqlErdEditStateRef.current = nextState;
      setSqlErdEditState(nextState);
    },
    []
  );
  const terminateParseWorker = useCallback(() => {
    const controller = parseWorkerRef.current;

    if (!controller) {
      return;
    }

    controller.terminate();
    parseWorkerRef.current = null;
  }, []);
  const runSqlErdParseWorker = useCallback(
    (request: ParseWorkerRequest): Promise<ParseWorkerResponse> => {
      if (isSqlErdSourceTextTooLarge(request.sourceText)) {
        return Promise.resolve({
          cancelled: false,
          error: {
            code: "SOURCE_TOO_LARGE",
            message: "SQL DDL source exceeds the 1 MiB UTF-8 limit."
          },
          ok: false,
          requestSequence: request.requestSequence,
          sessionId: request.sessionId
        });
      }

      terminateParseWorker();

      return new Promise((resolve) => {
        const worker = new Worker(
          new URL("../workers/sql-erd-parse-worker.ts", import.meta.url)
        );
        let didFinish = false;
        let timeoutId: number | null = null;

        const finish = (response: ParseWorkerResponse) => {
          if (didFinish) {
            return;
          }

          didFinish = true;
          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
          }
          if (parseWorkerRef.current === controller) {
            parseWorkerRef.current = null;
          }
          worker.terminate();
          resolve(response);
        };
        const controller: SqlErdParseWorkerController = {
          terminate: () => {
            finish(createSqlErdParseWorkerCancellation(request));
          }
        };
        parseWorkerRef.current = controller;
        timeoutId = window.setTimeout(() => {
          finish({
            cancelled: false,
            error: {
              code: "PARSE_FAILED",
              message: "SQL parsing timed out after 5 seconds."
            },
            ok: false,
            requestSequence: request.requestSequence,
            sessionId: request.sessionId
          });
        }, SQL_ERD_PARSE_TIMEOUT_MS);

        worker.addEventListener("message", (event: MessageEvent<ParseWorkerResponse>) => {
          finish(event.data);
        });
        worker.addEventListener("error", () => {
          finish({
            cancelled: false,
            error: {
              code: "PARSE_FAILED",
              message: "SQL parsing worker could not complete."
            },
            ok: false,
            requestSequence: request.requestSequence,
            sessionId: request.sessionId
          });
        });
        worker.postMessage(request);
      });
    },
    [terminateParseWorker]
  );
  const setPendingSourceAutosaveSnapshot = useCallback(
    (snapshot: SqlErdViewSession | null) => {
      pendingSourceAutosaveSnapshotRef.current = snapshot;
      setPendingSourceAutosaveSnapshotState(snapshot);
      setSourceAutosaveState(snapshot ? "pending" : "idle");
    },
    []
  );
  const tryBeginAutosave = useCallback((requestGeneration: number) => {
    const transition = tryBeginSqlErdAutosave({
      requestGeneration,
      state: autosaveGateRef.current
    });

    autosaveGateRef.current = transition.state;
    return transition.accepted;
  }, []);
  const completeAutosave = useCallback((requestGeneration: number) => {
    const transition = completeSqlErdAutosave({
      requestGeneration,
      state: autosaveGateRef.current
    });

    autosaveGateRef.current = transition.state;
    if (transition.completed) {
      setAutosaveCompletionEpoch(transition.state.completionEpoch);
    }
  }, []);
  const isCurrentAutosaveRequest = useCallback(
    (requestSessionId: string, requestGeneration: number) => {
      return isSqlErdAutosaveRequestCurrent({
        currentGeneration: autosaveLifecycleGenerationRef.current,
        currentSessionId: currentSessionIdRef.current,
        currentSnapshotSessionId:
          sqlErdEditStateRef.current.lastSuccessfulSnapshot.id,
        requestGeneration,
        requestSessionId
      });
    },
    []
  );
  const sqlErdViewSession =
    sqlErdEditState.lastSuccessfulSnapshot;
  const [sessionLoadState, setSessionLoadState] =
    useState<SqlErdSessionLoadState>({
      label: "Loading",
      message: "Loading workspace session",
      tone: "neutral"
    });
  const [selectedSqlErdObject, setSelectedSqlErdObject] =
    useState<SqlErdSelection>({ type: "none" });
  const [agentTableFocus, setAgentTableFocus] =
    useState<SqlErdAgentTableFocus | null>(null);
  const [agentTableFocusRevisionValidated, setAgentTableFocusRevisionValidated] =
    useState(false);
  const [tablePinState, setTablePinState] = useState(() =>
    createSqlErdTablePinState()
  );
  const [pendingSourceAutosaveSnapshot, setPendingSourceAutosaveSnapshotState] =
    useState<SqlErdViewSession | null>(null);
  const [sourceAutosaveState, setSourceAutosaveState] =
    useState<SqlErdSourceAutosaveState>("idle");
  const [sourceAutosaveRetryAttempt, setSourceAutosaveRetryAttempt] =
    useState(0);
  const [pendingLayoutAutosaveJson, setPendingLayoutAutosaveJson] =
    useState<SqltoerdLayoutJsonV1 | null>(null);
  const [pendingLayoutOperations, setPendingLayoutOperations] = useState<
    PendingSqlErdLayoutOperation[]
  >([]);
  const [layoutAutosaveRetryAttempt, setLayoutAutosaveRetryAttempt] =
    useState(0);
  const [layoutAutosaveBlockReason, setLayoutAutosaveBlockReason] =
    useState<LayoutAutosaveBlockReason | null>(null);
  const [lastResolvedDialect, setLastResolvedDialect] =
    useState<SqltoerdResolvedDialect | null>(null);
  const [sqlSourceMap, setSqlSourceMap] =
    useState<SqltoerdSourceMap | null>(null);
  const [normalizedSqlPreview, setNormalizedSqlPreview] =
    useState<SqlErdNormalizedSqlPreview | null>(null);
  const [normalizedSqlApplyError, setNormalizedSqlApplyError] = useState<
    string | null
  >(null);
  const [isNormalizedSqlApplying, setIsNormalizedSqlApplying] =
    useState(false);
  const [modelSqlHistory, setModelSqlHistory] =
    useState<SqlErdModelSqlHistory>(() => createSqlErdModelSqlHistory());
  const [autosaveCompletionEpoch, setAutosaveCompletionEpoch] = useState(0);
  const isSessionReady =
    sqlErdViewSession.id === sessionId &&
    sqlErdViewSession.revision !== null;
  const activeAgentTableFocus =
    agentTableFocus &&
    isSqlErdAgentTableFocusCurrent(
      agentTableFocus,
      {
        sessionId,
        sessionRevision: sqlErdViewSession.revision,
        modelJson: sqlErdViewSession.modelJson,
        revisionValidated: agentTableFocusRevisionValidated
      }
    )
      ? agentTableFocus
      : null;
  const sourceLockClient = useMemo(
    () => ({
      acquireSourceLock: async (leaseId: string) => {
        if (!accessToken || !activeWorkspaceId || !sqlErdViewSession.id) {
          throw new Error("SQL source lock requires an active workspace session.");
        }
        return createSqlErdApiClient({ accessToken }).acquireSourceLock(
          activeWorkspaceId,
          sqlErdViewSession.id,
          leaseId
        );
      },
      releaseSourceLock: async (leaseId: string) => {
        if (!accessToken || !activeWorkspaceId || !sqlErdViewSession.id) return;
        return createSqlErdApiClient({ accessToken }).releaseSourceLock(
          activeWorkspaceId,
          sqlErdViewSession.id,
          leaseId
        );
      },
      renewSourceLock: async (leaseId: string) => {
        if (!accessToken || !activeWorkspaceId || !sqlErdViewSession.id) {
          throw new Error("SQL source lock requires an active workspace session.");
        }
        return createSqlErdApiClient({ accessToken }).renewSourceLock(
          activeWorkspaceId,
          sqlErdViewSession.id,
          leaseId
        );
      }
    }),
    [accessToken, activeWorkspaceId, sqlErdViewSession.id]
  );
  const sourceLock = useSqlErdSourceLock({
    active:
      isSourceOpen &&
      isSessionReady &&
      sqlErdViewSession.writeProtocol === "operations_v1",
    client: sourceLockClient
  });
  const applyRemoteOperations = useCallback(
    async (operations: SqlErdOperationPayload[]) => {
      if (!accessToken || !activeWorkspaceId || !sqlErdViewSession.id) return;
      const sourceSnapshotIds = operations
        .filter((operation) => operation.type === "source_snapshot")
        .map((operation) => operation.sourceSnapshotId);
      const snapshots = [];
      for (let index = 0; index < sourceSnapshotIds.length; index += 3) {
        const batch = sourceSnapshotIds.slice(index, index + 3);
        const result = await createSqlErdApiClient({ accessToken }).listSourceSnapshots(
          activeWorkspaceId,
          sqlErdViewSession.id,
          batch
        );
        snapshots.push(...result);
      }
      const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));

      operations.forEach((operation) => {
        const current = sqlErdEditStateRef.current.lastSuccessfulSnapshot;
        if (!current.id || current.id !== operation.sessionId) return;

        if (operation.type === "layout_patch") {
          const snapshot = {
            ...current,
            latestOpSeq: operation.opSeq,
            layoutJson: applySqlErdOperationLayoutPatch(current.layoutJson, operation.patch),
            revision: operation.resultRevision
          };
          operationPersistedLayoutRef.current = {
            layoutJson: snapshot.layoutJson,
            revision: operation.resultRevision,
            sessionId: operation.sessionId
          };
          applySqlErdEditAction({ snapshot, type: "operation_saved" });
          return;
        }

        const sourceSnapshot = snapshotsById.get(operation.sourceSnapshotId);
        if (!sourceSnapshot) return;
        const snapshot = {
          ...current,
          dialect: sourceSnapshot.dialect,
          latestOpSeq: operation.opSeq,
          layoutJson: sourceSnapshot.layoutJson,
          modelJson: sourceSnapshot.modelJson,
          revision: operation.resultRevision,
          sourceFormat: sourceSnapshot.sourceFormat,
          sourceText: sourceSnapshot.sourceText
        };
        operationPersistedLayoutRef.current = {
          layoutJson: snapshot.layoutJson,
          revision: operation.resultRevision,
          sessionId: operation.sessionId
        };
        applySqlErdEditAction({ snapshot, type: "remote_snapshot_applied" });
      });
    },
    [accessToken, activeWorkspaceId, applySqlErdEditAction, sqlErdViewSession.id]
  );
  const catchUpOperations = useCallback(
    (afterSeq: number, signal?: AbortSignal) => {
      if (!accessToken || !activeWorkspaceId || !sqlErdViewSession.id) {
        return Promise.reject(new Error("SQLtoERD operation sync requires an active workspace session."));
      }
      return createSqlErdApiClient({ accessToken }).listOperations(
        activeWorkspaceId,
        sqlErdViewSession.id,
        afterSeq,
        signal
      );
    },
    [accessToken, activeWorkspaceId, sqlErdViewSession.id]
  );
  useSqlErdOperationSync(realtimeConfig, {
    applyOperations: applyRemoteOperations,
    catchUpOperations,
    initialLatestOpSeq: sqlErdViewSession.latestOpSeq,
    writeProtocol: sqlErdViewSession.writeProtocol
  });
  const sourceEditorDialect = resolveSqlSourceEditorDialect(
    sqlErdEditState.draftDialect,
    lastResolvedDialect
  );
  const autoParseDraftSourceText = sqlErdEditState.draftSourceText;
  const autoParseDraftDialect = sqlErdEditState.draftDialect;
  const autoParseRequestSequence = sqlErdEditState.parse.requestSequence;
  const sourceStatus = getSqlErdSourceStatus({
    autosaveBlockReason: layoutAutosaveBlockReason,
    fallbackState: sessionLoadState,
    isDraftDirty: isSqlErdDraftDirty(sqlErdEditState),
    parse: sqlErdEditState.parse,
    sourceAutosaveState
  });
  const isWriteProtocolMismatch =
    layoutAutosaveBlockReason === "write_protocol_mismatch";
  isWriteProtocolMismatchRef.current = isWriteProtocolMismatch;
  useEffect(() => {
    if (!sqlErdViewSession.id || sqlErdViewSession.revision === null) return;
    const persisted = operationPersistedLayoutRef.current;
    if (
      !persisted ||
      persisted.sessionId !== sqlErdViewSession.id ||
      persisted.revision !== sqlErdViewSession.revision
    ) {
      operationPersistedLayoutRef.current = {
        layoutJson: sqlErdViewSession.layoutJson,
        revision: sqlErdViewSession.revision,
        sessionId: sqlErdViewSession.id
      };
    }
  }, [sqlErdViewSession.id, sqlErdViewSession.layoutJson, sqlErdViewSession.revision]);
  const sourcePanelStatus = isWriteProtocolMismatch
    ? {
        label: "Read only",
        message: "Reload this session before editing or saving changes.",
        tone: "neutral" as const
      }
    : sqlErdViewSession.writeProtocol === "operations_v1" &&
    isSourceOpen &&
    !sourceLock.canEdit
      ? {
          label: sourceLock.status === "acquiring" ? "Acquiring lock" : "Read only",
          message:
            sourceLock.status === "read_only"
              ? sourceLock.message
              : "Acquiring the SQL source lock.",
          tone: "neutral" as const
        }
      : sourceStatus;
  useEffect(() => {
    if (!isWriteProtocolMismatch) {
      return;
    }

    terminateParseWorker();
    setNormalizedSqlPreview(null);
    setNormalizedSqlApplyError(null);
    setIsNormalizedSqlApplying(false);
  }, [isWriteProtocolMismatch, terminateParseWorker]);
  const selectedRelationSourceRanges = useMemo(
    () =>
      getSelectedSqlErdRelationSourceRanges({
        selection: selectedSqlErdObject,
        sourceMap: sqlSourceMap,
        sourceText: sqlErdEditState.draftSourceText
      }),
    [selectedSqlErdObject, sqlErdEditState.draftSourceText, sqlSourceMap]
  );
  const modelIndex = useMemo(
    () => createSqltoerdModelIndex(sqlErdViewSession.modelJson),
    [sqlErdViewSession.modelJson]
  );
  const sessionCounts = useMemo(
    () => getSqltoerdModelCounts(sqlErdViewSession.modelJson),
    [sqlErdViewSession.modelJson]
  );
  const inspectorViewModel = useMemo(
    () =>
      createSqlErdInspectorViewModel(
        selectedSqlErdObject,
        modelIndex,
        sqlErdViewSession.layoutJson.annotations,
        sqlErdViewSession.settingsJson
      ),
    [
      modelIndex,
      selectedSqlErdObject,
      sqlErdViewSession.layoutJson.annotations,
      sqlErdViewSession.settingsJson
    ]
  );
  const pinnedTableTitle = useMemo(() => {
    if (!tablePinState.pinnedTableId) {
      return null;
    }

    const table = modelIndex.tablesById.get(tablePinState.pinnedTableId);

    return table ? getTableDisplayName(table) : null;
  }, [modelIndex, tablePinState.pinnedTableId]);
  const handlePinTable = useCallback(() => {
    if (inspectorViewModel.type !== "table") {
      return;
    }

    setTablePinState((current) =>
      pinSqlErdTable(current, inspectorViewModel.table.id)
    );
  }, [inspectorViewModel]);
  const handleNavigateToPinnedTable = useCallback(() => {
    setTablePinState((current) =>
      current.pinnedTableId
        ? pinSqlErdTable(current, current.pinnedTableId)
        : current
    );
  }, []);
  const handleClearTablePin = useCallback(() => {
    setTablePinState(clearSqlErdTablePin());
  }, []);

  useEffect(() => {
    setTablePinState(createSqlErdTablePinState());
  }, [sessionId]);

  useEffect(() => {
    if (
      tablePinState.pinnedTableId &&
      !modelIndex.tablesById.has(tablePinState.pinnedTableId)
    ) {
      setTablePinState(clearSqlErdTablePin());
    }
  }, [modelIndex, tablePinState.pinnedTableId]);
  const handleSourceTextChange = useCallback((sourceText: string) => {
    if (isWriteProtocolMismatch) {
      return;
    }

    setSqlSourceMap(null);
    setNormalizedSqlPreview(null);
    setNormalizedSqlApplyError(null);
    setModelSqlHistory(createSqlErdModelSqlHistory());
    applySqlErdEditAction({
      sourceText,
      type: "draft_source_changed"
    });
  }, [applySqlErdEditAction, isWriteProtocolMismatch]);
  const handleDialectChange = useCallback((dialect: SqltoerdDialect) => {
    if (isWriteProtocolMismatch) {
      return;
    }

    setSqlSourceMap(null);
    setNormalizedSqlPreview(null);
    setNormalizedSqlApplyError(null);
    setModelSqlHistory(createSqlErdModelSqlHistory());
    applySqlErdEditAction({
      dialect,
      type: "draft_dialect_changed"
    });
  }, [applySqlErdEditAction, isWriteProtocolMismatch]);
  const applyNormalizedSqlSnapshot = useCallback(
    ({
      baseSnapshot,
      onApplied,
      sourceMapModelJson,
      targetSnapshot
    }: {
      baseSnapshot: SqlErdViewSession;
      onApplied: (snapshot: SqlErdViewSession) => void;
      sourceMapModelJson: SqlErdViewSession["modelJson"];
      targetSnapshot: SqlErdViewSession;
    }) => {
      if (
        isWriteProtocolMismatchRef.current ||
        !baseSnapshot.id ||
        isNormalizedSqlApplying
      ) {
        return;
      }

      const requestSequence =
        sqlErdEditStateRef.current.parse.requestSequence + 1;
      setIsNormalizedSqlApplying(true);
      setNormalizedSqlApplyError(null);

      void runSqlErdParseWorker({
        dialect: targetSnapshot.dialect,
        previousLayoutJson: targetSnapshot.layoutJson,
        requestSequence,
        sessionId: baseSnapshot.id,
        sourceMapModelJson,
        sourceText: targetSnapshot.sourceText
      }).then((parseResult) => {
        const currentSnapshot =
          sqlErdEditStateRef.current.lastSuccessfulSnapshot;
        const isCurrent =
          isSqlErdViewSessionCurrent(baseSnapshot, currentSnapshot) &&
          parseResult.requestSequence === requestSequence &&
          parseResult.sessionId === baseSnapshot.id;

        if (!isCurrent || parseResult.cancelled) {
          if (!parseResult.cancelled) {
            setNormalizedSqlApplyError(
              "SQL을 적용하는 동안 세션이 변경되었습니다. 새 미리보기를 만든 뒤 다시 시도하세요."
            );
          }
          setIsNormalizedSqlApplying(false);
          return;
        }

        if (isWriteProtocolMismatchRef.current) {
          setIsNormalizedSqlApplying(false);
          return;
        }

        if (!parseResult.ok) {
          setNormalizedSqlApplyError(parseResult.error.message);
          setIsNormalizedSqlApplying(false);
          return;
        }

        const parsedSnapshot: SqlErdViewSession = {
          ...baseSnapshot,
          layoutJson: parseResult.layoutJson,
          modelJson: parseResult.modelJson,
          settingsJson: targetSnapshot.settingsJson,
          sourceText: targetSnapshot.sourceText
        };

        applySqlErdEditAction({
          baseSnapshot,
          snapshot: parsedSnapshot,
          type: "normalized_sql_applied"
        });
        setLastResolvedDialect(parseResult.resolvedDialect);
        setSqlSourceMap(parseResult.sourceMap);
        setPendingSourceAutosaveSnapshot(parsedSnapshot);
        setSourceAutosaveRetryAttempt(0);
        setSelectedSqlErdObject({ type: "none" });
        setSessionLoadState({
          label: "Unsaved",
          message: "Normalized SQL changes will autosave",
          tone: "neutral"
        });
        onApplied(parsedSnapshot);
        setIsNormalizedSqlApplying(false);
      });
    },
    [
      applySqlErdEditAction,
      isNormalizedSqlApplying,
      runSqlErdParseWorker,
      setPendingSourceAutosaveSnapshot
    ]
  );
  const handlePreviewNormalizedSql = useCallback(() => {
    const currentSnapshot = sqlErdEditStateRef.current.lastSuccessfulSnapshot;
    const resolvedDialect =
      lastResolvedDialect ??
      (currentSnapshot.dialect === "auto" ? null : currentSnapshot.dialect);

    if (
      isWriteProtocolMismatch ||
      !resolvedDialect ||
      isSqlErdDraftDirty(sqlErdEditStateRef.current)
    ) {
      setNormalizedSqlApplyError(
        "Generate the current SQL successfully before creating a normalized SQL preview."
      );
      return;
    }

    setNormalizedSqlApplyError(null);
    setNormalizedSqlPreview(
      createSqlErdNormalizedSqlPreview({
        modelJson: currentSnapshot.modelJson,
        resolvedDialect,
        session: currentSnapshot
      })
    );
  }, [isWriteProtocolMismatch, lastResolvedDialect]);
  const handlePreviewForeignKeyAdd = useCallback(
    ({
      fromColumnId,
      fromTableId,
      toColumnId,
      toTableId
    }: {
      fromColumnId: string;
      fromTableId: string;
      toColumnId: string;
      toTableId: string;
    }): SqltoerdForeignKeyAddResult | null => {
      const currentSnapshot =
        sqlErdEditStateRef.current.lastSuccessfulSnapshot;
      const resolvedDialect =
        lastResolvedDialect ??
        (currentSnapshot.dialect === "auto" ? null : currentSnapshot.dialect);

      if (
        isWriteProtocolMismatch ||
        !resolvedDialect ||
        isNormalizedSqlApplying ||
        isSqlErdDraftDirty(sqlErdEditStateRef.current)
      ) {
        return null;
      }

      const candidate = createSqlErdForeignKeyAddCandidate({
        dialect: resolvedDialect,
        fromColumnId,
        fromTableId,
        modelJson: currentSnapshot.modelJson,
        toColumnId,
        toTableId
      });

      if (!candidate.ok) {
        return candidate;
      }

      setNormalizedSqlApplyError(null);
      setNormalizedSqlPreview(
        createSqlErdNormalizedSqlPreview({
          modelJson: candidate.modelJson,
          resolvedDialect,
          session: currentSnapshot
        })
      );

      return candidate;
    },
    [isNormalizedSqlApplying, isWriteProtocolMismatch, lastResolvedDialect]
  );
  const handlePreviewForeignKeyUpdate = useCallback(
    ({
      relationId,
      toColumnId,
      toTableId
    }: {
      relationId: string;
      toColumnId: string;
      toTableId: string;
    }): SqltoerdForeignKeyEditResult | null => {
      const currentSnapshot =
        sqlErdEditStateRef.current.lastSuccessfulSnapshot;
      const resolvedDialect =
        lastResolvedDialect ??
        (currentSnapshot.dialect === "auto" ? null : currentSnapshot.dialect);

      if (
        isWriteProtocolMismatch ||
        !resolvedDialect ||
        isNormalizedSqlApplying ||
        isSqlErdDraftDirty(sqlErdEditStateRef.current)
      ) {
        return null;
      }

      const candidate = createSqlErdForeignKeyUpdateCandidate({
        dialect: resolvedDialect,
        modelJson: currentSnapshot.modelJson,
        relationId,
        toColumnId,
        toTableId
      });

      if (!candidate.ok) {
        return candidate;
      }

      setNormalizedSqlApplyError(null);
      setNormalizedSqlPreview(
        createSqlErdNormalizedSqlPreview({
          modelJson: candidate.modelJson,
          resolvedDialect,
          session: currentSnapshot
        })
      );

      return candidate;
    },
    [isNormalizedSqlApplying, isWriteProtocolMismatch, lastResolvedDialect]
  );
  const handlePreviewForeignKeyDelete = useCallback(
    ({ relationId }: { relationId: string }): SqltoerdForeignKeyEditResult | null => {
      const currentSnapshot =
        sqlErdEditStateRef.current.lastSuccessfulSnapshot;
      const resolvedDialect =
        lastResolvedDialect ??
        (currentSnapshot.dialect === "auto" ? null : currentSnapshot.dialect);

      if (
        isWriteProtocolMismatch ||
        !resolvedDialect ||
        isNormalizedSqlApplying ||
        isSqlErdDraftDirty(sqlErdEditStateRef.current)
      ) {
        return null;
      }

      const candidate = createSqlErdForeignKeyDeleteCandidate({
        modelJson: currentSnapshot.modelJson,
        relationId
      });

      if (!candidate.ok) {
        return candidate;
      }

      setNormalizedSqlApplyError(null);
      setNormalizedSqlPreview(
        createSqlErdNormalizedSqlPreview({
          modelJson: candidate.modelJson,
          resolvedDialect,
          session: currentSnapshot
        })
      );

      return candidate;
    },
    [isNormalizedSqlApplying, isWriteProtocolMismatch, lastResolvedDialect]
  );
  const handlePreviewAnnotationForeignKeyConversion = useCallback(
    ({
      annotationId,
      labelDisposition
    }: {
      annotationId: string;
      labelDisposition: SqltoerdAnnotationLabelDisposition;
    }): SqltoerdAnnotationForeignKeyConversionResult | null => {
      const currentSnapshot =
        sqlErdEditStateRef.current.lastSuccessfulSnapshot;
      const resolvedDialect =
        lastResolvedDialect ??
        (currentSnapshot.dialect === "auto" ? null : currentSnapshot.dialect);

      if (
        isWriteProtocolMismatch ||
        !resolvedDialect ||
        isNormalizedSqlApplying ||
        isSqlErdDraftDirty(sqlErdEditStateRef.current)
      ) {
        return null;
      }

      const candidate = createSqlErdAnnotationForeignKeyConversionCandidate({
        annotationId,
        dialect: resolvedDialect,
        labelDisposition,
        layoutJson: currentSnapshot.layoutJson,
        modelJson: currentSnapshot.modelJson,
        settingsJson: currentSnapshot.settingsJson
      });

      if (!candidate.ok) {
        return candidate;
      }

      setNormalizedSqlApplyError(null);
      setNormalizedSqlPreview(
        createSqlErdNormalizedSqlPreview({
          layoutJson: candidate.layoutJson,
          modelJson: candidate.modelJson,
          resolvedDialect,
          session: currentSnapshot,
          settingsJson: candidate.settingsJson
        })
      );

      return candidate;
    },
    [isNormalizedSqlApplying, isWriteProtocolMismatch, lastResolvedDialect]
  );
  const handleApplyNormalizedSql = useCallback(() => {
    if (
      isWriteProtocolMismatch ||
      !normalizedSqlPreview ||
      !normalizedSqlPreview.hasChanges ||
      isNormalizedSqlApplying
    ) {
      return;
    }

    const baseSnapshot = sqlErdEditStateRef.current.lastSuccessfulSnapshot;
    if (
      !isSqlErdNormalizedSqlPreviewCurrent(
        normalizedSqlPreview,
        baseSnapshot
      )
    ) {
      setNormalizedSqlApplyError(
        "미리보기 화면이 열린 동안 세션이 변경되었습니다. 적용하기 전에 새 미리보기를 만드세요."
      );
      return;
    }

    applyNormalizedSqlSnapshot({
      baseSnapshot,
      onApplied: () => {
        setModelSqlHistory((currentHistory) =>
          recordSqlErdModelSqlHistory(currentHistory, baseSnapshot)
        );
        setNormalizedSqlPreview(null);
      },
      sourceMapModelJson: normalizedSqlPreview.modelJson,
      targetSnapshot: {
        ...baseSnapshot,
        layoutJson: normalizedSqlPreview.layoutJson,
        settingsJson: normalizedSqlPreview.settingsJson,
        sourceText: normalizedSqlPreview.generatedSourceText
      }
    });
  }, [
    applyNormalizedSqlSnapshot,
    isNormalizedSqlApplying,
    isWriteProtocolMismatch,
    normalizedSqlPreview
  ]);
  const handleUndoNormalizedSql = useCallback(() => {
    if (isWriteProtocolMismatch || isNormalizedSqlApplying) {
      return;
    }

    const baseSnapshot = sqlErdEditStateRef.current.lastSuccessfulSnapshot;
    const transition = undoSqlErdModelSqlHistory(modelSqlHistory, baseSnapshot);
    if (!transition.snapshot) {
      return;
    }

    applyNormalizedSqlSnapshot({
      baseSnapshot,
      onApplied: () => setModelSqlHistory(transition.history),
      sourceMapModelJson: transition.snapshot.modelJson,
      targetSnapshot: {
        ...transition.snapshot,
        id: baseSnapshot.id,
        revision: baseSnapshot.revision
      }
    });
  }, [applyNormalizedSqlSnapshot, isNormalizedSqlApplying, isWriteProtocolMismatch, modelSqlHistory]);
  const handleRedoNormalizedSql = useCallback(() => {
    if (isWriteProtocolMismatch || isNormalizedSqlApplying) {
      return;
    }

    const baseSnapshot = sqlErdEditStateRef.current.lastSuccessfulSnapshot;
    const transition = redoSqlErdModelSqlHistory(modelSqlHistory, baseSnapshot);
    if (!transition.snapshot) {
      return;
    }

    applyNormalizedSqlSnapshot({
      baseSnapshot,
      onApplied: () => setModelSqlHistory(transition.history),
      sourceMapModelJson: transition.snapshot.modelJson,
      targetSnapshot: {
        ...transition.snapshot,
        id: baseSnapshot.id,
        revision: baseSnapshot.revision
      }
    });
  }, [applyNormalizedSqlSnapshot, isNormalizedSqlApplying, isWriteProtocolMismatch, modelSqlHistory]);
  const handleLayoutChange = useCallback(
    (layoutJson: SqltoerdLayoutJsonV1) => {
      applySqlErdEditAction({
        layoutJson,
        type: "layout_changed"
      });

      if (
        !accessToken ||
        !activeWorkspaceId ||
        !sqlErdViewSession.id ||
        sqlErdViewSession.revision === null
      ) {
        return;
      }

      if (layoutAutosaveBlockReason) {
        setPendingLayoutAutosaveJson(layoutJson);
        setSessionLoadState({
          label: "Autosave paused",
          message: getLayoutAutosavePausedBanner(layoutAutosaveBlockReason)
            .message,
          tone: "error"
        });
        return;
      }

      setPendingLayoutAutosaveJson(layoutJson);
      setLayoutAutosaveRetryAttempt(0);
      setSessionLoadState({
        label: "Unsaved",
        message: "Table layout changes will autosave",
        tone: "neutral"
      });
    },
    [
      accessToken,
      activeWorkspaceId,
      applySqlErdEditAction,
      layoutAutosaveBlockReason,
      sqlErdViewSession.id,
      sqlErdViewSession.revision
    ]
  );
  const handleLayoutPatch = useCallback(
    (patch: SqltoerdLayoutPatch) => {
      applySqlErdEditAction({ patch, type: "layout_patched" });
      const nextLayoutJson = sqlErdEditStateRef.current.lastSuccessfulSnapshot.layoutJson;

      if (sqlErdViewSession.writeProtocol === "operations_v1") {
        const operationSessionId = sqlErdViewSession.id;
        if (!operationSessionId || sqlErdViewSession.revision === null) return;

        const operationPatch = createSqlErdOperationLayoutPatch(patch, nextLayoutJson);
        if (!Object.keys(operationPatch).length) return;

        setPendingLayoutOperations((current) => [
          ...current,
          {
            clientOperationId: crypto.randomUUID(),
            patch: operationPatch,
            sessionId: operationSessionId
          }
        ]);
        setLayoutAutosaveRetryAttempt(0);
        setSessionLoadState({
          label: "Unsaved",
          message: "Canvas changes will sync as workspace operations",
          tone: "neutral"
        });
        return;
      }

      handleLayoutChange(nextLayoutJson);
    },
    [
      applySqlErdEditAction,
      handleLayoutChange,
      sqlErdViewSession.id,
      sqlErdViewSession.revision,
      sqlErdViewSession.writeProtocol
    ]
  );
  const handleRetryLayoutAutosaveOnce = useCallback(() => {
    if (
      !pendingLayoutAutosaveJson &&
      !pendingLayoutOperations.length &&
      !pendingSourceAutosaveSnapshot
    ) {
      return;
    }

    manualAutosaveRetryRef.current = true;
    setLayoutAutosaveBlockReason(null);
    setLayoutAutosaveRetryAttempt(0);
    setSourceAutosaveRetryAttempt(0);
    if (pendingSourceAutosaveSnapshot) {
      setSourceAutosaveState("pending");
    }
    setSessionLoadState({
      label: "Saving",
      message: "Retrying pending SQLtoERD changes",
      tone: "neutral"
    });
  }, [pendingLayoutAutosaveJson, pendingSourceAutosaveSnapshot]);
  const handleReloadSession = useCallback(
    async () => {
      applySqlErdEditAction({ type: "parse_cancelled" });
      terminateParseWorker();
      autosaveLifecycleGenerationRef.current += 1;
      const requestId = sessionLoadRequestIdRef.current + 1;
      sessionLoadRequestIdRef.current = requestId;

      function isCurrentRequest() {
        return shouldApplySqlErdSessionLoadResult(
          requestId,
          sessionLoadRequestIdRef.current
        );
      }

      function applyReloadFailure() {
        if (!isCurrentRequest()) {
          return;
        }

        applySqlErdEditAction({ type: "parse_resume_after_cancel" });
        setSessionLoadState(
          getSqlErdSessionLoadFailureState({
            hasLoadedSession: hasLoadedSessionRef.current
          })
        );
      }

      if (!accessToken || !activeWorkspaceId) {
        applyReloadFailure();
        return;
      }

      const sqlErdApiClient = createSqlErdApiClient({
        accessToken
      });

      setSessionLoadState({
        label: "Loading",
        message: "Loading workspace session",
        tone: "neutral"
      });

      try {
        const activeSession = await sqlErdApiClient.getSession(
          activeWorkspaceId,
          sessionId
        );

        if (!isCurrentRequest()) {
          return;
        }

        const activeViewSession =
          createWorkspaceSqlErdViewSession(activeSession);
        const activeParseResult = await runSqlErdParseWorker({
          dialect: activeViewSession.dialect,
          previousLayoutJson: activeViewSession.layoutJson,
          requestSequence: requestId,
          sessionId: activeSession.id,
          sourceMapModelJson: activeViewSession.modelJson,
          sourceText: activeViewSession.sourceText
        });

        if (
          !isCurrentRequest() ||
          activeParseResult.requestSequence !== requestId ||
          activeParseResult.sessionId !== activeSession.id
        ) {
          return;
        }

        applySqlErdEditAction({
          snapshot: activeViewSession,
          type: "session_loaded"
        });
        setLastResolvedDialect(
          activeParseResult.ok
            ? activeParseResult.resolvedDialect
            : activeSession.dialect === "auto"
              ? null
              : activeSession.dialect
        );
        setSqlSourceMap(
          activeParseResult.ok ? activeParseResult.sourceMap : null
        );
        setSessionLoadState({
          label: "Workspace",
          message: `Workspace session revision ${activeSession.revision}`,
          tone: "success"
        });
        hasLoadedSessionRef.current = true;

        setPendingSourceAutosaveSnapshot(null);
        setSourceAutosaveRetryAttempt(0);
        setPendingLayoutAutosaveJson(null);
        setLayoutAutosaveRetryAttempt(0);
        setLayoutAutosaveBlockReason(null);
        setNormalizedSqlPreview(null);
        setNormalizedSqlApplyError(null);
        setModelSqlHistory(createSqlErdModelSqlHistory());
        setSelectedSqlErdObject({ type: "none" });
      } catch {
        applyReloadFailure();
      }
    },
    [
      accessToken,
      activeWorkspaceId,
      applySqlErdEditAction,
      runSqlErdParseWorker,
      sessionId,
      setPendingSourceAutosaveSnapshot,
      terminateParseWorker
    ]
  );
  const handleReloadPausedSession = useCallback(() => {
    void handleReloadSession();
  }, [handleReloadSession]);
  useEffect(() => {
    if (
      !isSessionReady ||
      isWriteProtocolMismatch ||
      !shouldScheduleSqlErdAutoParse(sqlErdEditStateRef.current)
    ) {
      return;
    }

    const debounceTimeoutId = window.setTimeout(() => {
      const parseStart = beginSqlErdParse(sqlErdEditStateRef.current);
      sqlErdEditStateRef.current = parseStart.state;
      setSqlErdEditState(parseStart.state);

      void runSqlErdParseWorker({
        dialect: parseStart.session.dialect,
        previousLayoutJson: parseStart.session.layoutJson,
        requestSequence: parseStart.requestSequence,
        sessionId: parseStart.session.id!,
        sourceText: parseStart.session.sourceText
      }).then((parseResult) => {
        if (
          !isSqlErdParseRequestCurrent(
            sqlErdEditStateRef.current,
            parseStart.requestSequence
          ) ||
          parseStart.session.id !== currentSessionIdRef.current ||
          parseResult.requestSequence !== parseStart.requestSequence ||
          parseResult.sessionId !== parseStart.session.id
        ) {
          return;
        }

        if (parseResult.cancelled) {
          return;
        }

        if (isWriteProtocolMismatchRef.current) {
          return;
        }

        if (!parseResult.ok) {
          applySqlErdEditAction({
            error: parseResult.error,
            requestSequence: parseStart.requestSequence,
            type: "parse_failed"
          });
          return;
        }

        const parsedSnapshot: SqlErdViewSession = {
          ...parseStart.session,
          layoutJson: parseResult.layoutJson,
          modelJson: parseResult.modelJson
        };

        applySqlErdEditAction({
          requestLayoutJson: parseStart.session.layoutJson,
          requestSequence: parseStart.requestSequence,
          snapshot: parsedSnapshot,
          type: "parse_succeeded"
        });
        setLastResolvedDialect(parseResult.resolvedDialect);
        setSqlSourceMap(parseResult.sourceMap);
        setPendingSourceAutosaveSnapshot(parsedSnapshot);
        setSourceAutosaveRetryAttempt(0);
        setSelectedSqlErdObject({ type: "none" });
      });
    }, SQL_ERD_AUTO_PARSE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(debounceTimeoutId);
    };
  }, [
    activeWorkspaceId,
    applySqlErdEditAction,
    autoParseDraftDialect,
    autoParseDraftSourceText,
    autoParseRequestSequence,
    isWriteProtocolMismatch,
    isSessionReady,
    runSqlErdParseWorker,
    sessionId,
    setPendingSourceAutosaveSnapshot,
  ]);

  useEffect(() => {
    if (
      !pendingSourceAutosaveSnapshot ||
      !pendingSourceAutosaveSnapshot.id ||
      !accessToken ||
      !activeWorkspaceId ||
      layoutAutosaveBlockReason
    ) {
      return;
    }

    const requestParsedSnapshot = pendingSourceAutosaveSnapshot;
    const requestSessionId = requestParsedSnapshot.id;
    if (!requestSessionId) {
      return;
    }
    const requestLifecycleGeneration =
      autosaveLifecycleGenerationRef.current;
    const autosaveDelayMs = manualAutosaveRetryRef.current
      ? 0
      : getLayoutAutosaveDelayMs(sourceAutosaveRetryAttempt);
    manualAutosaveRetryRef.current = false;

    const timeoutId = window.setTimeout(async () => {
      if (
        !isCurrentAutosaveRequest(
          requestSessionId,
          requestLifecycleGeneration
        ) ||
        !tryBeginAutosave(requestLifecycleGeneration)
      ) {
        return;
      }

      try {
        if (sqlErdViewSession.writeProtocol === "operations_v1") {
          if (sourceLock.status !== "held") {
            setSourceAutosaveState("pending");
            return;
          }
          const sourcePublishResult = await createSqlErdApiClient({ accessToken })
            .publishSourceSnapshot(activeWorkspaceId, requestSessionId, {
              baseRevision: sourceLock.lease.sourceBaseRevision,
              clientOperationId: crypto.randomUUID(),
              dialect: requestParsedSnapshot.dialect,
              leaseId: sourceLock.lease.leaseId,
              modelJson: requestParsedSnapshot.modelJson,
              sourceFormat: requestParsedSnapshot.sourceFormat,
              sourceText: requestParsedSnapshot.sourceText
            });
          if (!isCurrentAutosaveRequest(requestSessionId, requestLifecycleGeneration)) return;

          const snapshot = {
            ...sqlErdEditStateRef.current.lastSuccessfulSnapshot,
            dialect: sourcePublishResult.snapshot.dialect,
            latestOpSeq: sourcePublishResult.latestOpSeq,
            layoutJson: sourcePublishResult.layoutJson,
            modelJson: sourcePublishResult.snapshot.modelJson,
            revision: sourcePublishResult.revision,
            sourceFormat: sourcePublishResult.snapshot.sourceFormat,
            sourceText: sourcePublishResult.snapshot.sourceText
          };
          operationPersistedLayoutRef.current = {
            layoutJson: sourcePublishResult.layoutJson,
            revision: sourcePublishResult.revision,
            sessionId: requestSessionId
          };
          applySqlErdEditAction({ snapshot, type: "operation_saved" });
          await sourceLock.renew();
          if (pendingSourceAutosaveSnapshotRef.current === requestParsedSnapshot) {
            setPendingSourceAutosaveSnapshot(null);
          }
          setSourceAutosaveRetryAttempt(0);
          setLayoutAutosaveRetryAttempt(0);
          setLayoutAutosaveBlockReason(null);
          setSessionLoadState({
            label: "Workspace",
            message: `Workspace source operation ${sourcePublishResult.latestOpSeq}`,
            tone: "success"
          });
          return;
        }

        const sourceAutosaveRequest = createSqlErdSourceAutosaveRequest(
          requestParsedSnapshot,
          sqlErdEditStateRef.current.lastSuccessfulSnapshot
        );

        if (!sourceAutosaveRequest.ok) {
          return;
        }

        const requestLayoutJson = sourceAutosaveRequest.payload.layoutJson!;
        if (
          pendingSourceAutosaveSnapshotRef.current === requestParsedSnapshot
        ) {
          setSourceAutosaveState("saving");
        }

        const sqlErdApiClient = createSqlErdApiClient({ accessToken });
        const savedSession = await sqlErdApiClient.updateSession(
          activeWorkspaceId,
          sourceAutosaveRequest.sessionId,
          sourceAutosaveRequest.payload
        );

        if (
          !isCurrentAutosaveRequest(
            requestSessionId,
            requestLifecycleGeneration
          )
        ) {
          return;
        }

        applySqlErdEditAction({
          snapshot: createWorkspaceSqlErdViewSession(savedSession),
          type: "source_autosave_saved"
        });
        if (
          pendingSourceAutosaveSnapshotRef.current === requestParsedSnapshot
        ) {
          setPendingSourceAutosaveSnapshot(null);
        } else {
          setSourceAutosaveState("pending");
        }
        setPendingLayoutAutosaveJson((currentLayoutJson) =>
          currentLayoutJson &&
          areSqltoerdLayoutsEqual(currentLayoutJson, requestLayoutJson)
            ? null
            : currentLayoutJson
        );
        setSourceAutosaveRetryAttempt(0);
        setLayoutAutosaveRetryAttempt(0);
        setLayoutAutosaveBlockReason(null);
        setSessionLoadState({
          label: "Workspace",
          message: `Workspace session revision ${savedSession.revision}`,
          tone: "success"
        });
      } catch (error) {
        if (
          !isCurrentAutosaveRequest(
            requestSessionId,
            requestLifecycleGeneration
          )
        ) {
          return;
        }

        if (isSqlErdWriteProtocolMismatchError(error)) {
          setSourceAutosaveRetryAttempt(0);
          setLayoutAutosaveBlockReason("write_protocol_mismatch");
          setSessionLoadState({
            label: "Read only",
            message: getLayoutAutosavePausedBanner("write_protocol_mismatch")
              .message,
            tone: "error"
          });
          return;
        }

        const autosaveBlockReason = getLayoutAutosaveBlockReason(error);

        if (autosaveBlockReason) {
          setSourceAutosaveRetryAttempt(0);
          setLayoutAutosaveBlockReason(autosaveBlockReason);
          setSessionLoadState({
            label:
              autosaveBlockReason === "conflict"
                ? "Save conflict"
                : "Autosave paused",
            message: getLayoutAutosavePausedBanner(autosaveBlockReason)
              .message,
            tone: "error"
          });
          return;
        }

        if (isSqlErdApiTransientAutosaveError(error)) {
          setSourceAutosaveState("retrying");
          setSourceAutosaveRetryAttempt(
            (currentAttempt) => currentAttempt + 1
          );
          setSessionLoadState(getSqlErdWorkspaceSaveErrorState());
        }
      } finally {
        completeAutosave(requestLifecycleGeneration);
      }
    }, autosaveDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    accessToken,
    activeWorkspaceId,
    applySqlErdEditAction,
    autosaveCompletionEpoch,
    completeAutosave,
    isCurrentAutosaveRequest,
    layoutAutosaveBlockReason,
    pendingSourceAutosaveSnapshot,
    setPendingSourceAutosaveSnapshot,
    sourceLock,
    sourceAutosaveRetryAttempt,
    sqlErdViewSession.writeProtocol,
    tryBeginAutosave
  ]);

  useEffect(() => {
    const isOperationProtocol = sqlErdViewSession.writeProtocol === "operations_v1";
    const pendingOperation = isOperationProtocol
      ? pendingLayoutOperations.find(
          (operation) => operation.sessionId === sqlErdViewSession.id
        )
      : null;
    const hasPendingLayout = isOperationProtocol
      ? Boolean(pendingOperation)
      : Boolean(pendingLayoutAutosaveJson);
    if (
      !hasPendingLayout ||
      !accessToken ||
      !activeWorkspaceId ||
      !sqlErdViewSession.id ||
      layoutAutosaveBlockReason
    ) {
      return;
    }

    const requestLayoutJson = isOperationProtocol
      ? sqlErdViewSession.layoutJson
      : pendingLayoutAutosaveJson!;
    const requestSessionId = sqlErdViewSession.id;
    const requestLifecycleGeneration =
      autosaveLifecycleGenerationRef.current;
    const autosaveDelayMs = manualAutosaveRetryRef.current
      ? 0
      : getLayoutAutosaveDelayMs(layoutAutosaveRetryAttempt);
    manualAutosaveRetryRef.current = false;

    const timeoutId = window.setTimeout(async () => {
      if (
        !isCurrentAutosaveRequest(
          requestSessionId,
          requestLifecycleGeneration
        ) ||
        !tryBeginAutosave(requestLifecycleGeneration)
      ) {
        return;
      }

      try {
        if (isOperationProtocol) {
          const persisted = operationPersistedLayoutRef.current;
          if (
            !pendingOperation ||
            !persisted ||
            persisted.sessionId !== requestSessionId
          ) {
            return;
          }
          const operationResult = await createSqlErdApiClient({ accessToken }).createOperation(
            activeWorkspaceId,
            requestSessionId,
            {
              baseRevision: persisted.revision,
              clientOperationId: pendingOperation.clientOperationId,
              patch: pendingOperation.patch,
              type: "layout_patch"
            }
          );
          if (!isCurrentAutosaveRequest(requestSessionId, requestLifecycleGeneration)) return;

          const snapshot = {
            ...sqlErdEditStateRef.current.lastSuccessfulSnapshot,
            latestOpSeq: operationResult.latestOpSeq,
            revision: operationResult.revision
          };
          operationPersistedLayoutRef.current = {
            layoutJson: operationResult.layoutJson,
            revision: operationResult.revision,
            sessionId: requestSessionId
          };
          applySqlErdEditAction({ snapshot, type: "operation_saved" });
          setPendingLayoutOperations((current) =>
            current.filter(
              (operation) =>
                operation.clientOperationId !== pendingOperation.clientOperationId
            )
          );
          setLayoutAutosaveRetryAttempt(0);
          setSessionLoadState({
            label: "Workspace",
            message: `Workspace operation ${operationResult.latestOpSeq}`,
            tone: "success"
          });
          return;
        }

        const layoutAutosaveRequest = createSqlErdLayoutAutosaveRequest(
          sqlErdEditStateRef.current.lastSuccessfulSnapshot,
          requestLayoutJson
        );

        if (!layoutAutosaveRequest.ok) {
          return;
        }

        const sqlErdApiClient = createSqlErdApiClient({
          accessToken
        });

        setSessionLoadState({
          label: "Saving",
          message: "Autosaving table layout",
          tone: "neutral"
        });

        const savedSession = await sqlErdApiClient.updateSession(
          activeWorkspaceId,
          layoutAutosaveRequest.sessionId,
          layoutAutosaveRequest.payload
        );

        if (
          !isCurrentAutosaveRequest(
            requestSessionId,
            requestLifecycleGeneration
          )
        ) {
          return;
        }

        applySqlErdEditAction({
          requestLayoutJson,
          snapshot: createWorkspaceSqlErdViewSession(savedSession),
          type: "layout_saved"
        });
        setPendingLayoutAutosaveJson((currentLayoutJson) =>
          currentLayoutJson &&
          areSqltoerdLayoutsEqual(currentLayoutJson, requestLayoutJson)
            ? null
            : currentLayoutJson
        );
        setLayoutAutosaveRetryAttempt(0);
        setSessionLoadState({
          label: "Workspace",
          message: `Workspace session revision ${savedSession.revision}`,
          tone: "success"
        });
      } catch (error) {
        if (
          !isCurrentAutosaveRequest(
            requestSessionId,
            requestLifecycleGeneration
          )
        ) {
          return;
        }

        if (isSqlErdWriteProtocolMismatchError(error)) {
          setLayoutAutosaveRetryAttempt(0);
          setLayoutAutosaveBlockReason("write_protocol_mismatch");
          setSessionLoadState({
            label: "Read only",
            message: getLayoutAutosavePausedBanner("write_protocol_mismatch")
              .message,
            tone: "error"
          });
          return;
        }

        if (isSqlErdApiConflictError(error)) {
          setLayoutAutosaveRetryAttempt(0);
          setLayoutAutosaveBlockReason("conflict");
          setSessionLoadState({
            label: "Autosave paused",
            message: getLayoutAutosavePausedBanner("conflict").message,
            tone: "error"
          });
          return;
        }

        const layoutAutosaveBlockReason =
          getLayoutAutosaveBlockReason(error);

        if (layoutAutosaveBlockReason) {
          setLayoutAutosaveRetryAttempt(0);
          setLayoutAutosaveBlockReason(layoutAutosaveBlockReason);
          setSessionLoadState({
            label: "Autosave paused",
            message: getLayoutAutosavePausedBanner(layoutAutosaveBlockReason)
              .message,
            tone: "error"
          });
          return;
        }

        if (!isSqlErdApiTransientAutosaveError(error)) {
          return;
        }

        setLayoutAutosaveRetryAttempt((currentAttempt) => currentAttempt + 1);
        setSessionLoadState({
          label: "Save error",
          message: "Table layout could not be autosaved. Retrying soon",
          tone: "error"
        });
      } finally {
        completeAutosave(requestLifecycleGeneration);
      }
    }, autosaveDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    accessToken,
    activeWorkspaceId,
    applySqlErdEditAction,
    autosaveCompletionEpoch,
    completeAutosave,
    isCurrentAutosaveRequest,
    layoutAutosaveBlockReason,
    layoutAutosaveRetryAttempt,
    pendingLayoutAutosaveJson,
    pendingLayoutOperations,
    sqlErdViewSession.id,
    sqlErdViewSession.layoutJson,
    sqlErdViewSession.writeProtocol,
    tryBeginAutosave
  ]);

  useEffect(() => {
    setIsSourceOpen(window.matchMedia("(min-width: 1024px)").matches);
    setIsInspectorOpen(window.matchMedia("(min-width: 1280px)").matches);
  }, []);

  useEffect(() => {
    setAgentTableFocusRevisionValidated(false);
    setAgentTableFocus(consumeStagedSqlErdAgentTableFocus(sessionId));

    function handleAgentTableFocus(event: Event) {
      const focus =
        consumeStagedSqlErdAgentTableFocus(sessionId) ??
        parseSqlErdAgentTableFocusValue(
          (event as CustomEvent<unknown>).detail,
          sessionId
        );
      if (focus) {
        setAgentTableFocusRevisionValidated(false);
        setAgentTableFocus(focus);
      }
    }

    window.addEventListener(
      SQL_ERD_AGENT_TABLE_FOCUS_EVENT,
      handleAgentTableFocus
    );
    return () => {
      window.removeEventListener(
        SQL_ERD_AGENT_TABLE_FOCUS_EVENT,
        handleAgentTableFocus
      );
    };
  }, [sessionId]);

  useEffect(() => {
    if (!activeAgentTableFocus) {
      return;
    }
    setSelectedSqlErdObject({ type: "none" });
  }, [activeAgentTableFocus]);

  useEffect(() => {
    if (isSessionReady && agentTableFocus && !activeAgentTableFocus) {
      setAgentTableFocus(null);
      setAgentTableFocusRevisionValidated(false);
      return;
    }
    if (
      isSessionReady &&
      activeAgentTableFocus &&
      !agentTableFocusRevisionValidated
    ) {
      setAgentTableFocusRevisionValidated(true);
    }
  }, [
    activeAgentTableFocus,
    agentTableFocus,
    agentTableFocusRevisionValidated,
    isSessionReady
  ]);

  useEffect(() => {
    const panelContainer = panelContainerRef.current;

    if (!panelContainer) {
      return;
    }

    const panelContainerElement = panelContainer;

    function updatePanelContainerWidth() {
      setPanelContainerWidth(
        panelContainerElement.getBoundingClientRect().width
      );
    }

    updatePanelContainerWidth();

    const resizeObserver = new ResizeObserver(updatePanelContainerWidth);
    resizeObserver.observe(panelContainerElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    autosaveLifecycleGenerationRef.current += 1;
    terminateParseWorker();
    hasLoadedSessionRef.current = false;
    setPendingSourceAutosaveSnapshot(null);
    setSourceAutosaveRetryAttempt(0);
    setPendingLayoutAutosaveJson(null);
    setLayoutAutosaveRetryAttempt(0);
    setLayoutAutosaveBlockReason(null);
    setNormalizedSqlPreview(null);
    setNormalizedSqlApplyError(null);
    setIsNormalizedSqlApplying(false);
    setModelSqlHistory(createSqlErdModelSqlHistory());
  }, [
    activeWorkspaceId,
    sessionId,
    setPendingSourceAutosaveSnapshot,
    terminateParseWorker
  ]);

  useEffect(() => {
    return () => {
      terminateParseWorker();
    };
  }, [terminateParseWorker]);

  useEffect(() => {
    void handleReloadSession();

    return () => {
      sessionLoadRequestIdRef.current += 1;
    };
  }, [handleReloadSession]);

  const openResizeHandleWidth =
    (isSourceOpen ? PANEL_RESIZE_HANDLE_WIDTH : 0) +
    (isInspectorOpen ? PANEL_RESIZE_HANDLE_WIDTH : 0);
  const sourcePanelMaxWidth = useMemo(
    () =>
      getResizablePanelMaxWidth({
        containerWidth: panelContainerWidth,
        maxWidth: SOURCE_PANEL_MAX_WIDTH,
        minWidth: SOURCE_PANEL_MIN_WIDTH,
        reservedWidth:
          (isInspectorOpen
            ? inspectorPanelWidth
            : COLLAPSED_PANEL_BUTTON_WIDTH) + openResizeHandleWidth
      }),
    [
      inspectorPanelWidth,
      isInspectorOpen,
      openResizeHandleWidth,
      panelContainerWidth
    ]
  );
  const inspectorPanelMaxWidth = useMemo(
    () =>
      getResizablePanelMaxWidth({
        containerWidth: panelContainerWidth,
        maxWidth: INSPECTOR_PANEL_MAX_WIDTH,
        minWidth: INSPECTOR_PANEL_MIN_WIDTH,
        reservedWidth:
          (isSourceOpen ? sourcePanelWidth : COLLAPSED_PANEL_BUTTON_WIDTH) +
          openResizeHandleWidth
      }),
    [isSourceOpen, openResizeHandleWidth, panelContainerWidth, sourcePanelWidth]
  );
  const clampedSourcePanelWidth = clampPanelWidth(
    sourcePanelWidth,
    SOURCE_PANEL_MIN_WIDTH,
    sourcePanelMaxWidth
  );
  const clampedInspectorPanelWidth = clampPanelWidth(
    inspectorPanelWidth,
    INSPECTOR_PANEL_MIN_WIDTH,
    inspectorPanelMaxWidth
  );
  const layoutAutosavePausedBanner = layoutAutosaveBlockReason
    ? getLayoutAutosavePausedBanner(layoutAutosaveBlockReason)
    : null;

  useEffect(() => {
    setSourcePanelWidth((currentWidth) => {
      const nextWidth = clampPanelWidth(
        currentWidth,
        SOURCE_PANEL_MIN_WIDTH,
        sourcePanelMaxWidth
      );

      return nextWidth === currentWidth ? currentWidth : nextWidth;
    });
  }, [sourcePanelMaxWidth]);

  useEffect(() => {
    setInspectorPanelWidth((currentWidth) => {
      const nextWidth = clampPanelWidth(
        currentWidth,
        INSPECTOR_PANEL_MIN_WIDTH,
        inspectorPanelMaxWidth
      );

      return nextWidth === currentWidth ? currentWidth : nextWidth;
    });
  }, [inspectorPanelMaxWidth]);

  return (
    <>
      <section
        className="flex h-full min-h-0 overflow-hidden bg-background"
        ref={panelContainerRef}
      >
      <SourcePanel
        canPreviewNormalizedSql={
          isSessionReady &&
          !isWriteProtocolMismatch &&
          !isNormalizedSqlApplying &&
          !isSqlErdDraftDirty(sqlErdEditState) &&
          (lastResolvedDialect !== null ||
            sqlErdEditState.draftDialect !== "auto")
        }
        canRedoNormalizedSql={
          !isWriteProtocolMismatch &&
          !isNormalizedSqlApplying &&
          modelSqlHistory.future.length > 0
        }
        canUndoNormalizedSql={
          !isWriteProtocolMismatch &&
          !isNormalizedSqlApplying &&
          modelSqlHistory.past.length > 0
        }
        counts={sessionCounts}
        dialect={sqlErdEditState.draftDialect}
        isOpen={isSourceOpen}
        isDialectSelectDisabled={
          !isSessionReady ||
          isWriteProtocolMismatch ||
          (sqlErdViewSession.writeProtocol === "operations_v1" &&
            !sourceLock.canEdit)
        }
        onDialectChange={handleDialectChange}
        onPreviewNormalizedSql={handlePreviewNormalizedSql}
        onRedoNormalizedSql={handleRedoNormalizedSql}
        onSourceTextChange={handleSourceTextChange}
        onToggle={() => setIsSourceOpen((current) => !current)}
        onUndoNormalizedSql={handleUndoNormalizedSql}
        sessionLoadState={sourcePanelStatus}
        isSourceTextReadOnly={
          !isSessionReady ||
          isWriteProtocolMismatch ||
          (sqlErdViewSession.writeProtocol === "operations_v1" &&
            !sourceLock.canEdit)
        }
        sourceText={sqlErdEditState.draftSourceText}
        resolvedDialect={sourceEditorDialect}
        relationSourceRanges={selectedRelationSourceRanges}
        width={clampedSourcePanelWidth}
      />
      {isSourceOpen ? (
        <PanelResizeHandle
          ariaLabel="Resize source panel"
          maxWidth={sourcePanelMaxWidth}
          minWidth={SOURCE_PANEL_MIN_WIDTH}
          onWidthChange={setSourcePanelWidth}
          side="left"
          width={clampedSourcePanelWidth}
        />
      ) : null}
      {isSessionReady ? (
        <CanvasShell
          agentTableFocus={activeAgentTableFocus}
          autosavePausedBanner={layoutAutosavePausedBanner}
          layoutJson={sqlErdViewSession.layoutJson}
          modelJson={sqlErdViewSession.modelJson}
          onLayoutPatch={handleLayoutPatch}
          onReloadSession={handleReloadPausedSession}
          onRetryLayoutAutosaveOnce={handleRetryLayoutAutosaveOnce}
          onSelectionChange={setSelectedSqlErdObject}
          onShowAllTables={() => {
            setAgentTableFocus(null);
            setAgentTableFocusRevisionValidated(false);
          }}
          pinNavigationRequestId={tablePinState.navigationRequestId}
          pinnedTableId={tablePinState.pinnedTableId}
          realtimeConfig={realtimeConfig}
          isReadOnly={isWriteProtocolMismatch}
          isSqlSourceOpen={isSourceOpen}
          selectedSqlErdObject={selectedSqlErdObject}
          sessionId={sessionId}
        />
      ) : (
        <SessionLoadPlaceholder
          onRetry={handleReloadPausedSession}
          sessionLoadState={sessionLoadState}
        />
      )}
      {isInspectorOpen ? (
        <PanelResizeHandle
          ariaLabel="Resize inspector panel"
          maxWidth={inspectorPanelMaxWidth}
          minWidth={INSPECTOR_PANEL_MIN_WIDTH}
          onWidthChange={setInspectorPanelWidth}
          side="right"
          width={clampedInspectorPanelWidth}
        />
      ) : null}
      <InspectorPanel
        canAddForeignKey={
          isSessionReady &&
          !isWriteProtocolMismatch &&
          !isNormalizedSqlApplying &&
          !isSqlErdDraftDirty(sqlErdEditState) &&
          (lastResolvedDialect !== null ||
            sqlErdEditState.draftDialect !== "auto")
        }
        emptyState={{
          sessionLoadState,
          title: sqlErdViewSession.title
        }}
        isOpen={isInspectorOpen}
        modelJson={sqlErdViewSession.modelJson}
        onAddForeignKey={handlePreviewForeignKeyAdd}
        onConvertAnnotationToForeignKey={
          handlePreviewAnnotationForeignKeyConversion
        }
        onDeleteForeignKey={handlePreviewForeignKeyDelete}
        onClearTablePin={handleClearTablePin}
        onNavigateToPinnedTable={handleNavigateToPinnedTable}
        onPinTable={handlePinTable}
        onUpdateForeignKey={handlePreviewForeignKeyUpdate}
        onToggle={() => setIsInspectorOpen((current) => !current)}
        pinnedTableId={tablePinState.pinnedTableId}
        pinnedTableTitle={pinnedTableTitle}
        viewModel={inspectorViewModel}
        width={clampedInspectorPanelWidth}
      />
      </section>
      <NormalizedSqlPreviewDialog
        error={normalizedSqlApplyError}
        isApplying={isNormalizedSqlApplying}
        isReadOnly={isWriteProtocolMismatch}
        onApply={handleApplyNormalizedSql}
        onOpenChange={(open) => {
          if (!open && !isNormalizedSqlApplying) {
            setNormalizedSqlPreview(null);
            setNormalizedSqlApplyError(null);
          }
        }}
        preview={normalizedSqlPreview}
      />
    </>
  );
}

function NormalizedSqlPreviewDialog({
  error,
  isApplying,
  isReadOnly,
  onApply,
  onOpenChange,
  preview
}: {
  error: string | null;
  isApplying: boolean;
  isReadOnly: boolean;
  onApply: () => void;
  onOpenChange: (open: boolean) => void;
  preview: SqlErdNormalizedSqlPreview | null;
}) {
  return (
    <Dialog open={preview !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl" showCloseButton={!isApplying}>
        <DialogHeader>
          <DialogTitle>
            {preview?.generationBlocked
              ? "SQL 재생성 불가"
              : "SQL 변경 적용"}
          </DialogTitle>
          <DialogDescription>
            {preview?.generationBlocked
              ? "지원하지 않는 ALTER TABLE FOREIGN KEY 구문이 필요해 SQLite DDL로 재생성할 수 없습니다."
              : "현재 SQL을 교체하기 전에 생성된 SQL을 검토하세요."}
          </DialogDescription>
        </DialogHeader>
        {preview && !preview.generationBlocked ? (
          <SqlPreviewDiff
            beforeSourceText={preview.baseSnapshot.sourceText}
            afterSourceText={preview.generatedSourceText}
          />
        ) : null}
        {preview?.warnings.length ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            {preview.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}
        {preview && !preview.hasChanges ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            생성된 SQL이 현재 SQL과 같습니다.
          </p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-50"
            disabled={isApplying}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            취소
          </button>
          <button
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
            disabled={isReadOnly || !preview || !preview.hasChanges || isApplying}
            onClick={onApply}
            type="button"
          >
            {isApplying ? "적용 중" : "SQL 변경 적용"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SqlPreviewDiff({
  afterSourceText,
  beforeSourceText
}: {
  afterSourceText: string;
  beforeSourceText: string;
}) {
  const lines = createSqlErdSqlLineDiff(beforeSourceText, afterSourceText);
  const visibleLines = lines.slice(0, 1200);

  return (
    <div className="min-h-0 overflow-hidden rounded-md border">
      <p className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">
        SQL diff
      </p>
      <pre className="max-h-72 overflow-auto bg-slate-950 py-3 font-mono text-xs leading-5 text-slate-100">
        {visibleLines.map((line, index) => (
          <span
            className={cn(
              "block min-h-5 whitespace-pre-wrap break-words px-3",
              line.kind === "added" && "bg-emerald-500/20 text-emerald-100",
              line.kind === "removed" && "bg-rose-500/20 text-rose-100"
            )}
            key={`${line.kind}-${index}-${line.value}`}
          >
            {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
            {line.value}
          </span>
        ))}
      </pre>
      {lines.length > visibleLines.length ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Showing the first {visibleLines.length.toLocaleString()} changed lines.
        </p>
      ) : null}
    </div>
  );
}

function SessionLoadPlaceholder({
  onRetry,
  sessionLoadState
}: {
  onRetry: () => void;
  sessionLoadState: SqlErdSessionLoadState;
}) {
  const isError = sessionLoadState.tone === "error";

  return (
    <div className="flex min-w-0 flex-1 items-center justify-center bg-muted/10 px-6 text-center">
      <div className="max-w-md rounded-xl border bg-background p-8 shadow-sm">
        <Database className="mx-auto size-10 text-muted-foreground/60" />
        <h2 className="mt-4 text-lg font-semibold">
          {isError ? "Session을 불러오지 못했습니다" : "Session을 불러오는 중입니다"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {sessionLoadState.message}
        </p>
        {isError ? (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              onClick={onRetry}
              type="button"
            >
              Session을 다시 불러오기
            </button>
            <Link
              className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium"
              href="/sql-erd"
            >
              Session 목록으로
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type PanelToggleProps = {
  isOpen: boolean;
  onToggle: () => void;
};

type SourcePanelProps = PanelToggleProps & {
  canPreviewNormalizedSql: boolean;
  canRedoNormalizedSql: boolean;
  canUndoNormalizedSql: boolean;
  counts: ReturnType<typeof getSqltoerdModelCounts>;
  dialect: SqlErdViewSession["dialect"];
  isDialectSelectDisabled: boolean;
  isSourceTextReadOnly: boolean;
  onDialectChange: (dialect: SqltoerdDialect) => void;
  onPreviewNormalizedSql: () => void;
  onRedoNormalizedSql: () => void;
  onSourceTextChange: (sourceText: string) => void;
  onUndoNormalizedSql: () => void;
  sessionLoadState: SqlErdSessionLoadState;
  sourceText: string;
  resolvedDialect: SqltoerdResolvedDialect;
  relationSourceRanges: SqltoerdSourceRange[];
  width: number;
};

function SourcePanel({
  canPreviewNormalizedSql,
  canRedoNormalizedSql,
  canUndoNormalizedSql,
  counts,
  dialect,
  isOpen,
  isDialectSelectDisabled,
  isSourceTextReadOnly,
  onDialectChange,
  onPreviewNormalizedSql,
  onRedoNormalizedSql,
  onSourceTextChange,
  onToggle,
  onUndoNormalizedSql,
  sessionLoadState,
  sourceText,
  resolvedDialect,
  relationSourceRanges,
  width
}: SourcePanelProps) {
  if (!isOpen) {
    return <CollapsedSourcePanel onToggle={onToggle} />;
  }

  return (
    <aside
      className="flex shrink-0 flex-col border-r bg-muted/20"
      id="source"
      style={{ width }}
    >
      <div className="flex min-h-14 items-center justify-between gap-3 border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <SqlErdHomeNavigationButton />
          <SqlErdSessionListNavigationButton />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                SQL Source
              </p>
              <StatusPill
                label={sessionLoadState.label}
                tone={sessionLoadState.tone}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {counts.tableCount} tables / {counts.relationCount}{" "}
              relations
            </p>
          </div>
        </div>
        <button
          aria-label="Close source panel"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onToggle}
          type="button"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b p-3">
        <SelectorLabel label="Format" value="SQL" />
        <DialectSelect
          disabled={isDialectSelectDisabled}
          onChange={onDialectChange}
          value={dialect}
        />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Source text
          </span>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    aria-label="Undo normalized SQL change"
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    disabled={!canUndoNormalizedSql}
                    onClick={onUndoNormalizedSql}
                    type="button"
                  >
                    <Undo2 className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent>Undo SQL regeneration</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    aria-label="Redo normalized SQL change"
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    disabled={!canRedoNormalizedSql}
                    onClick={onRedoNormalizedSql}
                    type="button"
                  >
                    <Redo2 className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent>Redo SQL regeneration</TooltipContent>
            </Tooltip>
            <button
              className="inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              disabled={!canPreviewNormalizedSql}
              onClick={onPreviewNormalizedSql}
              type="button"
            >
              Regenerate SQL
            </button>
          </div>
        </div>
        <p
          aria-live="polite"
          className="border-b px-4 py-2 text-xs text-muted-foreground"
        >
          {sessionLoadState.message}
        </p>
        <SqlSourceEditor
          dialect={resolvedDialect}
          onChange={onSourceTextChange}
          readOnly={isSourceTextReadOnly}
          relationSourceRanges={relationSourceRanges}
          value={sourceText}
        />
      </div>
    </aside>
  );
}

function SqlErdHomeNavigationButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            aria-label="홈으로 이동"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/home"
          >
            <Home className="size-4" />
          </Link>
        }
      />
      <TooltipContent side="right">홈으로 이동</TooltipContent>
    </Tooltip>
  );
}

function SqlErdSessionListNavigationButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            aria-label="세션 목록으로 이동"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/sql-erd"
          >
            <ListIcon className="size-4" />
          </Link>
        }
      />
      <TooltipContent side="right">세션 목록으로 이동</TooltipContent>
    </Tooltip>
  );
}

function CollapsedSourcePanel({ onToggle }: { onToggle: () => void }) {
  return (
    <aside className="flex w-12 shrink-0 flex-col border-r bg-muted/20">
      <div className="flex min-h-24 flex-col items-center justify-center gap-1 border-b">
        <SqlErdHomeNavigationButton />
        <SqlErdSessionListNavigationButton />
      </div>
      <button
        aria-label="Open source panel"
        className="flex flex-col items-center gap-3 py-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={onToggle}
        type="button"
      >
        <PanelLeftOpen className="size-4" />
        <span className="text-xs font-medium [writing-mode:vertical-rl]">
          Source
        </span>
      </button>
    </aside>
  );
}

type SqlSourceEditorProps = {
  dialect: SqltoerdResolvedDialect;
  onChange: (sourceText: string) => void;
  readOnly: boolean;
  relationSourceRanges: SqltoerdSourceRange[];
  value: string;
};

function SqlSourceEditor({
  dialect,
  onChange,
  readOnly,
  relationSourceRanges,
  value
}: SqlSourceEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());
  const relationSourceCompartmentRef = useRef(new Compartment());
  const isApplyingExternalValueRef = useRef(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const languageCompartment = languageCompartmentRef.current;
    const readOnlyCompartment = readOnlyCompartmentRef.current;
    const relationSourceCompartment = relationSourceCompartmentRef.current;
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          languageCompartment.of(
            getSqlSourceEditorLanguageExtension(dialect)
          ),
          relationSourceCompartment.of(
            createSqlErdRelationSourceDecorationExtension(
              relationSourceRanges,
              value.length
            )
          ),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          sqlSourceEditorTheme,
          readOnlyCompartment.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly)
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || isApplyingExternalValueRef.current) {
              return;
            }

            onChangeRef.current(update.state.doc.toString());
          })
        ]
      })
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;

    if (!view || view.state.doc.toString() === value) {
      return;
    }

    isApplyingExternalValueRef.current = true;
    view.dispatch({
      changes: {
        from: 0,
        insert: value,
        to: view.state.doc.length
      }
    });
    isApplyingExternalValueRef.current = false;
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    view.dispatch({
      effects: relationSourceCompartmentRef.current.reconfigure(
        createSqlErdRelationSourceDecorationExtension(
          relationSourceRanges,
          view.state.doc.length
        )
      )
    });
  }, [relationSourceRanges]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: createSqlSourceEditorDialectReconfigureEffect(
        languageCompartmentRef.current,
        dialect
      )
    });
  }, [dialect]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly)
      ])
    });
  }, [readOnly]);

  return (
    <div
      aria-label="SQL source"
      className={cn(
        "min-h-0 flex-1 overflow-hidden border-0 bg-white text-slate-900",
        readOnly && "cursor-progress opacity-80"
      )}
      ref={containerRef}
    />
  );
}

function isSqltoerdDialect(value: string): value is SqltoerdDialect {
  return (
    value === "auto" ||
    value === "postgresql" ||
    value === "mysql" ||
    value === "sqlite"
  );
}

type DialectSelectProps = {
  disabled: boolean;
  onChange: (dialect: SqltoerdDialect) => void;
  value: SqltoerdDialect;
};

function DialectSelect({ disabled, onChange, value }: DialectSelectProps) {
  return (
    <label className="flex h-10 items-center justify-between gap-3 rounded-md border bg-background px-3 text-left">
      <span className="text-xs text-muted-foreground">Dialect</span>
      <select
        aria-label="SQL dialect"
        className="min-w-0 flex-1 bg-transparent text-right text-sm font-medium outline-none disabled:cursor-not-allowed disabled:text-muted-foreground"
        disabled={disabled}
        onChange={(event) => {
          if (isSqltoerdDialect(event.target.value)) {
            onChange(event.target.value);
          }
        }}
        value={value}
      >
        <option value="auto">Auto</option>
        <option value="postgresql">PostgreSQL</option>
        <option value="mysql">MySQL</option>
        <option value="sqlite">SQLite</option>
      </select>
    </label>
  );
}

type SelectorLabelProps = {
  label: string;
  value: string;
};

function SelectorLabel({ label, value }: SelectorLabelProps) {
  return (
    <button
      className="flex h-10 cursor-not-allowed items-center justify-between rounded-md border bg-muted/40 px-3 text-left text-muted-foreground opacity-75"
      disabled
      type="button"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </button>
  );
}

function clampPanelWidth(width: number, minWidth: number, maxWidth: number) {
  return Math.min(Math.max(width, minWidth), maxWidth);
}

type ResizablePanelMaxWidthInput = {
  containerWidth: number;
  maxWidth: number;
  minWidth: number;
  reservedWidth: number;
};

function getResizablePanelMaxWidth({
  containerWidth,
  maxWidth,
  minWidth,
  reservedWidth
}: ResizablePanelMaxWidthInput) {
  if (containerWidth <= 0) {
    return maxWidth;
  }

  const availablePanelWidth =
    containerWidth - reservedWidth - MIN_CANVAS_WIDTH;

  return Math.max(minWidth, Math.min(maxWidth, availablePanelWidth));
}

type PanelResizeHandleProps = {
  ariaLabel: string;
  maxWidth: number;
  minWidth: number;
  onWidthChange: (width: number) => void;
  side: "left" | "right";
  width: number;
};

function PanelResizeHandle({
  ariaLabel,
  maxWidth,
  minWidth,
  onWidthChange,
  side,
  width
}: PanelResizeHandleProps) {
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = width;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(moveEvent: PointerEvent) {
      const deltaX = moveEvent.clientX - startX;
      const nextWidth =
        side === "left" ? startWidth + deltaX : startWidth - deltaX;

      onWidthChange(clampPanelWidth(nextWidth, minWidth, maxWidth));
    }

    function stopResize() {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();

    const direction = event.key === "ArrowRight" ? 1 : -1;
    const signedDirection = side === "left" ? direction : -direction;
    const nextWidth = width + signedDirection * PANEL_RESIZE_KEYBOARD_STEP;

    onWidthChange(clampPanelWidth(nextWidth, minWidth, maxWidth));
  }

  return (
    <div
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemax={maxWidth}
      aria-valuemin={minWidth}
      aria-valuenow={width}
      className="group relative z-10 flex w-1 shrink-0 cursor-col-resize items-stretch justify-center outline-none transition-colors hover:bg-primary/10 focus-visible:bg-primary/20"
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      role="separator"
      tabIndex={0}
    >
      <div className="h-full w-px bg-border transition-colors group-hover:bg-primary/40" />
    </div>
  );
}

type CanvasShellProps = {
  agentTableFocus: SqlErdAgentTableFocus | null;
  autosavePausedBanner: LayoutAutosavePausedBannerViewModel | null;
  layoutJson: SqltoerdSessionPayload["layoutJson"];
  modelJson: SqltoerdSessionPayload["modelJson"];
  onLayoutPatch: (patch: SqltoerdLayoutPatch) => void;
  onReloadSession: () => void;
  onRetryLayoutAutosaveOnce: () => void;
  onSelectionChange: (selection: SqlErdSelection) => void;
  onShowAllTables: () => void;
  pinNavigationRequestId: number;
  pinnedTableId: string | null;
  realtimeConfig: SqlErdRealtimeConfig;
  isReadOnly: boolean;
  isSqlSourceOpen: boolean;
  selectedSqlErdObject: SqlErdSelection;
  sessionId: string;
};

function CanvasShell({
  agentTableFocus,
  autosavePausedBanner,
  layoutJson,
  modelJson,
  onLayoutPatch,
  onReloadSession,
  onRetryLayoutAutosaveOnce,
  onSelectionChange,
  onShowAllTables,
  pinNavigationRequestId,
  pinnedTableId,
  realtimeConfig,
  isReadOnly,
  isSqlSourceOpen,
  selectedSqlErdObject,
  sessionId
}: CanvasShellProps) {
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden" id="canvas">
      <SqlErdCanvas
        className="absolute inset-0"
        layoutJson={layoutJson}
        modelJson={modelJson}
        onLayoutPatch={onLayoutPatch}
        onSelectionChange={onSelectionChange}
        pinNavigationRequestId={pinNavigationRequestId}
        pinnedTableId={pinnedTableId}
        realtimeConfig={realtimeConfig}
        isReadOnly={isReadOnly}
        isSqlSourceOpen={isSqlSourceOpen}
        sessionId={sessionId}
        selectedSqlErdObject={selectedSqlErdObject}
        tableFocus={agentTableFocus}
      />
      {agentTableFocus || autosavePausedBanner ? (
        <div
          className="absolute left-4 top-4 z-30 flex max-w-[calc(100%-2rem)] flex-col items-start gap-2"
          data-sqltoerd-status-banners
        >
          {autosavePausedBanner ? (
            <AutosavePausedBanner
              banner={autosavePausedBanner}
              onReloadSession={onReloadSession}
              onRetryLayoutAutosaveOnce={onRetryLayoutAutosaveOnce}
            />
          ) : null}
          {agentTableFocus ? (
            <AgentTableFocusBanner
              focus={agentTableFocus}
              onShowAllTables={onShowAllTables}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AgentTableFocusBanner({
  focus,
  onShowAllTables
}: {
  focus: SqlErdAgentTableFocus;
  onShowAllTables: () => void;
}) {
  const confidenceLabel =
    focus.confidence === "high"
      ? "높음"
      : focus.confidence === "medium"
        ? "보통"
        : "낮음";

  return (
    <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-blue-200 bg-white/95 px-3 py-2 text-sm text-slate-700 shadow-lg backdrop-blur">
      <strong className="text-slate-950">{focus.featureLabel} 집중 보기</strong>
      <span>
        핵심 {focus.primaryTableIds.length} · 관련 {focus.relatedTableIds.length}
      </span>
      <span>신뢰도 {confidenceLabel}</span>
      <button
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={onShowAllTables}
        type="button"
      >
        전체 보기
      </button>
    </div>
  );
}

type AutosavePausedBannerProps = {
  banner: LayoutAutosavePausedBannerViewModel;
  onReloadSession: () => void;
  onRetryLayoutAutosaveOnce: () => void;
};

function AutosavePausedBanner({
  banner,
  onReloadSession,
  onRetryLayoutAutosaveOnce
}: AutosavePausedBannerProps) {
  return (
    <div className="max-w-md rounded-md border border-destructive/30 bg-background/95 p-3 text-sm shadow-md backdrop-blur">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-destructive">Autosave paused</p>
          <p className="mt-1 leading-5 text-muted-foreground">
            {banner.message}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {banner.canRetry ? (
            <button
              className="inline-flex h-8 items-center justify-center rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
              onClick={onRetryLayoutAutosaveOnce}
              type="button"
            >
              Retry once
            </button>
          ) : null}
          <button
            className="inline-flex h-8 items-center justify-center rounded-md bg-foreground px-3 text-xs font-medium text-background transition-colors hover:bg-foreground/90"
            onClick={onReloadSession}
            type="button"
          >
            Reload session
          </button>
        </div>
      </div>
    </div>
  );
}

type InspectorEmptyState = {
  sessionLoadState: SqlErdSessionLoadState;
  title: string;
};

type InspectorPanelProps = PanelToggleProps & {
  canAddForeignKey: boolean;
  emptyState: InspectorEmptyState;
  modelJson: SqltoerdModelJsonV1;
  onAddForeignKey: (input: {
    fromColumnId: string;
    fromTableId: string;
    toColumnId: string;
    toTableId: string;
  }) => SqltoerdForeignKeyAddResult | null;
  onConvertAnnotationToForeignKey: (input: {
    annotationId: string;
    labelDisposition: SqltoerdAnnotationLabelDisposition;
  }) => SqltoerdAnnotationForeignKeyConversionResult | null;
  onDeleteForeignKey: (input: {
    relationId: string;
  }) => SqltoerdForeignKeyEditResult | null;
  onClearTablePin: () => void;
  onNavigateToPinnedTable: () => void;
  onPinTable: () => void;
  onUpdateForeignKey: (input: {
    relationId: string;
    toColumnId: string;
    toTableId: string;
  }) => SqltoerdForeignKeyEditResult | null;
  pinnedTableId: string | null;
  pinnedTableTitle: string | null;
  viewModel: SqlErdInspectorViewModel;
  width: number;
};

function InspectorPanel({
  canAddForeignKey,
  emptyState,
  isOpen,
  modelJson,
  onAddForeignKey,
  onConvertAnnotationToForeignKey,
  onDeleteForeignKey,
  onClearTablePin,
  onNavigateToPinnedTable,
  onPinTable,
  onUpdateForeignKey,
  onToggle,
  pinnedTableId,
  pinnedTableTitle,
  viewModel,
  width
}: InspectorPanelProps) {
  const inspectorTitle = getInspectorTitle(viewModel);
  const inspectorSubtitle = getInspectorSubtitle(viewModel);

  if (!isOpen) {
    return (
      <CollapsedPanelButton
        ariaLabel="상세 정보 패널 열기"
        icon={<PanelRightOpen className="size-4" />}
        label="상세"
        onClick={onToggle}
        side="right"
      />
    );
  }

  return (
    <aside
      className="flex shrink-0 flex-col border-l bg-background"
      id="inspector"
      style={{ width }}
    >
      <div className="flex min-h-20 items-center justify-between gap-3 border-b px-6">
        <div className="min-w-0">
          <p className="text-xl font-semibold">{inspectorTitle}</p>
          {inspectorSubtitle ? (
            <p className="truncate text-base text-muted-foreground">
              {inspectorSubtitle}
            </p>
          ) : null}
        </div>
        <button
          aria-label="상세 정보 패널 닫기"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onToggle}
          type="button"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
        <InspectorContent
          canAddForeignKey={canAddForeignKey}
          emptyState={emptyState}
          modelJson={modelJson}
          onAddForeignKey={onAddForeignKey}
          onConvertAnnotationToForeignKey={onConvertAnnotationToForeignKey}
          onDeleteForeignKey={onDeleteForeignKey}
          onUpdateForeignKey={onUpdateForeignKey}
          viewModel={viewModel}
        />

        <div className="mt-auto grid gap-2">
          <button
            className="inline-flex h-11 cursor-not-allowed items-center justify-center rounded-md border bg-background px-3 text-lg font-medium text-muted-foreground opacity-70"
            disabled
            type="button"
          >
            Add column
          </button>
          <InspectorPinControl
            onClear={onClearTablePin}
            onNavigate={onNavigateToPinnedTable}
            onPin={onPinTable}
            pinnedTableId={pinnedTableId}
            pinnedTableTitle={pinnedTableTitle}
            viewModel={viewModel}
          />
        </div>
      </div>
    </aside>
  );
}

function InspectorPinControl({
  onClear,
  onNavigate,
  onPin,
  pinnedTableId,
  pinnedTableTitle,
  viewModel
}: {
  onClear: () => void;
  onNavigate: () => void;
  onPin: () => void;
  pinnedTableId: string | null;
  pinnedTableTitle: string | null;
  viewModel: SqlErdInspectorViewModel;
}) {
  const selectedTableId = viewModel.type === "table" ? viewModel.table.id : null;
  const isSelectedTablePinned = selectedTableId === pinnedTableId;

  if (selectedTableId) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <button
          className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 text-lg font-medium text-foreground transition-colors hover:bg-muted"
          onClick={onPin}
          type="button"
        >
          {isSelectedTablePinned ? (
            <LocateFixed className="size-4 shrink-0" />
          ) : (
            <MapPin className="size-4 shrink-0" />
          )}
          <span className="truncate">
            {isSelectedTablePinned
              ? "핀 위치로 이동"
              : pinnedTableId
                ? "이 테이블로 Pin 변경"
                : "Pin"}
          </span>
        </button>
        {isSelectedTablePinned ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  aria-label="Pin 해제"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={onClear}
                  type="button"
                >
                  <PinOff className="size-4" />
                </button>
              }
            />
            <TooltipContent>Pin 해제</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    );
  }

  if (!pinnedTableId || !pinnedTableTitle) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
      <MapPin className="size-4 shrink-0 text-primary" />
      <button
        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:underline"
        onClick={onNavigate}
        type="button"
      >
        {pinnedTableTitle}
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label="Pin 해제"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              onClick={onClear}
              type="button"
            >
              <PinOff className="size-4" />
            </button>
          }
        />
        <TooltipContent>Pin 해제</TooltipContent>
      </Tooltip>
    </div>
  );
}

function getInspectorTitle(viewModel: SqlErdInspectorViewModel) {
  if (viewModel.type === "table") {
    return "테이블 정보";
  }

  if (viewModel.type === "column") {
    return "컬럼 정보";
  }

  if (viewModel.type === "relation") {
    return "관계 정보";
  }

  if (viewModel.type === "annotation") {
    return "설명 관계";
  }

  return "상세 정보";
}

function getInspectorSubtitle(viewModel: SqlErdInspectorViewModel) {
  if (viewModel.type === "table") {
    return null;
  }

  if (viewModel.type === "column") {
    return `${getTableDisplayName(viewModel.table)}.${viewModel.column.name}`;
  }

  if (viewModel.type === "relation") {
    return "외래 키 관계";
  }

  if (viewModel.type === "annotation") {
    return "SQL에 반영되지 않음";
  }

  return "선택 없음";
}

function InspectorContent({
  canAddForeignKey,
  emptyState,
  modelJson,
  onAddForeignKey,
  onConvertAnnotationToForeignKey,
  onDeleteForeignKey,
  onUpdateForeignKey,
  viewModel
}: {
  canAddForeignKey: boolean;
  emptyState: InspectorEmptyState;
  modelJson: SqltoerdModelJsonV1;
  onAddForeignKey: (input: {
    fromColumnId: string;
    fromTableId: string;
    toColumnId: string;
    toTableId: string;
  }) => SqltoerdForeignKeyAddResult | null;
  onConvertAnnotationToForeignKey: (input: {
    annotationId: string;
    labelDisposition: SqltoerdAnnotationLabelDisposition;
  }) => SqltoerdAnnotationForeignKeyConversionResult | null;
  onDeleteForeignKey: (input: {
    relationId: string;
  }) => SqltoerdForeignKeyEditResult | null;
  onUpdateForeignKey: (input: {
    relationId: string;
    toColumnId: string;
    toTableId: string;
  }) => SqltoerdForeignKeyEditResult | null;
  viewModel: SqlErdInspectorViewModel;
}) {
  if (viewModel.type === "table") {
    return <TableInspector viewModel={viewModel} />;
  }

  if (viewModel.type === "column") {
    return (
      <ColumnInspector
        canAddForeignKey={canAddForeignKey}
        modelJson={modelJson}
        onAddForeignKey={onAddForeignKey}
        viewModel={viewModel}
      />
    );
  }

  if (viewModel.type === "relation") {
    return (
      <RelationInspector
        canEditForeignKey={canAddForeignKey}
        modelJson={modelJson}
        onDeleteForeignKey={onDeleteForeignKey}
        onUpdateForeignKey={onUpdateForeignKey}
        viewModel={viewModel}
      />
    );
  }

  if (viewModel.type === "annotation") {
    return (
      <AnnotationInspector
        canConvertAnnotationToForeignKey={canAddForeignKey}
        onConvertAnnotationToForeignKey={onConvertAnnotationToForeignKey}
        viewModel={viewModel}
      />
    );
  }

  return (
    <div className="rounded-md border border-dashed p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
            <Database className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{emptyState.title}</p>
            <p className="mt-1 text-base leading-7 text-muted-foreground">
              {emptyState.sessionLoadState.message}
            </p>
          </div>
        </div>
        <StatusPill
          label={emptyState.sessionLoadState.label}
          tone={emptyState.sessionLoadState.tone}
        />
      </div>
      <div className="mt-4 border-t pt-4">
        <p className="text-lg font-medium">선택 정보</p>
        <p className="mt-1 text-base leading-7 text-muted-foreground">
          선택한 테이블, 컬럼, 관계가 없습니다
        </p>
      </div>
    </div>
  );
}

function TableInspector({
  viewModel
}: {
  viewModel: Extract<SqlErdInspectorViewModel, { type: "table" }>;
}) {
  return (
    <>
      <InspectorSectionTitle>테이블 정보</InspectorSectionTitle>
      <div className="space-y-2">
        <InspectorRow label="테이블명" value={viewModel.title} />
        <InspectorRow label="컬럼" value={`${viewModel.columnCount}`} />
        <InspectorRow label="관계" value={`${viewModel.relations.length}`} />
      </div>
      <RelationList relations={viewModel.relations} />
    </>
  );
}

function ColumnInspector({
  canAddForeignKey,
  modelJson,
  onAddForeignKey,
  viewModel
}: {
  canAddForeignKey: boolean;
  modelJson: SqltoerdModelJsonV1;
  onAddForeignKey: (input: {
    fromColumnId: string;
    fromTableId: string;
    toColumnId: string;
    toTableId: string;
  }) => SqltoerdForeignKeyAddResult | null;
  viewModel: Extract<SqlErdInspectorViewModel, { type: "column" }>;
}) {
  const { column, table } = viewModel;
  const [isForeignKeyFormOpen, setIsForeignKeyFormOpen] = useState(false);
  const [foreignKeyAddError, setForeignKeyAddError] = useState<string | null>(
    null
  );
  const [targetTableId, setTargetTableId] = useState("");
  const [targetColumnId, setTargetColumnId] = useState("");
  const targetTables = modelJson.schema.tables.filter((candidateTable) =>
    getSqltoerdForeignKeyTargetColumns(candidateTable).some(
      (candidateColumn) =>
        candidateTable.id !== table.id || candidateColumn.id !== column.id
    )
  );
  const targetTable =
    targetTables.find((candidateTable) => candidateTable.id === targetTableId) ??
    null;
  const targetColumns = targetTable
    ? getSqltoerdForeignKeyTargetColumns(targetTable).filter(
        (candidateColumn) =>
          targetTable.id !== table.id || candidateColumn.id !== column.id
      )
    : [];

  useEffect(() => {
    setIsForeignKeyFormOpen(false);
    setForeignKeyAddError(null);
    setTargetTableId("");
    setTargetColumnId("");
  }, [column.id, table.id]);

  const handleTargetTableChange = (nextTargetTableId: string) => {
    setTargetTableId(nextTargetTableId);
    setTargetColumnId("");
    setForeignKeyAddError(null);
  };
  const handleForeignKeyAdd = () => {
    if (!targetTable || !targetColumnId) {
      setForeignKeyAddError("참조 테이블과 PK 또는 UQ 컬럼을 선택하세요.");
      return;
    }

    const result = onAddForeignKey({
      fromColumnId: column.id,
      fromTableId: table.id,
      toColumnId: targetColumnId,
      toTableId: targetTable.id
    });

    if (!result) {
      setForeignKeyAddError("현재 SQL을 Generate한 뒤 FK 관계를 추가하세요.");
      return;
    }

    if (!result.ok) {
      setForeignKeyAddError(
        getForeignKeyAddFailureMessage(result.reason)
      );
      return;
    }

    setForeignKeyAddError(null);
    setIsForeignKeyFormOpen(false);
  };

  return (
    <>
      <InspectorSectionTitle>컬럼 정보</InspectorSectionTitle>
      <div className="space-y-2">
        <InspectorRow label="테이블" value={getTableDisplayName(table)} />
        <InspectorRow label="컬럼명" value={column.name} />
        <InspectorRow label="컬럼 타입" value={column.dataType} />
        <InspectorRow label="NULL 허용" value={column.nullable ? "예" : "아니오"} />
      </div>
      <div className="flex flex-wrap gap-2">
        {column.primaryKey ? <ConstraintPill label="PK" /> : null}
        {column.foreignKey ? <ConstraintPill label="FK" /> : null}
        {column.unique ? <ConstraintPill label="UQ" /> : null}
        {!column.nullable ? <ConstraintPill label="NN" /> : null}
      </div>
      <RelationList relations={viewModel.relations} />
      <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-base font-medium">FK 관계</p>
          <button
            className="inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            disabled={!canAddForeignKey || targetTables.length === 0}
            onClick={() => {
              setForeignKeyAddError(null);
              setIsForeignKeyFormOpen((current) => !current);
            }}
            type="button"
          >
            FK 관계 추가
          </button>
        </div>
        {isForeignKeyFormOpen ? (
          <div className="space-y-3 border-t pt-3">
            <p className="text-sm text-muted-foreground">
              {getTableDisplayName(table)}.{column.name}에서 참조할 단일 PK 또는 UQ 컬럼을 선택하세요.
            </p>
            <label className="grid gap-1.5 text-sm font-medium">
              참조 테이블
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                onChange={(event) => handleTargetTableChange(event.target.value)}
                value={targetTableId}
              >
                <option value="">선택하세요</option>
                {targetTables.map((candidateTable) => (
                  <option key={candidateTable.id} value={candidateTable.id}>
                    {getTableDisplayName(candidateTable)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              참조 PK / UQ 컬럼
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!targetTable}
                onChange={(event) => {
                  setTargetColumnId(event.target.value);
                  setForeignKeyAddError(null);
                }}
                value={targetColumnId}
              >
                <option value="">선택하세요</option>
                {targetColumns.map((candidateColumn) => (
                  <option key={candidateColumn.id} value={candidateColumn.id}>
                    {candidateColumn.name} ({candidateColumn.dataType})
                  </option>
                ))}
              </select>
            </label>
            {foreignKeyAddError ? (
              <p className="text-sm leading-6 text-destructive">
                {foreignKeyAddError}
              </p>
            ) : null}
            {!canAddForeignKey ? (
              <p className="text-sm leading-6 text-muted-foreground">
                SQL을 Generate한 뒤 FK 관계를 추가할 수 있습니다.
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                className="inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
                onClick={() => setIsForeignKeyFormOpen(false)}
                type="button"
              >
                취소
              </button>
              <button
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
                disabled={!canAddForeignKey || !targetTable || !targetColumnId}
                onClick={handleForeignKeyAdd}
                type="button"
              >
                SQL 변경 미리 보기
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function getForeignKeyAddFailureMessage(
  reason: SqltoerdForeignKeyAddFailureReason
) {
  if (reason === "duplicate_relation") {
    return "같은 방향의 FK 관계가 이미 있습니다.";
  }

  if (reason === "incompatible_column_type") {
    return "두 컬럼의 타입이 호환되지 않습니다.";
  }

  if (reason === "same_endpoint") {
    return "같은 컬럼을 참조 대상으로 선택할 수 없습니다.";
  }

  if (reason === "source_column_already_has_foreign_key") {
    return "이 컬럼에는 이미 다른 FK 관계가 있습니다.";
  }

  if (reason === "target_column_not_key") {
    return "참조 대상은 단일 PK 또는 UQ 컬럼이어야 합니다.";
  }

  return "선택한 FK 관계를 만들 수 없습니다.";
}

function getAnnotationForeignKeyConversionFailureMessage(
  reason: SqltoerdAnnotationForeignKeyConversionFailureReason
) {
  if (reason === "annotation_not_found") {
    return "선택한 설명 관계를 찾을 수 없습니다. Canvas를 다시 확인하세요.";
  }

  if (reason === "annotation_not_column_link") {
    return "컬럼 설명 관계만 FK로 전환할 수 있습니다.";
  }

  return getForeignKeyAddFailureMessage(reason);
}

function getForeignKeyEditFailureMessage(
  reason: SqltoerdForeignKeyEditFailureReason
) {
  if (reason === "relation_not_found") {
    return "선택한 FK 관계를 찾을 수 없습니다. Canvas를 다시 확인하세요.";
  }

  if (reason === "unchanged_relation") {
    return "현재 참조 대상과 다른 PK 또는 UQ 컬럼을 선택하세요.";
  }

  if (reason === "unsupported_composite_relation") {
    return "복합 FK의 수정과 삭제는 아직 지원하지 않습니다.";
  }

  return getForeignKeyAddFailureMessage(reason);
}

function RelationInspector({
  canEditForeignKey,
  modelJson,
  onDeleteForeignKey,
  onUpdateForeignKey,
  viewModel
}: {
  canEditForeignKey: boolean;
  modelJson: SqltoerdModelJsonV1;
  onDeleteForeignKey: (input: {
    relationId: string;
  }) => SqltoerdForeignKeyEditResult | null;
  onUpdateForeignKey: (input: {
    relationId: string;
    toColumnId: string;
    toTableId: string;
  }) => SqltoerdForeignKeyEditResult | null;
  viewModel: Extract<SqlErdInspectorViewModel, { type: "relation" }>;
}) {
  const { cardinality, endpoints, relation, relationNote } = viewModel;
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [foreignKeyEditError, setForeignKeyEditError] = useState<string | null>(
    null
  );
  const [targetTableId, setTargetTableId] = useState("");
  const [targetColumnId, setTargetColumnId] = useState("");
  const supportsSingleColumnEdit =
    relation.fromColumnIds.length === 1 && relation.toColumnIds.length === 1;
  const targetTables = modelJson.schema.tables.filter((candidateTable) =>
    getSqltoerdForeignKeyTargetColumns(candidateTable).length > 0
  );
  const targetTable =
    targetTables.find((candidateTable) => candidateTable.id === targetTableId) ??
    null;
  const targetColumns = targetTable
    ? getSqltoerdForeignKeyTargetColumns(targetTable)
    : [];

  useEffect(() => {
    setForeignKeyEditError(null);
    setIsDeleteDialogOpen(false);
    setIsEditOpen(false);
    setTargetColumnId("");
    setTargetTableId("");
  }, [relation.id]);

  const handleTargetTableChange = (nextTargetTableId: string) => {
    setForeignKeyEditError(null);
    setTargetColumnId("");
    setTargetTableId(nextTargetTableId);
  };
  const handleForeignKeyUpdate = () => {
    if (!targetTable || !targetColumnId) {
      setForeignKeyEditError("참조 테이블과 PK 또는 UQ 컬럼을 선택하세요.");
      return;
    }

    const result = onUpdateForeignKey({
      relationId: relation.id,
      toColumnId: targetColumnId,
      toTableId: targetTable.id
    });

    if (!result) {
      setForeignKeyEditError("현재 SQL을 Generate한 뒤 FK 관계를 수정하세요.");
      return;
    }

    if (!result.ok) {
      setForeignKeyEditError(getForeignKeyEditFailureMessage(result.reason));
      return;
    }

    setForeignKeyEditError(null);
    setIsEditOpen(false);
  };
  const handleForeignKeyDelete = () => {
    const result = onDeleteForeignKey({ relationId: relation.id });

    if (!result) {
      setForeignKeyEditError("현재 SQL을 Generate한 뒤 FK 관계를 삭제하세요.");
      return;
    }

    if (!result.ok) {
      setForeignKeyEditError(getForeignKeyEditFailureMessage(result.reason));
      return;
    }

    setForeignKeyEditError(null);
    setIsDeleteDialogOpen(false);
  };

  return (
    <>
      <InspectorSectionTitle>관계 정보</InspectorSectionTitle>
      <div className="space-y-2">
        <InspectorRow label="종류" value="foreign key" />
        <InspectorRow label="제약 조건" value={relation.constraintName ?? "-"} />
        <InspectorRow
          label="참조 컬럼"
          value={
            endpoints
              ? formatSqlErdRelationEndpoint(
                  endpoints.from.table,
                  endpoints.from.columns
                )
              : relation.fromTableId
          }
        />
        <InspectorRow
          label="대상 컬럼"
          value={
            endpoints
              ? formatSqlErdRelationEndpoint(
                  endpoints.to.table,
                  endpoints.to.columns
                )
              : relation.toTableId
          }
        />
        {cardinality ? (
          <InspectorRow
            label="관계 의미"
            value={formatSqlErdRelationCardinalityMeaning(cardinality)}
          />
        ) : null}
        {relationNote ? <InspectorRow label="메모" value={relationNote} /> : null}
      </div>
      <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-base font-medium">FK 관계 관리</p>
          <button
            className="inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            disabled={!canEditForeignKey || !supportsSingleColumnEdit}
            onClick={() => {
              setForeignKeyEditError(null);
              setIsEditOpen((current) => !current);
            }}
            type="button"
          >
            참조 대상 변경
          </button>
        </div>
        {!supportsSingleColumnEdit ? (
          <p className="text-sm leading-6 text-muted-foreground">
            복합 FK의 수정과 삭제는 후속 기능에서 지원합니다.
          </p>
        ) : null}
        {isEditOpen ? (
          <div className="space-y-3 border-t pt-3">
            <p className="text-sm text-muted-foreground">
              참조 대상 PK 또는 UQ 컬럼을 변경한 뒤 SQL diff를 검토하세요.
            </p>
            <label className="grid gap-1.5 text-sm font-medium">
              참조 테이블
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                onChange={(event) => handleTargetTableChange(event.target.value)}
                value={targetTableId}
              >
                <option value="">선택하세요</option>
                {targetTables.map((candidateTable) => (
                  <option key={candidateTable.id} value={candidateTable.id}>
                    {getTableDisplayName(candidateTable)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              참조 PK / UQ 컬럼
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!targetTable}
                onChange={(event) => {
                  setForeignKeyEditError(null);
                  setTargetColumnId(event.target.value);
                }}
                value={targetColumnId}
              >
                <option value="">선택하세요</option>
                {targetColumns.map((candidateColumn) => (
                  <option key={candidateColumn.id} value={candidateColumn.id}>
                    {candidateColumn.name} ({candidateColumn.dataType})
                  </option>
                ))}
              </select>
            </label>
            {foreignKeyEditError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                {foreignKeyEditError}
              </p>
            ) : null}
            <button
              className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              disabled={!canEditForeignKey}
              onClick={handleForeignKeyUpdate}
              type="button"
            >
              SQL diff 보기
            </button>
          </div>
        ) : null}
      </div>
      <div className="space-y-2 rounded-md border border-destructive/30 p-3">
        <p className="text-base font-medium text-destructive">FK 삭제</p>
        <p className="text-sm leading-6 text-muted-foreground">
          참조 제약 조건을 제거하고 SQL source와 Canvas를 다시 생성합니다.
        </p>
        {foreignKeyEditError && !isEditOpen ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
            {foreignKeyEditError}
          </p>
        ) : null}
        <button
          className="inline-flex h-9 w-full items-center justify-center rounded-md border border-destructive/40 px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/5 disabled:pointer-events-none disabled:opacity-50"
          disabled={!canEditForeignKey || !supportsSingleColumnEdit}
          onClick={() => {
            setForeignKeyEditError(null);
            setIsDeleteDialogOpen(true);
          }}
          type="button"
        >
          FK 삭제
        </button>
      </div>
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>FK 관계를 삭제할까요?</DialogTitle>
            <DialogDescription>
              {endpoints
                ? `${formatSqlErdRelationEndpoint(
                    endpoints.from.table,
                    endpoints.from.columns
                  )} -> ${formatSqlErdRelationEndpoint(
                    endpoints.to.table,
                    endpoints.to.columns
                  )}`
                : relation.id}
              의 참조 제약 조건이 SQL source에서 제거됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <button
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium"
              onClick={() => setIsDeleteDialogOpen(false)}
              type="button"
            >
              취소
            </button>
            <button
              className="inline-flex h-9 items-center rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground"
              onClick={handleForeignKeyDelete}
              type="button"
            >
              삭제 후 SQL diff 보기
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AnnotationInspector({
  canConvertAnnotationToForeignKey,
  onConvertAnnotationToForeignKey,
  viewModel
}: {
  canConvertAnnotationToForeignKey: boolean;
  onConvertAnnotationToForeignKey: (input: {
    annotationId: string;
    labelDisposition: SqltoerdAnnotationLabelDisposition;
  }) => SqltoerdAnnotationForeignKeyConversionResult | null;
  viewModel: Extract<SqlErdInspectorViewModel, { type: "annotation" }>;
}) {
  const isTableLink = viewModel.annotation.kind === "table_link";
  const [isConversionDialogOpen, setIsConversionDialogOpen] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [labelDisposition, setLabelDisposition] =
    useState<SqltoerdAnnotationLabelDisposition>("preserve_as_relation_note");

  useEffect(() => {
    setConversionError(null);
    setIsConversionDialogOpen(false);
    setLabelDisposition("preserve_as_relation_note");
  }, [viewModel.annotation.id]);

  const handleConvertToForeignKey = () => {
    const result = onConvertAnnotationToForeignKey({
      annotationId: viewModel.annotation.id,
      labelDisposition
    });

    if (!result) {
      setConversionError("현재 SQL을 Generate한 뒤 FK로 전환하세요.");
      return;
    }

    if (!result.ok) {
      setConversionError(
        getAnnotationForeignKeyConversionFailureMessage(result.reason)
      );
      return;
    }

    setConversionError(null);
    setIsConversionDialogOpen(false);
  };

  return (
    <>
      <InspectorSectionTitle>설명 관계</InspectorSectionTitle>
      <div className="space-y-2">
        <InspectorRow
          label="종류"
          value={isTableLink ? "테이블 설명 관계" : "컬럼 설명 관계"}
        />
        <InspectorRow label="설명" value={viewModel.annotation.label || "-"} />
        <InspectorRow label="시작" value={viewModel.fromLabel} />
        <InspectorRow label="끝" value={viewModel.toLabel} />
      </div>
      <p className="rounded-md border border-dashed p-4 text-base leading-7 text-muted-foreground">
        SQL에 반영되지 않는 사용자 설명 관계입니다.
      </p>
      {!isTableLink ? (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-base font-medium">FK 전환</p>
          <p className="text-sm leading-6 text-muted-foreground">
            endpoint 유효성을 확인한 뒤 SQL diff에서 승인하면 실제 FK로 바뀝니다.
          </p>
          {conversionError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
              {conversionError}
            </p>
          ) : null}
          <button
            className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            disabled={!canConvertAnnotationToForeignKey}
            onClick={() => {
              setConversionError(null);
              setIsConversionDialogOpen(true);
            }}
            type="button"
          >
            FK로 전환
          </button>
        </div>
      ) : null}
      <Dialog
        open={isConversionDialogOpen}
        onOpenChange={setIsConversionDialogOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>FK로 전환할까요?</DialogTitle>
            <DialogDescription>
              설명 관계는 Apply 전까지 유지됩니다. SQL diff를 승인하면 설명선이 실제 FK로 교체됩니다.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">설명 label 처리</legend>
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                checked={labelDisposition === "preserve_as_relation_note"}
                name={`annotation-label-${viewModel.annotation.id}`}
                onChange={() => setLabelDisposition("preserve_as_relation_note")}
                type="radio"
              />
              <span>
                <span className="block font-medium">관계 메모로 보관</span>
                <span className="block text-muted-foreground">
                  label을 새 FK의 상세보기 메모로 보관합니다.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                checked={labelDisposition === "discard"}
                name={`annotation-label-${viewModel.annotation.id}`}
                onChange={() => setLabelDisposition("discard")}
                type="radio"
              />
              <span>
                <span className="block font-medium">설명 삭제</span>
                <span className="block text-muted-foreground">
                  기존 label을 보관하지 않습니다.
                </span>
              </span>
            </label>
          </fieldset>
          {conversionError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
              {conversionError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium"
              onClick={() => setIsConversionDialogOpen(false)}
              type="button"
            >
              취소
            </button>
            <button
              className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
              onClick={handleConvertToForeignKey}
              type="button"
            >
              SQL diff 보기
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatSqlErdRelationCardinalityMeaning(
  cardinality: SqlErdRelationCardinalityEndpoints
) {
  return `자식 행은 부모 ${formatSqlErdCardinality(cardinality.to)}, 부모 행은 자식 ${formatSqlErdCardinality(cardinality.from)}`;
}

function formatSqlErdCardinality(cardinality: SqlErdRelationCardinality) {
  if (cardinality === "one") {
    return "1개";
  }

  if (cardinality === "zero_or_one") {
    return "0~1개";
  }

  return "0~N개";
}

function RelationList({ relations }: { relations: RelationSummary[] }) {
  if (!relations.length) {
    return (
      <div>
        <InspectorSectionTitle>연결 관계</InspectorSectionTitle>
        <p className="rounded-md border border-dashed p-4 text-base leading-7 text-muted-foreground">
          연결된 관계가 없습니다
        </p>
      </div>
    );
  }

  return (
    <div>
      <InspectorSectionTitle>연결 관계</InspectorSectionTitle>
      <div className="space-y-2">
        {relations.map((relation) => (
          <div
            className="rounded-md border bg-background p-4 text-base leading-7"
            key={relation.id}
          >
            <p className="font-medium text-foreground">{relation.fromLabel}</p>
            <p className="text-muted-foreground">-&gt; {relation.toLabel}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConstraintPill({ label }: { label: string }) {
  return (
    <span className="inline-flex h-9 items-center rounded-md border bg-muted/40 px-3 text-base font-semibold text-muted-foreground">
      {label}
    </span>
  );
}

function InspectorSectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-base font-semibold text-muted-foreground">
      {children}
    </p>
  );
}

type InspectorRowProps = {
  label: string;
  value: string;
};

function InspectorRow({ label, value }: InspectorRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-3 text-lg">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all text-right font-medium">{value}</span>
    </div>
  );
}

type CollapsedPanelButtonProps = {
  ariaLabel: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  side?: "left" | "right";
};

function CollapsedPanelButton({
  ariaLabel,
  icon,
  label,
  onClick,
  side = "left"
}: CollapsedPanelButtonProps) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        "flex w-12 shrink-0 flex-col items-center gap-3 bg-muted/20 py-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        side === "right" ? "border-l" : "border-r"
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span className="text-xs font-medium [writing-mode:vertical-rl]">
        {label}
      </span>
    </button>
  );
}

type StatusPillProps = {
  label: string;
  tone: SqlErdSessionLoadState["tone"];
};

function StatusPill({ label, tone }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium",
        tone === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "error" && "border-red-200 bg-red-50 text-red-700",
        tone === "neutral" && "border-border bg-background text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}
