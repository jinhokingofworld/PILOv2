"use client";

import { GitPullRequestArrow } from "lucide-react";
import { useMemo, useState } from "react";

import { BoardIssueCard } from "@/features/board/components/board-issue-card";
import type {
  BoardColumnPayload,
  BoardDetailPayload,
  BoardIssueCardPayload
} from "@/features/board/types";
import {
  orderBoardColumns,
  resolveMobileBoardColumnId
} from "@/features/board/utils/board-presentation";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { pageCursorTargetAttributes } from "@/shared/page-cursor/page-cursor-target";

type BoardKanbanProps = {
  board: BoardDetailPayload | null;
  boardStatus: "idle" | "loading" | "success" | "error";
  columns: BoardColumnPayload[];
  issues: BoardIssueCardPayload[];
  movingIssueId?: string | null;
  onOpenIssue: (issue: BoardIssueCardPayload) => void;
  onMoveIssue: (input: {
    issueId: string;
    columnId: string;
    previousColumnId: string;
  }) => void;
  selectedIssueId?: string | null;
};

type DraggedIssue = {
  issueId: string;
  previousColumnId: string;
};

function columnToneClassName(index: number) {
  const tones = [
    "bg-violet-500 shadow-[0_0_0_4px_rgba(109,91,214,0.12)]",
    "bg-amber-500 shadow-[0_0_0_4px_rgba(217,148,31,0.12)]",
    "bg-red-500 shadow-[0_0_0_4px_rgba(229,72,77,0.1)]",
    "bg-emerald-500 shadow-[0_0_0_4px_rgba(46,158,91,0.12)]",
    "bg-slate-400 shadow-[0_0_0_4px_rgba(138,147,166,0.12)]"
  ];

  return tones[index % tones.length];
}

function columnSurfaceClassName(index: number) {
  const tones = [
    "bg-violet-50/35",
    "bg-amber-50/35",
    "bg-red-50/25",
    "bg-emerald-50/30",
    "bg-slate-50/70"
  ];

  return tones[index % tones.length];
}

function BoardKanbanSkeleton() {
  const lane = (
    <article className="lane min-h-[calc(100vh-252px)] rounded-xl border border-slate-200 bg-white/60">
      <div className="lane-header flex min-h-16 items-center justify-between gap-2 border-b border-slate-200 px-3 py-3">
        <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
        <div className="h-7 w-8 animate-pulse rounded-full bg-slate-200" />
      </div>
      <div className="lane-stack grid gap-2.5 p-3">
        <div className="h-36 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-36 animate-pulse rounded-lg bg-slate-200" />
      </div>
    </article>
  );

  return (
    <div className="kanban-scroll overflow-x-auto p-4 sm:p-6">
      <div className="mb-3 flex gap-2 overflow-hidden md:hidden">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-9 w-24 shrink-0 animate-pulse rounded-lg bg-slate-200"
          />
        ))}
      </div>
      <div className="md:hidden">{lane}</div>
      <div className="kanban-board hidden md:grid min-w-[80rem] grid-flow-col auto-cols-[minmax(16rem,1fr)] gap-3.5">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index}>{lane}</div>
        ))}
      </div>
    </div>
  );
}

