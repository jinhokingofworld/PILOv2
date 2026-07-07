"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Database,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play
} from "lucide-react";

import { useAuthSession } from "@/features/auth/auth-session";
import { createSqlErdApiClient } from "@/features/sql-erd/api/client";
import { SqlErdCanvas } from "@/features/sql-erd/components/sql-erd-canvas";
import { commerceSqltoerdFixture } from "@/features/sql-erd/fixtures/commerce";
import type {
  SqlErdSelection,
  SqltoerdDialect,
  SqltoerdSessionPayload,
  SqltoerdSessionFixture
} from "@/features/sql-erd/types";
import {
  createSqlErdInspectorViewModel,
  formatSqlErdRelationEndpoint,
  type RelationSummary,
  type SqlErdInspectorViewModel
} from "@/features/sql-erd/utils/inspector";
import {
  createSqltoerdLayoutForModel,
  createSqltoerdModelIndex,
  getSqltoerdModelCounts,
  getTableDisplayName
} from "@/features/sql-erd/utils/model";
import { parseSqlDdlToErdModel } from "@/features/sql-erd/utils/ddl-parser";
import { cn } from "@/lib/utils";

type SqlErdViewSession = Pick<
  SqltoerdSessionPayload,
  | "dialect"
  | "layoutJson"
  | "modelJson"
  | "settingsJson"
  | "sourceFormat"
  | "sourceText"
  | "title"
> & {
  id: string | null;
  revision: number | null;
};

type SqlErdSessionLoadState = {
  label: string;
  message: string;
  tone: "error" | "neutral" | "success";
};

const sampleSqlErdViewSession = createSampleSqlErdViewSession(
  commerceSqltoerdFixture
);

function createSampleSqlErdViewSession(
  fixture: SqltoerdSessionFixture
): SqlErdViewSession {
  return {
    id: null,
    revision: null,
    title: fixture.title,
    sourceFormat: fixture.sourceFormat,
    dialect: fixture.dialect,
    sourceText: fixture.sourceText,
    modelJson: fixture.modelJson,
    layoutJson: fixture.layoutJson,
    settingsJson: fixture.settingsJson
  };
}

function createWorkspaceSqlErdViewSession(
  session: SqltoerdSessionPayload
): SqlErdViewSession {
  return {
    id: session.id,
    revision: session.revision,
    title: session.title,
    sourceFormat: session.sourceFormat,
    dialect: session.dialect,
    sourceText: session.sourceText,
    modelJson: session.modelJson,
    layoutJson: session.layoutJson,
    settingsJson: session.settingsJson
  };
}

function getSqlErdGenerateErrorMessage(errorCode: string) {
  if (errorCode === "EMPTY_SOURCE") {
    return "Enter one or more CREATE TABLE statements";
  }

  if (errorCode === "UNSUPPORTED_DIALECT") {
    return "Selected SQL dialect is not supported by the MVP parser";
  }

  if (errorCode === "NO_CREATE_TABLE") {
    return "SQLtoERD MVP expects CREATE TABLE statements";
  }

  return "SQL DDL could not be parsed";
}

