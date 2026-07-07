"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Database,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play
} from "lucide-react";

import { SqlErdCanvas } from "@/features/sql-erd/components/sql-erd-canvas";
import { commerceSqltoerdFixture } from "@/features/sql-erd/fixtures/commerce";
import type {
  ErdColumn,
  ErdRelation,
  ErdTable,
  SqlErdSelection
} from "@/features/sql-erd/types";
import {
  createSqltoerdModelIndex,
  getRelationEndpoints,
  getSqltoerdModelCounts,
  getTableDisplayName,
  type SqltoerdModelIndex,
  type SqltoerdRelationEndpoints
} from "@/features/sql-erd/utils/model";
import { cn } from "@/lib/utils";

const sampleSql = commerceSqltoerdFixture.sourceText;
const fixtureModelJson = commerceSqltoerdFixture.modelJson;
const fixtureLayoutJson = commerceSqltoerdFixture.layoutJson;
const fixtureCounts = getSqltoerdModelCounts(fixtureModelJson);

type RelationSummary = {
  id: string;
  fromLabel: string;
  toLabel: string;
};

type SqlErdInspectorViewModel =
  | {
      type: "empty";
    }
  | {
      type: "table";
      columnCount: number;
      relations: RelationSummary[];
      table: ErdTable;
      title: string;
    }
  | {
      type: "column";
      column: ErdColumn;
      relations: RelationSummary[];
      table: ErdTable;
      title: string;
    }
  | {
      type: "relation";
      endpoints: SqltoerdRelationEndpoints | null;
      relation: ErdRelation;
      title: string;
    };

export function SqlErdPanel() {
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [selectedSqlErdObject, setSelectedSqlErdObject] =
    useState<SqlErdSelection>({ type: "none" });
  const modelIndex = useMemo(
    () => createSqltoerdModelIndex(fixtureModelJson),
    []
  );
  const inspectorViewModel = useMemo(
    () => createSqlErdInspectorViewModel(selectedSqlErdObject, modelIndex),
    [modelIndex, selectedSqlErdObject]
  );

  useEffect(() => {
    setIsSourceOpen(window.matchMedia("(min-width: 1024px)").matches);
    setIsInspectorOpen(window.matchMedia("(min-width: 1280px)").matches);
  }, []);

  return (
    <section className="flex min-h-[calc(100vh-8.5rem)] overflow-hidden rounded-lg border bg-background shadow-sm">
      <SourcePanel
        isOpen={isSourceOpen}
        onToggle={() => setIsSourceOpen((current) => !current)}
      />
      <CanvasShell
        onSelectionChange={setSelectedSqlErdObject}
        selectedSqlErdObject={selectedSqlErdObject}
      />
      <InspectorPanel
        isOpen={isInspectorOpen}
        onToggle={() => setIsInspectorOpen((current) => !current)}
        viewModel={inspectorViewModel}
      />
    </section>
  );
}

export function createSqlErdInspectorViewModel(
  selection: SqlErdSelection,
  modelIndex: SqltoerdModelIndex
): SqlErdInspectorViewModel {
  if (selection.type === "table") {
    const table = modelIndex.tablesById.get(selection.tableId);

    if (!table) {
      return { type: "empty" };
    }

    return {
      type: "table",
      columnCount: table.columns.length,
      relations: getRelationSummaries(
        modelIndex.relationsByTableId.get(table.id) ?? [],
        modelIndex
      ),
      table,
      title: getTableDisplayName(table)
    };
  }

  if (selection.type === "column") {
    const table = modelIndex.tablesById.get(selection.tableId);
    const column = modelIndex.columnsByTableId
      .get(selection.tableId)
      ?.get(selection.columnId);

    if (!table || !column) {
      return { type: "empty" };
    }

    const relations = (modelIndex.relationsByTableId.get(table.id) ?? []).filter(
      (relation) => isColumnConnectedToRelation(relation, table.id, column.id)
    );

    return {
      type: "column",
      column,
      relations: getRelationSummaries(relations, modelIndex),
      table,
      title: column.name
    };
  }

  if (selection.type === "relation") {
    const relation = modelIndex.relationsById.get(selection.relationId);

    if (!relation) {
      return { type: "empty" };
    }

    return {
      type: "relation",
      endpoints: getRelationEndpoints(relation, modelIndex),
      relation,
      title: relation.constraintName ?? relation.id
    };
  }

  return { type: "empty" };
}

function getRelationSummaries(
  relations: ErdRelation[],
  modelIndex: SqltoerdModelIndex
) {
  return relations.map((relation) => {
    const endpoints = getRelationEndpoints(relation, modelIndex);

    return {
      id: relation.id,
      fromLabel: endpoints
        ? formatRelationEndpoint(endpoints.from.table, endpoints.from.columns)
        : relation.fromTableId,
      toLabel: endpoints
        ? formatRelationEndpoint(endpoints.to.table, endpoints.to.columns)
        : relation.toTableId
    };
  });
}

function isColumnConnectedToRelation(
  relation: ErdRelation,
  tableId: string,
  columnId: string
) {
  return (
    (relation.fromTableId === tableId &&
      relation.fromColumnIds.includes(columnId)) ||
    (relation.toTableId === tableId && relation.toColumnIds.includes(columnId))
  );
}

