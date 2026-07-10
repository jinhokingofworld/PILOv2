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
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play
} from "lucide-react";

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
import { commerceSqltoerdFixture } from "@/features/sql-erd/fixtures/commerce";
import type {
  SqlErdSelection,
  SqltoerdDialect,
  SqltoerdLayoutJsonV1,
  SqltoerdResolvedDialect,
  SqltoerdSessionPayload
} from "@/features/sql-erd/types";
import {
  createSampleSqlErdViewSession,
  createWorkspaceSqlErdViewSession,
  getLayoutAutosaveBlockReasonForStatus,
  getLayoutAutosaveDelayMs,
  getLayoutAutosavePausedBanner,
  getSqlErdSessionReloadFailureAction,
  isLayoutAutosaveTransientStatus,
  shouldApplySqlErdSessionLoadResult,
  type LayoutAutosaveBlockReason,
  type LayoutAutosavePausedBannerViewModel,
  type SqlErdSessionLoadState,
  type SqlErdViewSession
} from "@/features/sql-erd/utils/session-state";
import {
  createSqlErdInspectorViewModel,
  formatSqlErdRelationEndpoint,
  type RelationSummary,
  type SqlErdInspectorViewModel
} from "@/features/sql-erd/utils/inspector";
import { parseSqlDdlToErdModel } from "@/features/sql-erd/utils/ddl-parser";
import {
  areSqltoerdLayoutsEqual,
  createSqltoerdModelIndex,
  getSqltoerdModelCounts,
  getTableDisplayName,
  type SqlErdRelationCardinality,
  type SqlErdRelationCardinalityEndpoints
} from "@/features/sql-erd/utils/model";
import { createSqlErdGenerateWorkspaceRequest } from "@/features/sql-erd/utils/generate-session";
import { createSqlErdLayoutAutosaveRequest } from "@/features/sql-erd/utils/layout-autosave";
import {
  getSqlErdGenerateErrorMessage,
  getSqlErdSignInRequiredState,
  getSqlErdWorkspaceSaveErrorState
} from "@/features/sql-erd/utils/status-copy";
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
import { cn } from "@/lib/utils";

const sampleSqlErdViewSession = createSampleSqlErdViewSession(
  commerceSqltoerdFixture
);
const sampleSqlErdParseResult = parseSqlDdlToErdModel({
  dialect: sampleSqlErdViewSession.dialect,
  sourceText: sampleSqlErdViewSession.sourceText
});
const sampleSqlErdSourceMap = sampleSqlErdParseResult.ok
  ? sampleSqlErdParseResult.sourceMap
  : null;

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