export function BoardKanban({
  board,
  boardStatus,
  columns,
  issues,
  movingIssueId = null,
  onOpenIssue,
  onMoveIssue,
  selectedIssueId = null
}: BoardKanbanProps) {
  const isMobile = useIsMobile();
  const [draggedIssue, setDraggedIssue] = useState<DraggedIssue | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [mobileColumnId, setMobileColumnId] = useState("");
  const orderedColumns = useMemo(() => orderBoardColumns(columns), [columns]);
  const issuesByColumnId = useMemo(() => {
    const nextIssuesByColumnId = new Map<string, BoardIssueCardPayload[]>();

    orderedColumns.forEach((column) => {
      nextIssuesByColumnId.set(column.id, []);
    });

    issues.forEach((issue) => {
      const columnIssues = nextIssuesByColumnId.get(issue.columnId) ?? [];
      columnIssues.push(issue);
      nextIssuesByColumnId.set(issue.columnId, columnIssues);
    });

    return nextIssuesByColumnId;
  }, [issues, orderedColumns]);
  const resolvedMobileColumnId = resolveMobileBoardColumnId(
    orderedColumns,
    mobileColumnId
  );
  const mobileColumn = orderedColumns.find(
    ({ id }) => id === resolvedMobileColumnId
  );

  function handleMobileTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>
  ) {
    const tabButtons = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]'
      ) ?? []
    );
    const currentIndex = tabButtons.indexOf(event.currentTarget);
    if (currentIndex < 0 || !orderedColumns.length) {
      return;
    }

    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % orderedColumns.length;
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + orderedColumns.length) % orderedColumns.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = orderedColumns.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    setMobileColumnId(orderedColumns[nextIndex].id);
    const nextTab = tabButtons[nextIndex];
    nextTab?.focus();
  }

  function readDraggedIssue(event: React.DragEvent): DraggedIssue | null {
    if (draggedIssue) {
      return draggedIssue;
    }

    const payload = event.dataTransfer.getData("application/x-pilo-board-issue");
    if (!payload) {
      return null;
    }

    try {
      const parsed = JSON.parse(payload) as Partial<DraggedIssue>;
      if (parsed.issueId && parsed.previousColumnId) {
        return {
          issueId: parsed.issueId,
          previousColumnId: parsed.previousColumnId
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  function handleDrop(event: React.DragEvent, columnId: string) {
    event.preventDefault();
    const droppedIssue = readDraggedIssue(event);
    setDraggedIssue(null);
    setDragOverColumnId(null);

    if (!droppedIssue || droppedIssue.previousColumnId === columnId) {
      return;
    }

    onMoveIssue({
      issueId: droppedIssue.issueId,
      columnId,
      previousColumnId: droppedIssue.previousColumnId
    });
  }

  function renderColumn(
    column: BoardColumnPayload,
    index: number,
    enableDrop: boolean,
    enableCursorTarget: boolean
  ) {
    const columnIssues = issuesByColumnId.get(column.id) ?? [];
    const cursorAttributes = enableCursorTarget
      ? pageCursorTargetAttributes({
          id: column.id,
          label: column.name,
          type: "board_column"
        })
      : {};

    return (
      <article
        {...cursorAttributes}
        id={enableDrop ? (column.normalizedName ?? column.id) : undefined}
        key={`${enableDrop ? "desktop" : "mobile"}-${column.id}`}
        className={cn(
          "lane flex min-h-[calc(100vh-252px)] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 transition",
          columnSurfaceClassName(index),
          enableDrop &&
            dragOverColumnId === column.id &&
            "border-violet-300 bg-violet-50/60 ring-2 ring-violet-100"
        )}
        onDragLeave={
          enableDrop
            ? (event) => {
                const nextTarget = event.relatedTarget;
                if (
                  !(nextTarget instanceof Node) ||
                  !event.currentTarget.contains(nextTarget)
                ) {
                  setDragOverColumnId(null);
                }
              }
            : undefined
        }
        onDragOver={
          enableDrop
            ? (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverColumnId(column.id);
              }
            : undefined
        }
        onDrop={enableDrop ? (event) => handleDrop(event, column.id) : undefined}
        role="listitem"
      >
        <header className="lane-header flex min-h-16 items-center justify-between gap-2 border-b border-slate-200 bg-white/65 px-3 py-3">
          <div className="lane-name flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "dot size-2.5 shrink-0 rounded-full",
                columnToneClassName(index)
              )}
            />
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold leading-6">
                {column.name}
              </h2>
              <span className="block truncate text-xs font-medium text-slate-500">
                ProjectV2 Status
              </span>
            </div>
          </div>
          <span className="lane-count inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-slate-200 bg-white px-2 font-mono text-xs font-bold text-slate-600">
            {columnIssues.length}
          </span>
        </header>

        <div className="lane-stack grid gap-2.5 p-3">
          {columnIssues.length ? (
            columnIssues.map((issue) => (
              <BoardIssueCard
                key={issue.id}
                enableCursorTarget={enableCursorTarget}
                issue={issue}
                moving={movingIssueId === issue.id}
                selected={selectedIssueId === issue.id}
                onOpenIssue={onOpenIssue}
                onDragEnd={() => {
                  setDraggedIssue(null);
                  setDragOverColumnId(null);
                }}
                onDragStart={(dragIssue) => {
                  setDraggedIssue({
                    issueId: dragIssue.id,
                    previousColumnId: dragIssue.columnId
                  });
                }}
              />
            ))
          ) : (
            <div className="empty-slot grid min-h-28 place-items-center rounded-lg border border-dashed border-slate-300 bg-white/50 px-3 text-center text-sm font-semibold text-slate-500">
              <span className="inline-flex items-center gap-1">
                <GitPullRequestArrow className="size-4" />
                표시할 이슈가 없습니다.
              </span>
            </div>
          )}
        </div>
      </article>
    );
  }

  if (boardStatus === "loading") {
    return <BoardKanbanSkeleton />;
  }

  if (!board) {
    return (
      <section className="kanban-scroll p-4 sm:p-6">
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-center">
          <h2 className="text-base font-semibold">구성된 Board가 없습니다</h2>
          <p className="mt-1 text-sm text-slate-500">
            GitHub에서 저장소와 ProjectV2를 선택하면 Board cache를 구성합니다.
          </p>
        </div>
      </section>
    );
  }

  if (!orderedColumns.length) {
    return (
      <section className="kanban-scroll p-4 sm:p-6">
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-center">
          <h2 className="text-base font-semibold">컬럼이 없습니다</h2>
          <p className="mt-1 text-sm text-slate-500">
            GitHub ProjectV2 Status field를 동기화한 뒤 Board를 새로고침하세요.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      id="kanban"
      className="kanban-scroll overflow-x-auto p-4 sm:p-6"
      aria-label="보드 칸반"
    >
      {isMobile ? (
        <>
          <div
            className="mb-3 flex max-w-full gap-2 overflow-x-auto pb-1"
            role="tablist"
            aria-label="Board 컬럼"
          >
            {orderedColumns.map((column) => {
              const issueCount = issuesByColumnId.get(column.id)?.length ?? 0;

          return (
            <button
              key={column.id}
              type="button"
              role="tab"
              id={`board-column-tab-${column.id}`}
              aria-controls={`board-column-panel-${column.id}`}
              aria-selected={resolvedMobileColumnId === column.id}
              tabIndex={resolvedMobileColumnId === column.id ? 0 : -1}
              className={cn(
                "inline-flex h-9 max-w-48 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600",
                resolvedMobileColumnId === column.id &&
                  "border-violet-300 bg-violet-50 text-violet-700"
              )}
              onClick={() => setMobileColumnId(column.id)}
              onKeyDown={handleMobileTabKeyDown}
            >
              <span className="truncate">{column.name}</span>
              <span className="font-mono text-xs">{issueCount}</span>
            </button>
          );
            })}
          </div>

          <div>
            {orderedColumns.map((column, index) => {
              const isSelected = resolvedMobileColumnId === column.id;

          return (
            <div
              key={column.id}
              id={`board-column-panel-${column.id}`}
              role="tabpanel"
              aria-labelledby={`board-column-tab-${column.id}`}
              hidden={!isSelected}
            >
              {isSelected ? renderColumn(column, index, false, true) : null}
            </div>
          );
            })}
          </div>

        </>
      ) : (
        <div
          className="kanban-board grid grid-flow-col auto-cols-[minmax(16rem,1fr)] gap-3.5"
          style={{
            gridAutoColumns: "minmax(16rem, 1fr)",
            minWidth: `max(100%, ${Math.max(orderedColumns.length, 1) * 16}rem)`
          }}
          role="list"
        >
          {orderedColumns.map((column, index) =>
            renderColumn(column, index, true, true)
          )}
        </div>
      )}
    </section>
  );
}
