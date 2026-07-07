"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  Circle,
  Database,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  TableProperties
} from "lucide-react";

import { cn } from "@/lib/utils";

type ShellState = "empty" | "loading" | "error";

const sampleSql = `CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(120),
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  total_cents INT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);`;

const shellState: ShellState = "empty";

export function SqlErdPanel() {
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

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
        isInspectorOpen={isInspectorOpen}
        isSourceOpen={isSourceOpen}
        state={shellState}
      />
      <InspectorPanel
        isOpen={isInspectorOpen}
        onToggle={() => setIsInspectorOpen((current) => !current)}
      />
    </section>
  );
}

type PanelToggleProps = {
  isOpen: boolean;
  onToggle: () => void;
};

function SourcePanel({ isOpen, onToggle }: PanelToggleProps) {
  if (!isOpen) {
    return (
      <CollapsedPanelButton
        ariaLabel="Source panel 열기"
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
            2 tables · 1 relation
          </p>
        </div>
        <button
          aria-label="Source panel 접기"
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
  isInspectorOpen: boolean;
  isSourceOpen: boolean;
  state: ShellState;
};

function CanvasShell({ isInspectorOpen, isSourceOpen, state }: CanvasShellProps) {
  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:24px_24px]">
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
              Workspace session shell
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill label="Empty" tone="neutral" />
          <StatusPill label="Ready" tone="success" />
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-6">
        <CanvasStateCard state={state} />
        <PreviewTableCard
          className={cn(
            "absolute left-[14%] top-[18%]",
            !isSourceOpen && "left-[18%]"
          )}
          columns={["id", "email", "full_name"]}
          title="users"
        />
        <PreviewTableCard
          className={cn(
            "absolute right-[12%] bottom-[18%]",
            !isInspectorOpen && "right-[18%]"
          )}
          columns={["id", "user_id", "status"]}
          title="orders"
        />
        <div className="pointer-events-none absolute left-[38%] top-[45%] h-px w-[24%] rotate-12 bg-primary/55" />
      </div>
    </div>
  );
}

type CanvasStateCardProps = {
  state: ShellState;
};

function CanvasStateCard({ state }: CanvasStateCardProps) {
  const stateConfig = {
    empty: {
      icon: <Circle className="size-4" />,
      label: "Empty state",
      message: "No ERD session loaded"
    },
    loading: {
      icon: <Loader2 className="size-4 animate-spin" />,
      label: "Loading state",
      message: "Session loading"
    },
    error: {
      icon: <AlertCircle className="size-4" />,
      label: "Error state",
      message: "Session unavailable"
    }
  } satisfies Record<
    ShellState,
    { icon: ReactNode; label: string; message: string }
  >;

  const currentState = stateConfig[state];

  return (
    <div className="z-10 flex min-w-60 flex-col items-center gap-2 rounded-md border bg-background/95 p-4 text-center shadow-sm">
      <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {currentState.icon}
      </div>
      <div>
        <p className="text-sm font-semibold">{currentState.label}</p>
        <p className="text-xs text-muted-foreground">{currentState.message}</p>
      </div>
    </div>
  );
}

type PreviewTableCardProps = {
  className?: string;
  columns: string[];
  title: string;
};

function PreviewTableCard({ className, columns, title }: PreviewTableCardProps) {
  return (
    <div
      className={cn(
        "pointer-events-none hidden w-56 overflow-hidden rounded-md border bg-background/90 shadow-sm lg:block",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b bg-muted/70 px-3 py-2">
        <TableProperties className="size-4 text-muted-foreground" />
        <span className="truncate text-sm font-semibold">{title}</span>
      </div>
      <div className="divide-y">
        {columns.map((column) => (
          <div
            className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
            key={column}
          >
            <span className="truncate font-medium">{column}</span>
            <span className="shrink-0 text-muted-foreground">field</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InspectorPanel({ isOpen, onToggle }: PanelToggleProps) {
  if (!isOpen) {
    return (
      <CollapsedPanelButton
        ariaLabel="Inspector panel 열기"
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
            No selection
          </p>
        </div>
        <button
          aria-label="Inspector panel 접기"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onToggle}
          type="button"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        <div className="rounded-md border border-dashed p-4">
          <p className="text-sm font-medium">Selection</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            No table, column, or relation selected
          </p>
        </div>

        <div className="space-y-2">
          <InspectorRow label="Tool" value="select" />
          <InspectorRow label="Shapes" value="0 selected" />
          <InspectorRow label="Viewport" value="x 0, y 0, 100%" />
        </div>

        <div className="mt-auto grid gap-2">
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium text-muted-foreground"
            disabled
            type="button"
          >
            Add column
          </button>
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium text-muted-foreground"
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

type InspectorRowProps = {
  label: string;
  value: string;
};

function InspectorRow({ label, value }: InspectorRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
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