export function SqlErdPanel() {
  const authSession = useAuthSession();
  const activeWorkspaceId = authSession?.activeWorkspaceId ?? null;
  const accessToken = authSession?.accessToken ?? null;
  const panelContainerRef = useRef<HTMLElement | null>(null);
  const manualLayoutAutosaveRetryRef = useRef(false);
  const sessionLoadRequestIdRef = useRef(0);
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [panelContainerWidth, setPanelContainerWidth] = useState(0);
  const [sourcePanelWidth, setSourcePanelWidth] = useState(
    SOURCE_PANEL_DEFAULT_WIDTH
  );
  const [inspectorPanelWidth, setInspectorPanelWidth] = useState(
    INSPECTOR_PANEL_DEFAULT_WIDTH
  );
  const [sqlErdViewSession, setSqlErdViewSession] = useState<SqlErdViewSession>(
    sampleSqlErdViewSession
  );
  const [sessionLoadState, setSessionLoadState] =
    useState<SqlErdSessionLoadState>({
      label: "Sample",
      message: "Built-in sample ERD",
      tone: "neutral"
    });
  const [selectedSqlErdObject, setSelectedSqlErdObject] =
    useState<SqlErdSelection>({ type: "none" });
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingLayoutAutosaveJson, setPendingLayoutAutosaveJson] =
    useState<SqltoerdLayoutJsonV1 | null>(null);
  const [layoutAutosaveRetryAttempt, setLayoutAutosaveRetryAttempt] =
    useState(0);
  const [layoutAutosaveBlockReason, setLayoutAutosaveBlockReason] =
    useState<LayoutAutosaveBlockReason | null>(null);
  const [lastResolvedDialect, setLastResolvedDialect] =
    useState<SqltoerdResolvedDialect | null>(null);
  const [sqlSourceMap, setSqlSourceMap] =
    useState<SqltoerdSourceMap | null>(sampleSqlErdSourceMap);
  const sourceEditorDialect = resolveSqlSourceEditorDialect(
    sqlErdViewSession.dialect,
    lastResolvedDialect
  );
  const selectedRelationSourceRanges = useMemo(
    () =>
      getSelectedSqlErdRelationSourceRanges({
        selection: selectedSqlErdObject,
        sourceMap: sqlSourceMap,
        sourceText: sqlErdViewSession.sourceText
      }),
    [selectedSqlErdObject, sqlErdViewSession.sourceText, sqlSourceMap]
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
    () => createSqlErdInspectorViewModel(selectedSqlErdObject, modelIndex),
    [modelIndex, selectedSqlErdObject]
  );
  const handleSourceTextChange = useCallback((sourceText: string) => {
    setSqlSourceMap(null);
    setSqlErdViewSession((currentSession) => ({
      ...currentSession,
      sourceText
    }));
  }, []);
  const handleDialectChange = useCallback((dialect: SqltoerdDialect) => {
    setSqlSourceMap(null);
    setSqlErdViewSession((currentSession) => ({
      ...currentSession,
      dialect
    }));
  }, []);
  const handleLayoutChange = useCallback(
    (layoutJson: SqltoerdLayoutJsonV1) => {
      setSqlErdViewSession((currentSession) => {
        if (areSqltoerdLayoutsEqual(currentSession.layoutJson, layoutJson)) {
          return currentSession;
        }

        return {
          ...currentSession,
          layoutJson
        };
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
      layoutAutosaveBlockReason,
      sqlErdViewSession.id,
      sqlErdViewSession.revision
    ]
  );
  const handleRetryLayoutAutosaveOnce = useCallback(() => {
    if (!pendingLayoutAutosaveJson) {
      return;
    }

    manualLayoutAutosaveRetryRef.current = true;
    setLayoutAutosaveBlockReason(null);
    setLayoutAutosaveRetryAttempt(0);
    setSessionLoadState({
      label: "Saving",
      message: "Retrying table layout autosave",
      tone: "neutral"
    });
  }, [pendingLayoutAutosaveJson]);
  const handleReloadSession = useCallback(
    async ({
      fallbackToSampleOnFailure = false
    }: { fallbackToSampleOnFailure?: boolean } = {}) => {
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

        const action = getSqlErdSessionReloadFailureAction({
          fallbackToSampleOnFailure
        });

        if (action.kind === "fallback_to_sample") {
          setSqlErdViewSession(sampleSqlErdViewSession);
          setLastResolvedDialect(null);
          setSqlSourceMap(sampleSqlErdSourceMap);
          setPendingLayoutAutosaveJson(null);
          setLayoutAutosaveRetryAttempt(0);
          setLayoutAutosaveBlockReason(null);
          setSessionLoadState(action.sessionLoadState);
          setSelectedSqlErdObject(action.selectedSqlErdObject);
          return;
        }

        setSessionLoadState(action.sessionLoadState);
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
        const activeSession = await sqlErdApiClient.getActiveSession(
          activeWorkspaceId
        );

        if (!isCurrentRequest()) {
          return;
        }

        if (activeSession) {
          const activeViewSession =
            createWorkspaceSqlErdViewSession(activeSession);
          const activeParseResult = parseSqlDdlToErdModel({
            dialect: activeViewSession.dialect,
            sourceMapModelJson: activeViewSession.modelJson,
            sourceText: activeViewSession.sourceText
          });

          setSqlErdViewSession(activeViewSession);
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
        } else {
          setSqlErdViewSession(sampleSqlErdViewSession);
          setLastResolvedDialect(null);
          setSqlSourceMap(sampleSqlErdSourceMap);
          setSessionLoadState({
            label: "Sample",
            message: "No saved workspace session",
            tone: "neutral"
          });
        }

        setPendingLayoutAutosaveJson(null);
        setLayoutAutosaveRetryAttempt(0);
        setLayoutAutosaveBlockReason(null);
        setSelectedSqlErdObject({ type: "none" });
      } catch {
        applyReloadFailure();
      }
    },
    [accessToken, activeWorkspaceId]
  );
  const handleReloadPausedSession = useCallback(() => {
    void handleReloadSession({ fallbackToSampleOnFailure: false });
  }, [handleReloadSession]);
  const handleGenerate = useCallback(async () => {
    if (isGenerating) {
      return;
    }

    if (!authSession) {
      setSessionLoadState(getSqlErdSignInRequiredState());
      return;
    }

    setIsGenerating(true);
    setSessionLoadState({
      label: "Parsing",
      message: "Parsing SQL DDL",
      tone: "neutral"
    });

    const generateRequest =
      createSqlErdGenerateWorkspaceRequest(sqlErdViewSession);

    if (!generateRequest.ok) {
      setSqlSourceMap(null);
      setSessionLoadState({
        label: "Parse error",
        message: getSqlErdGenerateErrorMessage(generateRequest.error.code),
        tone: "error"
      });
      setIsGenerating(false);
      return;
    }

    setLastResolvedDialect(generateRequest.resolvedDialect);

    const sqlErdApiClient = createSqlErdApiClient({
      accessToken: authSession.accessToken
    });

    setSessionLoadState({
      label: "Saving",
      message: "Saving Workspace session",
      tone: "neutral"
    });

    try {
      const savedSession =
        generateRequest.kind === "update"
          ? await sqlErdApiClient.updateSession(
              authSession.activeWorkspaceId,
              generateRequest.sessionId,
              generateRequest.payload
            )
          : await sqlErdApiClient.createSession(
              authSession.activeWorkspaceId,
              generateRequest.payload
            );

      setSqlErdViewSession(createWorkspaceSqlErdViewSession(savedSession));
      setSqlSourceMap(generateRequest.sourceMap);
      setPendingLayoutAutosaveJson(null);
      setLayoutAutosaveRetryAttempt(0);
      setLayoutAutosaveBlockReason(null);
      setSessionLoadState({
        label: "Workspace",
        message: `Workspace session revision ${savedSession.revision}`,
        tone: "success"
      });
      setSelectedSqlErdObject({ type: "none" });
    } catch {
      setSessionLoadState(getSqlErdWorkspaceSaveErrorState());
    } finally {
      setIsGenerating(false);
    }
  }, [authSession, isGenerating, sqlErdViewSession]);

  useEffect(() => {
    if (
      !pendingLayoutAutosaveJson ||
      !accessToken ||
      !activeWorkspaceId ||
      isGenerating ||
      layoutAutosaveBlockReason
    ) {
      return;
    }

    const layoutAutosaveRequest = createSqlErdLayoutAutosaveRequest(
      sqlErdViewSession,
      pendingLayoutAutosaveJson
    );

    if (!layoutAutosaveRequest.ok) {
      return;
    }

    const requestLayoutJson = pendingLayoutAutosaveJson;
    const autosaveDelayMs = manualLayoutAutosaveRetryRef.current
      ? 0
      : getLayoutAutosaveDelayMs(layoutAutosaveRetryAttempt);
    manualLayoutAutosaveRetryRef.current = false;

    const timeoutId = window.setTimeout(async () => {
      const sqlErdApiClient = createSqlErdApiClient({
        accessToken
      });

      setSessionLoadState({
        label: "Saving",
        message: "Autosaving table layout",
        tone: "neutral"
      });

      try {
        const savedSession = await sqlErdApiClient.updateSession(
          activeWorkspaceId,
          layoutAutosaveRequest.sessionId,
          layoutAutosaveRequest.payload
        );

        setSqlErdViewSession((currentSession) => {
          if (currentSession.id !== savedSession.id) {
            return currentSession;
          }

          return {
            ...currentSession,
            layoutJson: areSqltoerdLayoutsEqual(
              currentSession.layoutJson,
              requestLayoutJson
            )
              ? savedSession.layoutJson
              : currentSession.layoutJson,
            revision: savedSession.revision
          };
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
      }
    }, autosaveDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    accessToken,
    activeWorkspaceId,
    isGenerating,
    layoutAutosaveBlockReason,
    layoutAutosaveRetryAttempt,
    pendingLayoutAutosaveJson,
    sqlErdViewSession.id,
    sqlErdViewSession.revision
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
    void handleReloadSession({ fallbackToSampleOnFailure: true });

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
    <section
      className="flex h-full min-h-0 overflow-hidden bg-background"
      ref={panelContainerRef}
    >
      <SourcePanel
        counts={sessionCounts}
        dialect={sqlErdViewSession.dialect}
        isOpen={isSourceOpen}
        isDialectSelectDisabled={
          isGenerating || sessionLoadState.label === "Loading"
        }
        isGenerateDisabled={
          isGenerating || !authSession || sessionLoadState.label === "Loading"
        }
        isGenerating={isGenerating}
        onDialectChange={handleDialectChange}
        onGenerate={handleGenerate}
        onSourceTextChange={handleSourceTextChange}
        onToggle={() => setIsSourceOpen((current) => !current)}
        sessionLoadState={sessionLoadState}
        isSourceTextReadOnly={
          isGenerating || sessionLoadState.label === "Loading"
        }
        sourceText={sqlErdViewSession.sourceText}
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
      <CanvasShell
        autosavePausedBanner={layoutAutosavePausedBanner}
        layoutJson={sqlErdViewSession.layoutJson}
        modelJson={sqlErdViewSession.modelJson}
        onLayoutChange={handleLayoutChange}
        onReloadSession={handleReloadPausedSession}
        onRetryLayoutAutosaveOnce={handleRetryLayoutAutosaveOnce}
        onSelectionChange={setSelectedSqlErdObject}
        selectedSqlErdObject={selectedSqlErdObject}
      />
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
        emptyState={{
          sessionLoadState,
          title: sqlErdViewSession.title
        }}
        isOpen={isInspectorOpen}
        onToggle={() => setIsInspectorOpen((current) => !current)}
        viewModel={inspectorViewModel}
        width={clampedInspectorPanelWidth}
      />
    </section>
  );
}

type PanelToggleProps = {
  isOpen: boolean;
  onToggle: () => void;
};

type SourcePanelProps = PanelToggleProps & {
  counts: ReturnType<typeof getSqltoerdModelCounts>;
  dialect: SqlErdViewSession["dialect"];
  isDialectSelectDisabled: boolean;
  isGenerateDisabled: boolean;
  isGenerating: boolean;
  isSourceTextReadOnly: boolean;
  onDialectChange: (dialect: SqltoerdDialect) => void;
  onGenerate: () => void;
  onSourceTextChange: (sourceText: string) => void;
  sessionLoadState: SqlErdSessionLoadState;
  sourceText: string;
  resolvedDialect: SqltoerdResolvedDialect;
  relationSourceRanges: SqltoerdSourceRange[];
  width: number;
};

function SourcePanel({
  counts,
  dialect,
  isOpen,
  isDialectSelectDisabled,
  isGenerateDisabled,
  isGenerating,
  isSourceTextReadOnly,
  onDialectChange,
  onGenerate,
  onSourceTextChange,
  onToggle,
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
        <div className="flex items-center justify-between border-b px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Source text
          </span>
          <button
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
              isGenerateDisabled
                ? "cursor-not-allowed bg-primary/70 text-primary-foreground opacity-60"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
            disabled={isGenerateDisabled}
            onClick={onGenerate}
            type="button"
          >
            <Play className="size-3.5" />
            {isGenerating ? "Generating" : "Generate"}
          </button>
        </div>
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

function CollapsedSourcePanel({ onToggle }: { onToggle: () => void }) {
  return (
    <aside className="flex w-12 shrink-0 flex-col border-r bg-muted/20">
      <div className="flex min-h-14 items-center justify-center border-b">
        <SqlErdHomeNavigationButton />
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
  emptyState: InspectorEmptyState;
  viewModel: SqlErdInspectorViewModel;
  width: number;
};

function InspectorPanel({
  emptyState,
  isOpen,
  onToggle,
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
        <InspectorContent emptyState={emptyState} viewModel={viewModel} />

        <div className="mt-auto grid gap-2">
          <button
            className="inline-flex h-11 cursor-not-allowed items-center justify-center rounded-md border bg-background px-3 text-lg font-medium text-muted-foreground opacity-70"
            disabled
            type="button"
          >
            Add column
          </button>
          <button
            className="inline-flex h-11 cursor-not-allowed items-center justify-center rounded-md border bg-background px-3 text-lg font-medium text-muted-foreground opacity-70"
            disabled
            type="button"
          >
            Pin
          </button>
        </div>
      </div>
    </aside>
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

  return "선택 없음";
}

function InspectorContent({
  emptyState,
  viewModel
}: {
  emptyState: InspectorEmptyState;
  viewModel: SqlErdInspectorViewModel;
}) {
  if (viewModel.type === "table") {
    return <TableInspector viewModel={viewModel} />;
  }

  if (viewModel.type === "column") {
    return <ColumnInspector viewModel={viewModel} />;
  }

  if (viewModel.type === "relation") {
    return <RelationInspector viewModel={viewModel} />;
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
  viewModel
}: {
  viewModel: Extract<SqlErdInspectorViewModel, { type: "column" }>;
}) {
  const { column, table } = viewModel;

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
    </>
  );
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