export function SqlErdPanel() {
  const authSession = useAuthSession();
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
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
    setSqlErdViewSession((currentSession) => ({
      ...currentSession,
      sourceText
    }));
  }, []);
  const handleDialectChange = useCallback((dialect: SqltoerdDialect) => {
    setSqlErdViewSession((currentSession) => ({
      ...currentSession,
      dialect
    }));
  }, []);
  const handleGenerate = useCallback(async () => {
    if (isGenerating) {
      return;
    }

    if (!authSession) {
      setSessionLoadState({
        label: "Sign in",
        message: "Sign in to save a Workspace session",
        tone: "error"
      });
      return;
    }

    setIsGenerating(true);
    setSessionLoadState({
      label: "Parsing",
      message: "Parsing SQL DDL",
      tone: "neutral"
    });

    const parseResult = parseSqlDdlToErdModel({
      dialect: sqlErdViewSession.dialect,
      sourceText: sqlErdViewSession.sourceText
    });

    if (!parseResult.ok) {
      setSessionLoadState({
        label: "Parse error",
        message: getSqlErdGenerateErrorMessage(parseResult.error.code),
        tone: "error"
      });
      setIsGenerating(false);
      return;
    }

    const nextLayoutJson = createSqltoerdLayoutForModel(
      parseResult.modelJson,
      sqlErdViewSession.layoutJson
    );
    const sqlErdApiClient = createSqlErdApiClient({
      accessToken: authSession.accessToken
    });
    const writePayload = {
      title: sqlErdViewSession.title,
      sourceFormat: sqlErdViewSession.sourceFormat,
      dialect: sqlErdViewSession.dialect,
      sourceText: sqlErdViewSession.sourceText,
      modelJson: parseResult.modelJson,
      layoutJson: nextLayoutJson,
      settingsJson: sqlErdViewSession.settingsJson
    };

    setSessionLoadState({
      label: "Saving",
      message: "Saving Workspace session",
      tone: "neutral"
    });

    try {
      const savedSession =
        sqlErdViewSession.id && sqlErdViewSession.revision !== null
          ? await sqlErdApiClient.updateSession(
              authSession.activeWorkspaceId,
              sqlErdViewSession.id,
              {
                baseRevision: sqlErdViewSession.revision,
                ...writePayload
              }
            )
          : await sqlErdApiClient.createSession(
              authSession.activeWorkspaceId,
              writePayload
            );

      setSqlErdViewSession(createWorkspaceSqlErdViewSession(savedSession));
      setSessionLoadState({
        label: "Workspace",
        message: `Workspace session revision ${savedSession.revision}`,
        tone: "success"
      });
      setSelectedSqlErdObject({ type: "none" });
    } catch {
      setSessionLoadState({
        label: "Save error",
        message: "Workspace session could not be saved",
        tone: "error"
      });
    } finally {
      setIsGenerating(false);
    }
  }, [authSession, isGenerating, sqlErdViewSession]);

  useEffect(() => {
    setIsSourceOpen(window.matchMedia("(min-width: 1024px)").matches);
    setIsInspectorOpen(window.matchMedia("(min-width: 1280px)").matches);
  }, []);

  useEffect(() => {
    if (!authSession) {
      setSqlErdViewSession(sampleSqlErdViewSession);
      setSessionLoadState({
        label: "Sample",
        message: "Built-in sample ERD",
        tone: "neutral"
      });
      return;
    }

    let cancelled = false;
    const { accessToken, activeWorkspaceId } = authSession;
    const sqlErdApiClient = createSqlErdApiClient({
      accessToken
    });

    setSessionLoadState({
      label: "Loading",
      message: "Loading workspace session",
      tone: "neutral"
    });

    async function loadActiveSession() {
      try {
        const activeSession = await sqlErdApiClient.getActiveSession(
          activeWorkspaceId
        );

        if (cancelled) {
          return;
        }

        if (activeSession) {
          setSqlErdViewSession(createWorkspaceSqlErdViewSession(activeSession));
          setSessionLoadState({
            label: "Workspace",
            message: `Workspace session revision ${activeSession.revision}`,
            tone: "success"
          });
        } else {
          setSqlErdViewSession(sampleSqlErdViewSession);
          setSessionLoadState({
            label: "Sample",
            message: "No saved workspace session",
            tone: "neutral"
          });
        }

        setSelectedSqlErdObject({ type: "none" });
      } catch {
        if (cancelled) {
          return;
        }

        setSqlErdViewSession(sampleSqlErdViewSession);
        setSessionLoadState({
          label: "Sample",
          message: "Workspace session could not be loaded",
          tone: "neutral"
        });
        setSelectedSqlErdObject({ type: "none" });
      }
    }

    void loadActiveSession();

    return () => {
      cancelled = true;
    };
  }, [authSession?.accessToken, authSession?.activeWorkspaceId]);

  return (
    <section className="flex min-h-[calc(100vh-8.5rem)] overflow-hidden rounded-lg border bg-background shadow-sm">
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
      />
      <CanvasShell
        layoutJson={sqlErdViewSession.layoutJson}
        modelJson={sqlErdViewSession.modelJson}
        onSelectionChange={setSelectedSqlErdObject}
        selectedSqlErdObject={selectedSqlErdObject}
        sessionLoadState={sessionLoadState}
        title={sqlErdViewSession.title}
      />
      <InspectorPanel
        isOpen={isInspectorOpen}
        onToggle={() => setIsInspectorOpen((current) => !current)}
        viewModel={inspectorViewModel}
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
  sourceText
}: SourcePanelProps) {
  if (!isOpen) {
    return (
      <CollapsedPanelButton
        ariaLabel="Open source panel"
        icon={<PanelLeftOpen className="size-4" />}
        label="Source"
        onClick={onToggle}
      />
    );
  }

  return (
    <aside
      className="flex w-[min(360px,42vw)] min-w-64 max-w-[360px] shrink-0 flex-col border-r bg-muted/20"
      id="source"
    >
      <div className="flex min-h-14 items-center justify-between gap-3 border-b px-4">
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
        <textarea
          aria-label="SQL source"
          className={cn(
            "min-h-0 flex-1 resize-none overflow-auto border-0 bg-[#0d1117] p-4 font-mono text-[13px] leading-6 text-slate-100 outline-none placeholder:text-slate-500",
            isSourceTextReadOnly && "cursor-progress opacity-80"
          )}
          onChange={(event) => onSourceTextChange(event.target.value)}
          readOnly={isSourceTextReadOnly}
          value={sourceText}
          spellCheck={false}
        />
      </div>
    </aside>
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

type CanvasShellProps = {
  layoutJson: SqltoerdSessionPayload["layoutJson"];
  modelJson: SqltoerdSessionPayload["modelJson"];
  onSelectionChange: (selection: SqlErdSelection) => void;
  selectedSqlErdObject: SqlErdSelection;
  sessionLoadState: SqlErdSessionLoadState;
  title: string;
};

function CanvasShell({
  layoutJson,
  modelJson,
  onSelectionChange,
  selectedSqlErdObject,
  sessionLoadState,
  title
}: CanvasShellProps) {
  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <div
        className="flex min-h-14 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur"
        id="canvas"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
            <Database className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {sessionLoadState.message}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill
            label={sessionLoadState.label}
            tone={sessionLoadState.tone}
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <SqlErdCanvas
          className="absolute inset-0"
          layoutJson={layoutJson}
          modelJson={modelJson}
          onSelectionChange={onSelectionChange}
          selectedSqlErdObject={selectedSqlErdObject}
        />
      </div>
    </div>
  );
}

type InspectorPanelProps = PanelToggleProps & {
  viewModel: SqlErdInspectorViewModel;
};

function InspectorPanel({ isOpen, onToggle, viewModel }: InspectorPanelProps) {
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
      className="flex w-[min(400px,40vw)] min-w-96 max-w-[400px] shrink-0 flex-col border-l bg-background"
      id="inspector"
    >
      <div className="flex min-h-20 items-center justify-between gap-3 border-b px-6">
        <div className="min-w-0">
          <p className="text-xl font-semibold">상세 정보</p>
          <p className="truncate text-base text-muted-foreground">
            {getInspectorSubtitle(viewModel)}
          </p>
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
        <InspectorContent viewModel={viewModel} />

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

function getInspectorSubtitle(viewModel: SqlErdInspectorViewModel) {
  if (viewModel.type === "table") {
    return `${viewModel.title} 테이블`;
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
  viewModel
}: {
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
      <p className="text-lg font-medium">선택 정보</p>
      <p className="mt-1 text-base leading-7 text-muted-foreground">
        선택한 테이블, 컬럼, 관계가 없습니다
      </p>
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
  const { endpoints, relation } = viewModel;

  return (
    <>
      <InspectorSectionTitle>관계 정보</InspectorSectionTitle>
      <div className="space-y-2">
        <InspectorRow label="종류" value="foreign key" />
        <InspectorRow label="제약 조건" value={relation.constraintName ?? "-"} />
        <InspectorRow
          label="From"
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
          label="To"
          value={
            endpoints
              ? formatSqlErdRelationEndpoint(
                  endpoints.to.table,
                  endpoints.to.columns
                )
              : relation.toTableId
          }
        />
      </div>
    </>
  );
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
