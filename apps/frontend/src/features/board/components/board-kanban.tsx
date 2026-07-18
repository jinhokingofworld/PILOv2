"use client";

import {
  Clock3,
  ExternalLink,
  GitPullRequestArrow
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  BoardColumnPayload,
  BoardDetailPayload,
  BoardIssueCardPayload
} from "@/features/board/types";
import {
  formatBoardDateTime,
  formatBoardIssueNumber,
  formatBoardIssueState,
  readBoardAssigneeLogin,
  readBoardLabelColor,
  readBoardLabelName
} from "@/features/board/utils/board-format";
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

function issueStateClassName(issue: BoardIssueCardPayload) {
  if (issue.state === "closed") {
    return "bg-emerald-50 text-emerald-700";
  }

  return "bg-violet-50 text-violet-700";
}

function readAssigneeInitials(login: string) {
  return login
    .split(/[-_\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function BoardIssueCard({
  issue,
  moving,
  onOpenIssue,
  onDragEnd,
  onDragStart,
  selected
}: {
  issue: BoardIssueCardPayload;
  moving: boolean;
  onOpenIssue: (issue: BoardIssueCardPayload) => void;
  onDragEnd: () => void;
  onDragStart: (issue: BoardIssueCardPayload) => void;
  selected: boolean;
}) {
  const visibleLabels = issue.labels
    .map((label) => ({
      color: readBoardLabelColor(label),
      name: readBoardLabelName(label)
    }))
    .filter((label): label is { color: string | null; name: string } =>
      Boolean(label.name)
    )
    .slice(0, 3);
  const visibleAssignees = issue.assignees
    .map(readBoardAssigneeLogin)
    .filter((login): login is string => Boolean(login))
    .slice(0, 3);

  return (
    <button
      {...pageCursorTargetAttributes({
        id: issue.id,
        label: issue.title,
        type: "board_issue"
      })}
      type="button"
      draggable={!moving}
      className={cn(
        "issue-card flex min-h-36 w-full cursor-grab flex-col items-stretch gap-3 rounded-[14px] border border-slate-200 bg-white p-4 text-left text-slate-950 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 active:cursor-grabbing",
        selected && "border-violet-400 ring-2 ring-violet-200",
        moving && "pointer-events-none opacity-60"
      )}
      aria-busy={moving}
      onClick={() => onOpenIssue(issue)}
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          "application/x-pilo-board-issue",
          JSON.stringify({
            issueId: issue.id,
            previousColumnId: issue.columnId
          } satisfies DraggedIssue)
        );
        onDragStart(issue);
      }}
    >
      <span className="card-top flex items-center justify-between gap-3">
        <span className="issue-key font-mono text-[17.25px] font-bold text-slate-500">
          {formatBoardIssueNumber(issue)}
        </span>
        <span
          className={cn(
            "state inline-flex min-h-[33px] items-center rounded-full px-2 text-[15.75px] font-extrabold",
            issueStateClassName(issue)
          )}
        >
          {formatBoardIssueState(issue.state)}
        </span>
      </span>

      <strong className="card-title line-clamp-2 text-[23.25px] font-bold leading-8 tracking-normal">
        {issue.title}
      </strong>

      {visibleLabels.length ? (
        <span className="tags flex min-h-9 flex-wrap items-center gap-1.5">
          {visibleLabels.map((label) => (
            <span
              key={label.name}
              className="tag inline-flex min-h-[33px] max-w-32 items-center truncate rounded-full border border-slate-200 bg-slate-50 px-2 text-[15.75px] font-bold text-slate-600"
              style={{
                borderColor: label.color ?? undefined,
                color: label.color ?? undefined
              }}
            >
              {label.name}
            </span>
          ))}
        </span>
      ) : null}

      <span className="card-footer mt-auto flex items-center justify-between gap-2 text-[17.25px] text-slate-400">
        <span className="avatars flex items-center">
          {visibleAssignees.length ? (
            visibleAssignees.map((login) => (
              <span
                key={login}
                className="avatar -ml-1.5 first:ml-0 grid size-6 place-items-center rounded-full border-2 border-white bg-violet-500 font-mono text-[14.25px] font-extrabold text-white"
                title={`@${login}`}
              >
                {readAssigneeInitials(login) || "?"}
              </span>
            ))
          ) : (
            <span className="font-semibold">담당자 없음</span>
          )}
        </span>
        <span className="stats flex min-w-0 items-center justify-end gap-1.5">
          <Clock3 className="size-3.5 shrink-0" />
          <span className="truncate">{formatBoardDateTime(issue.githubUpdatedAt)}</span>
        </span>
      </span>
    </button>
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
  const [draggedIssue, setDraggedIssue] = useState<DraggedIssue | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const issuesByColumnId = useMemo(() => {
    const nextIssuesByColumnId = new Map<string, BoardIssueCardPayload[]>();

    columns.forEach((column) => {
      nextIssuesByColumnId.set(column.id, []);
    });

    issues.forEach((issue) => {
      const columnIssues = nextIssuesByColumnId.get(issue.columnId) ?? [];
      columnIssues.push(issue);
      nextIssuesByColumnId.set(issue.columnId, columnIssues);
    });

    return nextIssuesByColumnId;
  }, [columns, issues]);

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

  if (boardStatus === "loading") {
    return (
      <div className="kanban-scroll overflow-x-auto p-6">
        <div className="kanban-board grid min-w-[1060px] grid-cols-5 gap-3.5">
          {[0, 1, 2, 3, 4].map((index) => (
            <article
              key={index}
              className="lane min-h-[calc(100vh-252px)] rounded-2xl border border-slate-200 bg-white/50"
            >
              <div className="lane-header flex min-h-[81px] items-center justify-between gap-2 border-b border-slate-200 px-3 py-3">
                <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
                <div className="h-9 w-8 animate-pulse rounded-full bg-slate-200" />
              </div>
              <div className="lane-stack grid gap-2.5 p-3">
                <div className="h-36 animate-pulse rounded-[14px] bg-slate-200" />
                <div className="h-36 animate-pulse rounded-[14px] bg-slate-200" />
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <section className="kanban-scroll p-6">
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center">
          <h2 className="text-[27px] font-bold">구성된 Board가 없습니다</h2>
          <p className="mt-2 text-[21px] font-medium text-slate-500">
            GitHub에서 저장소와 ProjectV2를 선택하면 Board cache를 구성합니다.
          </p>
        </div>
      </section>
    );
  }

  if (!columns.length) {
    return (
      <section className="kanban-scroll p-6">
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center">
          <h2 className="text-[27px] font-bold">컬럼이 없습니다</h2>
          <p className="mt-2 text-[21px] font-medium text-slate-500">
            GitHub ProjectV2 Status field를 동기화한 뒤 Board를 새로고침하세요.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="kanban" className="kanban-scroll overflow-x-auto p-6" aria-label="보드 칸반">
      <div className="mb-3 flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-[48px] text-[19.2px]"
          disabled={!board.repository.htmlUrl}
          onClick={() => window.open(board.repository.htmlUrl, "_blank", "noopener")}
        >
          <ExternalLink />
          저장소
        </Button>
      </div>

      <div
        className="kanban-board grid min-w-[1060px] gap-3.5"
        style={{
          gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(196px, 1fr))`
        }}
      >
        {columns.map((column, index) => {
          const columnIssues = issuesByColumnId.get(column.id) ?? [];

          return (
            <article
              {...pageCursorTargetAttributes({
                id: column.id,
                label: column.name,
                type: "board_column"
              })}
              id={column.normalizedName ?? column.id}
              key={column.id}
              className={cn(
                "lane flex min-h-[calc(100vh-252px)] flex-col rounded-2xl border border-slate-200 bg-white/50 transition",
                dragOverColumnId === column.id &&
                  "border-violet-300 bg-violet-50/60 ring-2 ring-violet-100"
              )}
              onDragLeave={(event) => {
                const nextTarget = event.relatedTarget;
                if (
                  !(nextTarget instanceof Node) ||
                  !event.currentTarget.contains(nextTarget)
                ) {
                  setDragOverColumnId(null);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverColumnId(column.id);
              }}
              onDrop={(event) => handleDrop(event, column.id)}
              role="listitem"
            >
              <header className="lane-header flex min-h-[81px] items-center justify-between gap-2 border-b border-slate-200 px-3 py-3">
                <div className="lane-name flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "dot size-[9px] shrink-0 rounded-full",
                      columnToneClassName(index)
                    )}
                  />
                  <div className="min-w-0">
                    <h2 className="truncate text-[21.75px] font-bold leading-7">
                      {column.name}
                    </h2>
                    <span className="block truncate text-[17.25px] font-medium text-slate-400">
                      ProjectV2 Status
                    </span>
                  </div>
                </div>
                <span className="lane-count inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-slate-200 bg-white px-2 font-mono text-[16.5px] font-bold text-slate-500">
                  {columnIssues.length}
                </span>
              </header>

              <div className="lane-stack grid gap-2.5 p-3">
                {columnIssues.length ? (
                  columnIssues.map((issue) => (
                    <BoardIssueCard
                      key={issue.id}
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
                  <div className="empty-slot grid min-h-[129px] place-items-center rounded-[14px] border border-dashed border-slate-300 bg-white/50 px-3 text-center text-[18px] font-bold text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <GitPullRequestArrow className="size-4" />
                      표시할 이슈가 없습니다.
                    </span>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