function formatRelationEndpoint(table: ErdTable, columns: ErdColumn[]) {
  return `${getTableDisplayName(table)}.${columns
    .map((column) => column.name)
    .join(", ")}`;
}

type PanelToggleProps = {
  isOpen: boolean;
  onToggle: () => void;
};

function SourcePanel({ isOpen, onToggle }: PanelToggleProps) {
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
            <StatusPill label="Idle" tone="neutral" />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {fixtureCounts.tableCount} tables / {fixtureCounts.relationCount}{" "}
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
        <SelectorLabel label="Dialect" value="Auto" />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Source text
          </span>
          <button
            className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-md bg-primary/70 px-3 text-xs font-medium text-primary-foreground opacity-60"
            disabled
            type="button"
          >
            <Play className="size-3.5" />
            Generate
          </button>
        </div>
        <textarea
          aria-label="SQL source"
          className="min-h-0 flex-1 resize-none overflow-auto border-0 bg-[#0d1117] p-4 font-mono text-[13px] leading-6 text-slate-100 outline-none placeholder:text-slate-500"
          defaultValue={sampleSql}
          spellCheck={false}
        />
      </div>
    </aside>
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
  onSelectionChange: (selection: SqlErdSelection) => void;
  selectedSqlErdObject: SqlErdSelection;
};

function CanvasShell({
  onSelectionChange,
  selectedSqlErdObject
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
            <p className="truncate text-sm font-semibold">SQLtoERD Canvas</p>
            <p className="truncate text-xs text-muted-foreground">
              Fixture table card canvas
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill label="Fixture" tone="neutral" />
          <StatusPill label="Ready" tone="success" />
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <SqlErdCanvas
          className="absolute inset-0"
          layoutJson={fixtureLayoutJson}
          modelJson={fixtureModelJson}
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
        ariaLabel="Open inspector panel"
        icon={<PanelRightOpen className="size-4" />}
        label="Inspector"
        onClick={onToggle}
        side="right"
      />
    );
  }

  return (
    <aside
      className="flex w-[min(320px,34vw)] min-w-72 max-w-[320px] shrink-0 flex-col border-l bg-background"
      id="inspector"
    >
      <div className="flex min-h-14 items-center justify-between gap-3 border-b px-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Inspector</p>
          <p className="truncate text-xs text-muted-foreground">
            {getInspectorSubtitle(viewModel)}
          </p>
        </div>
        <button
          aria-label="Close inspector panel"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onToggle}
          type="button"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        <InspectorContent viewModel={viewModel} />

        <div className="mt-auto grid gap-2">
          <button
            className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-md border bg-background px-3 text-sm font-medium text-muted-foreground opacity-70"
            disabled
            type="button"
          >
            Add column
          </button>
          <button
            className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-md border bg-background px-3 text-sm font-medium text-muted-foreground opacity-70"
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
    return `${viewModel.title} table`;
  }

  if (viewModel.type === "column") {
    return `${getTableDisplayName(viewModel.table)}.${viewModel.column.name}`;
  }

  if (viewModel.type === "relation") {
    return "foreign key relation";
  }

  return "No selection";
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
      <p className="text-sm font-medium">Selection</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        No table, column, or relation selected
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
      <InspectorSectionTitle>Table details</InspectorSectionTitle>
      <div className="space-y-2">
        <InspectorRow label="Table name" value={viewModel.title} />
        <InspectorRow label="Columns" value={`${viewModel.columnCount}`} />
        <InspectorRow label="Relations" value={`${viewModel.relations.length}`} />
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
      <InspectorSectionTitle>Column details</InspectorSectionTitle>
      <div className="space-y-2">
        <InspectorRow label="Table" value={getTableDisplayName(table)} />
        <InspectorRow label="Column name" value={column.name} />
        <InspectorRow label="Column type" value={column.dataType} />
        <InspectorRow label="Nullable" value={column.nullable ? "Yes" : "No"} />
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
      <InspectorSectionTitle>Relation details</InspectorSectionTitle>
      <div className="space-y-2">
        <InspectorRow label="Kind" value="foreign key" />
        <InspectorRow label="Constraint" value={relation.constraintName ?? "-"} />
        <InspectorRow
          label="From"
          value={
            endpoints
              ? formatRelationEndpoint(endpoints.from.table, endpoints.from.columns)
              : relation.fromTableId
          }
        />
        <InspectorRow
          label="To"
          value={
            endpoints
              ? formatRelationEndpoint(endpoints.to.table, endpoints.to.columns)
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
        <InspectorSectionTitle>Relations</InspectorSectionTitle>
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No connected relations
        </p>
      </div>
    );
  }

  return (
    <div>
      <InspectorSectionTitle>Relations</InspectorSectionTitle>
      <div className="space-y-2">
        {relations.map((relation) => (
          <div
            className="rounded-md border bg-background p-3 text-xs leading-5"
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
    <span className="inline-flex h-7 items-center rounded-md border bg-muted/40 px-2 text-xs font-semibold text-muted-foreground">
      {label}
    </span>
  );
}

function InspectorSectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
    <div className="flex items-start justify-between gap-3 border-b py-2 text-sm">
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
  tone: "neutral" | "success";
};

function StatusPill({ label, tone }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium",
        tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-border bg-background text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}
