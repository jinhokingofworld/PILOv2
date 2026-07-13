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
import {
  createSqlErdApiClient,
  SqlErdApiError
} from "@/features/sql-erd/api/client";
import { SqlErdCanvas } from "@/features/sql-erd/components/sql-erd-canvas";
import type {
  SqlErdSelection,
  SqltoerdDialect,
  SqltoerdLayoutJsonV1,
  SqltoerdModelJsonV1,
  SqltoerdResolvedDialect,
  SqltoerdSessionPayload
} from "@/features/sql-erd/types";
import {
  completeSqlErdAutosave,
  createWorkspaceSqlErdViewSession,
  getLayoutAutosaveBlockReasonForStatus,
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
  createSqlErdForeignKeyAddCandidate,
  getSqltoerdForeignKeyTargetColumns,
  type SqltoerdForeignKeyAddResult,
  type SqltoerdForeignKeyAddFailureReason
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
  revision: null,
  title: "Untitled ERD",
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

function getLayoutAutosaveBlockReason(
  error: unknown
): LayoutAutosaveBlockReason | null {
  return getLayoutAutosaveBlockReasonForStatus(
    error instanceof SqlErdApiError ? error.status : undefined
  );
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
        sqlErdViewSession.layoutJson.annotations
      ),
    [modelIndex, selectedSqlErdObject, sqlErdViewSession.layoutJson.annotations]
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
    setSqlSourceMap(null);
    setNormalizedSqlPreview(null);
    setNormalizedSqlApplyError(null);
    setModelSqlHistory(createSqlErdModelSqlHistory());
    applySqlErdEditAction({
      sourceText,
      type: "draft_source_changed"
    });
  }, [applySqlErdEditAction]);
  const handleDialectChange = useCallback((dialect: SqltoerdDialect) => {
    setSqlSourceMap(null);
    setNormalizedSqlPreview(null);
    setNormalizedSqlApplyError(null);
    setModelSqlHistory(createSqlErdModelSqlHistory());
    applySqlErdEditAction({
      dialect,
      type: "draft_dialect_changed"
    });
  }, [applySqlErdEditAction]);
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
      if (!baseSnapshot.id || isNormalizedSqlApplying) {
        return;
      }

      const requestSequence =
        sqlErdEditStateRef.current.parse.requestSequence + 1;
      setIsNormalizedSqlApplying(true);
      setNormalizedSqlApplyError(null);

      void runSqlErdParseWorker({
        dialect: targetSnapshot.dialect,
        previousLayoutJson: baseSnapshot.layoutJson,
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
              "The session changed while SQL was being applied. Create a new preview and try again."
            );
          }
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

    if (!resolvedDialect || isSqlErdDraftDirty(sqlErdEditStateRef.current)) {
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
  }, [lastResolvedDialect]);
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
        !resolvedDialect ||
        isNormalizedSqlApplying ||
        isSqlErdDraftDirty(sqlErdEditStateRef.current)
      ) {
        return null;
      }

      const candidate = createSqlErdForeignKeyAddCandidate({
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
    [isNormalizedSqlApplying, lastResolvedDialect]
  );
  const handleApplyNormalizedSql = useCallback(() => {
    if (
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
        "The session changed while the preview was open. Create a new preview before applying it."
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
        sourceText: normalizedSqlPreview.generatedSourceText
      }
    });
  }, [
    applyNormalizedSqlSnapshot,
    isNormalizedSqlApplying,
    normalizedSqlPreview
  ]);
  const handleUndoNormalizedSql = useCallback(() => {
    if (isNormalizedSqlApplying) {
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
  }, [applyNormalizedSqlSnapshot, isNormalizedSqlApplying, modelSqlHistory]);
  const handleRedoNormalizedSql = useCallback(() => {
    if (isNormalizedSqlApplying) {
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
  }, [applyNormalizedSqlSnapshot, isNormalizedSqlApplying, modelSqlHistory]);
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
  const handleRetryLayoutAutosaveOnce = useCallback(() => {
    if (!pendingLayoutAutosaveJson && !pendingSourceAutosaveSnapshot) {
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
    sourceAutosaveRetryAttempt,
    tryBeginAutosave
  ]);

  useEffect(() => {
    if (
      !pendingLayoutAutosaveJson ||
      !accessToken ||
      !activeWorkspaceId ||
      !sqlErdViewSession.id ||
      layoutAutosaveBlockReason
    ) {
      return;
    }

    const requestLayoutJson = pendingLayoutAutosaveJson;
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
    sqlErdViewSession.id,
    tryBeginAutosave
  ]);

  useEffect(() => {
    setIsSourceOpen(window.matchMedia("(min-width: 1024px)").matches);
    setIsInspectorOpen(window.matchMedia("(min-width: 1280px)").matches);
  }, []);

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
          !isNormalizedSqlApplying &&
          !isSqlErdDraftDirty(sqlErdEditState) &&
          (lastResolvedDialect !== null ||
            sqlErdEditState.draftDialect !== "auto")
        }
        canRedoNormalizedSql={
          !isNormalizedSqlApplying && modelSqlHistory.future.length > 0
        }
        canUndoNormalizedSql={
          !isNormalizedSqlApplying && modelSqlHistory.past.length > 0
        }
        counts={sessionCounts}
        dialect={sqlErdEditState.draftDialect}
        isOpen={isSourceOpen}
        isDialectSelectDisabled={!isSessionReady}
        onDialectChange={handleDialectChange}
        onPreviewNormalizedSql={handlePreviewNormalizedSql}
        onRedoNormalizedSql={handleRedoNormalizedSql}
        onSourceTextChange={handleSourceTextChange}
        onToggle={() => setIsSourceOpen((current) => !current)}
        onUndoNormalizedSql={handleUndoNormalizedSql}
        sessionLoadState={sourceStatus}
        isSourceTextReadOnly={!isSessionReady}
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
          autosavePausedBanner={layoutAutosavePausedBanner}
          layoutJson={sqlErdViewSession.layoutJson}
          modelJson={sqlErdViewSession.modelJson}
          onLayoutChange={handleLayoutChange}
          onReloadSession={handleReloadPausedSession}
          onRetryLayoutAutosaveOnce={handleRetryLayoutAutosaveOnce}
          onSelectionChange={setSelectedSqlErdObject}
          pinNavigationRequestId={tablePinState.navigationRequestId}
          pinnedTableId={tablePinState.pinnedTableId}
          selectedSqlErdObject={selectedSqlErdObject}
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
        onClearTablePin={handleClearTablePin}
        onNavigateToPinnedTable={handleNavigateToPinnedTable}
        onPinTable={handlePinTable}
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
  onApply,
  onOpenChange,
  preview
}: {
  error: string | null;
  isApplying: boolean;
  onApply: () => void;
  onOpenChange: (open: boolean) => void;
  preview: SqlErdNormalizedSqlPreview | null;
}) {
  return (
    <Dialog open={preview !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl" showCloseButton={!isApplying}>
        <DialogHeader>
          <DialogTitle>Apply SQL changes</DialogTitle>
          <DialogDescription>
            Review the generated SQL before replacing the current source.
          </DialogDescription>
        </DialogHeader>
        {preview ? (
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
            The generated SQL matches the current source.
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
            Cancel
          </button>
          <button
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
            disabled={!preview || !preview.hasChanges || isApplying}
            onClick={onApply}
            type="button"
          >
            {isApplying ? "Applying" : "Apply SQL changes"}
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
  return value === "auto" || value === "postgresql" || value === "mysql";
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
  autosavePausedBanner: LayoutAutosavePausedBannerViewModel | null;
  layoutJson: SqltoerdSessionPayload["layoutJson"];
  modelJson: SqltoerdSessionPayload["modelJson"];
  onLayoutChange: (layoutJson: SqltoerdLayoutJsonV1) => void;
  onReloadSession: () => void;
  onRetryLayoutAutosaveOnce: () => void;
  onSelectionChange: (selection: SqlErdSelection) => void;
  pinNavigationRequestId: number;
  pinnedTableId: string | null;
  selectedSqlErdObject: SqlErdSelection;
};

function CanvasShell({
  autosavePausedBanner,
  layoutJson,
  modelJson,
  onLayoutChange,
  onReloadSession,
  onRetryLayoutAutosaveOnce,
  onSelectionChange,
  pinNavigationRequestId,
  pinnedTableId,
  selectedSqlErdObject
}: CanvasShellProps) {
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden" id="canvas">
      <SqlErdCanvas
        className="absolute inset-0"
        layoutJson={layoutJson}
        modelJson={modelJson}
        onLayoutChange={onLayoutChange}
        onSelectionChange={onSelectionChange}
        pinNavigationRequestId={pinNavigationRequestId}
        pinnedTableId={pinnedTableId}
        selectedSqlErdObject={selectedSqlErdObject}
      />
      {autosavePausedBanner ? (
        <AutosavePausedBanner
          banner={autosavePausedBanner}
          onReloadSession={onReloadSession}
          onRetryLayoutAutosaveOnce={onRetryLayoutAutosaveOnce}
        />
      ) : null}
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
    <div className="absolute left-4 top-4 z-20 max-w-md rounded-md border border-destructive/30 bg-background/95 p-3 text-sm shadow-md backdrop-blur">
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
  onClearTablePin: () => void;
  onNavigateToPinnedTable: () => void;
  onPinTable: () => void;
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
  onClearTablePin,
  onNavigateToPinnedTable,
  onPinTable,
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
    return <RelationInspector viewModel={viewModel} />;
  }

  if (viewModel.type === "annotation") {
    return <AnnotationInspector viewModel={viewModel} />;
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

function RelationInspector({
  viewModel
}: {
  viewModel: Extract<SqlErdInspectorViewModel, { type: "relation" }>;
}) {
  const { cardinality, endpoints, relation } = viewModel;

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
      </div>
    </>
  );
}

function AnnotationInspector({
  viewModel
}: {
  viewModel: Extract<SqlErdInspectorViewModel, { type: "annotation" }>;
}) {
  const isTableLink = viewModel.annotation.kind === "table_link";

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
