"use client";

import { Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { BoardIssueCardPayload } from "@/features/board/types";
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

type BoardIssueCardProps = {
  enableCursorTarget: boolean;
  issue: BoardIssueCardPayload;
  moving: boolean;
  onOpenIssue: (issue: BoardIssueCardPayload) => void;
  onDragEnd: () => void;
  onDragStart: (issue: BoardIssueCardPayload) => void;
  selected: boolean;
};

function issueStateClassName(issue: BoardIssueCardPayload) {
  if (issue.state === "closed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  return "border-violet-200 bg-violet-50 text-violet-700";
}

function readAssigneeInitials(login: string) {
  return login
    .split(/[-_\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function BoardIssueCard({
  enableCursorTarget,
  issue,
  moving,
  onOpenIssue,
  onDragEnd,
  onDragStart,
  selected
}: BoardIssueCardProps) {
  const labels = issue.labels
    .map((label) => ({
      color: readBoardLabelColor(label),
      name: readBoardLabelName(label)
    }))
    .filter((label): label is { color: string | null; name: string } =>
      Boolean(label.name)
    );
  const visibleLabels = labels.slice(0, 3);
  const hiddenLabelCount = labels.length - visibleLabels.length;
  const assignees = issue.assignees
    .map(readBoardAssigneeLogin)
    .filter((login): login is string => Boolean(login));
  const visibleAssignees = assignees.slice(0, 1);
  const primaryAssignee = visibleAssignees[0] ?? null;
  const hiddenAssigneeCount = assignees.length - visibleAssignees.length;

  function openIssue() {
    onOpenIssue(issue);
  }

  return (
    <Card
      {...(enableCursorTarget
        ? pageCursorTargetAttributes({
            id: issue.id,
            label: issue.title,
            type: "board_issue"
          })
        : {})}
      draggable={!moving}
      role="button"
      tabIndex={0}
      aria-busy={moving}
      className={cn(
        "issue-card relative min-h-36 cursor-grab gap-3 overflow-hidden rounded-lg border border-slate-200 bg-white p-4 py-4 text-left text-slate-950 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 active:cursor-grabbing",
        selected && "border-violet-400 ring-2 ring-violet-200",
        moving && "pointer-events-none opacity-60"
      )}
      onClick={openIssue}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openIssue();
        }
      }}
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          "application/x-pilo-board-issue",
          JSON.stringify({
            issueId: issue.id,
            previousColumnId: issue.columnId
          })
        );
        onDragStart(issue);
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -right-5 -top-6 size-24 rounded-full border-[12px] opacity-[0.06]",
          issue.state === "closed" ? "border-emerald-600" : "border-violet-600"
        )}
      />

      <div className="relative z-10 flex items-center justify-between gap-3">
        <span className="issue-key font-mono text-sm font-bold text-slate-500">
          {formatBoardIssueNumber(issue)}
        </span>
        <Badge variant="outline" className={issueStateClassName(issue)}>
          {formatBoardIssueState(issue.state)}
        </Badge>
      </div>

      <strong className="card-title relative z-10 line-clamp-2 text-base font-bold leading-6">
        {issue.title}
      </strong>

      {visibleLabels.length ? (
        <div className="relative z-10 flex min-h-5 flex-wrap items-center gap-1">
          {visibleLabels.map((label) => (
            <Badge
              key={label.name}
              variant="outline"
              className="max-w-32 bg-slate-50/80"
              style={{
                borderColor: label.color ?? undefined,
                color: label.color ?? undefined
              }}
            >
              <span className="truncate">{label.name}</span>
            </Badge>
          ))}
          {hiddenLabelCount > 0 ? (
            <Badge variant="secondary">+{hiddenLabelCount}</Badge>
          ) : null}
        </div>
      ) : null}

      <div className="relative z-10 mt-auto flex min-w-0 items-center justify-between gap-2 text-xs text-slate-500">
        <span className="avatars flex min-w-0 items-center gap-1.5">
          {primaryAssignee ? (
            <>
              <span
                className="avatar grid size-6 shrink-0 place-items-center rounded-full border-2 border-white bg-violet-500 font-mono text-[10px] font-extrabold text-white"
                title={`@${primaryAssignee}`}
              >
                {readAssigneeInitials(primaryAssignee) || "?"}
              </span>
              <span className="truncate font-semibold">@{primaryAssignee}</span>
              {hiddenAssigneeCount > 0 ? (
                <Badge variant="secondary">+{hiddenAssigneeCount}</Badge>
              ) : null}
            </>
          ) : (
            <span className="font-semibold">담당자 없음</span>
          )}
        </span>
        <span className="flex min-w-0 shrink items-center justify-end gap-1">
          <Clock3 className="size-3.5 shrink-0" />
          <span className="truncate">{formatBoardDateTime(issue.githubUpdatedAt)}</span>
        </span>
      </div>
    </Card>
  );
}
