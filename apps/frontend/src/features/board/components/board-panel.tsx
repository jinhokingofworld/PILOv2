"use client";

import {
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { BoardIssueCreateDialog } from "@/features/board/components/board-issue-create-dialog";
import { BoardIssueSheet } from "@/features/board/components/board-issue-sheet";
import { BoardKanban } from "@/features/board/components/board-kanban";
import { BoardWorkspaceLocationAdapter } from "@/features/board/board-workspace-location-adapter";
import { useBoardWorkspaceData } from "@/features/board/hooks/use-board-workspace-data";
import { useBoardRealtime } from "@/features/board/realtime/use-board-realtime";
import type {
  BoardIssueCardPayload,
  BoardIssueState,
  CreateBoardIssueCommand
} from "@/features/board/types";
import { formatBoardDateTime } from "@/features/board/utils/board-format";
import { useAuthSession } from "@/features/auth";
import { cn } from "@/lib/utils";
import { PageCursorSurface } from "@/shared/page-cursor/PageCursorSurface";
import { pageCursorTargetAttributes } from "@/shared/page-cursor/page-cursor-target";

function SummaryChip({
  children,
  tone = "default"
}: {
  children: React.ReactNode;
  tone?: "default" | "danger" | "success" | "warning";
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "summary-chip h-6 shrink-0 gap-1 rounded-full border-slate-200 bg-white px-2 text-xs font-medium text-slate-600",
        tone === "danger" && "border-red-200 bg-red-50 text-red-600",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-700"
      )}
    >
      {children}
    </Badge>
  );
}

export function BoardPanel() {
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const accessToken = authSession?.accessToken.trim() ?? "";
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [isIssueCreateModalOpen, setIsIssueCreateModalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<BoardIssueState | "">("");
  const [assignee, setAssignee] = useState("");
  const [label, setLabel] = useState("");
  const [issueCreateError, setIssueCreateError] = useState<string | null>(null);
  const [statusMoveError, setStatusMoveError] = useState<string | null>(null);
  const [isCreatingIssue, setIsCreatingIssue] = useState(false);
  const [movingIssueId, setMovingIssueId] = useState<string | null>(null);
  const issueQuery = useMemo(
    () => ({
      assignee: assignee || undefined,
      label: label || undefined,
      page: 1,
      search: query.trim() || undefined,
      state: state || undefined
    }),
    [assignee, label, query, state]
  );
  const boardData = useBoardWorkspaceData({
    accessToken,
    boardId: selectedBoardId,
    issueQuery,
    workspaceId
  });
  useBoardRealtime({
    accessToken,
    boardId: selectedBoardId,
    reloadActiveSource: boardData.refreshWorkspace,
    reloadBoard: boardData.refreshBoard,
    workspaceId
  });
  const selectedBoardSummary = boardData.boards.find(
    (board) => board.id === selectedBoardId
  );
  const allowedBoardIds = useMemo(
    () => boardData.boards.map((board) => board.id),
    [boardData.boards]
  );
  const canUseBoard = Boolean(workspaceId.trim() && accessToken);
  const needsSignIn = !accessToken;
  const isCatalogLoading = boardData.catalogStatus === "loading";
  const isBoardLoading = boardData.boardStatus === "loading";
  const totalCards = boardData.board?.summary.totalCards ?? "-";
  const openCards = boardData.board?.summary.openCards ?? "-";
  const closedCards = boardData.board?.summary.closedCards ?? "-";
  const syncTime =
    boardData.board?.sync.lastSyncedAt ??
    selectedBoardSummary?.lastSyncedAt ??
    null;
  const repositoryUrl = boardData.board?.repository.htmlUrl ?? "";
  const stateFilterLabel = state
    ? (boardData.filterOptions?.states.find((option) => option.value === state)
        ?.label ?? state)
    : "전체";
  const assigneeFilterLabel = assignee ? `@${assignee}` : "전체";
  const labelFilterLabel = label || "전체";

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const issueId = searchParams.get("issueId")?.trim() ?? "";

    if (issueId) {
      setSelectedIssueId(issueId);
    }
  }, []);

  useEffect(() => {
    const activeBoardId = boardData.activeSource?.boardId;
    if (activeBoardId) {
      if (selectedBoardId !== activeBoardId) {
        setSelectedBoardId(activeBoardId);
      }
      return;
    }

    if (selectedBoardId) {
      setSelectedBoardId("");
    }
  }, [boardData.activeSource?.boardId]);

  function handleOpenIssue(issue: BoardIssueCardPayload) {
    setSelectedIssueId(issue.id);
  }

  async function handleCreateIssue(
    input: CreateBoardIssueCommand
  ): Promise<boolean> {
    setIsCreatingIssue(true);
    setIssueCreateError(null);

    try {
      const issue = await boardData.createBoardIssue(input);
      setIsIssueCreateModalOpen(false);
      setSelectedIssueId(issue.id);
      return true;
    } catch (error) {
      setIssueCreateError(
        error instanceof Error ? error.message : "Board issue를 생성하지 못했습니다."
      );
      return false;
    } finally {
      setIsCreatingIssue(false);
    }
  }

  async function handleMoveIssueStatus(input: {
    issueId: string;
    columnId: string;
    previousColumnId: string;
  }) {
    if (input.columnId === input.previousColumnId) {
      return;
    }

    setMovingIssueId(input.issueId);
    setStatusMoveError(null);

    try {
      await boardData.moveIssueStatus(input.issueId, {
        columnId: input.columnId,
        previousColumnId: input.previousColumnId
      });
    } catch (error) {
      setStatusMoveError(
        error instanceof Error
          ? error.message
          : "Board issue status를 변경하지 못했습니다."
      );
    } finally {
      setMovingIssueId(null);
    }
  }

  function handleIssueUpdated() {
    void boardData.refreshBoard();
  }

  return (
    <PageCursorSurface
      boardId={selectedBoardId}
      data-board-main
      data-workspace-follow-board-id={boardData.board?.id ?? ""}
      className="workspace-board relative -m-6 min-h-[calc(100vh-3.5rem)] overflow-hidden border-l border-slate-200 bg-slate-50 text-slate-950"
      enabled={Boolean(canUseBoard && selectedBoardId)}
      page="board"
      workspaceId={workspaceId}
    >
      <BoardWorkspaceLocationAdapter
        allowedBoardIds={allowedBoardIds}
        onSelectBoard={setSelectedBoardId}
        onSelectIssue={setSelectedIssueId}
      />
      <section className="board-toolbar border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold">Board</h1>

        <div className="board-summary mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <SummaryChip>
            전체 <strong className="font-mono text-slate-950">{totalCards}</strong>
          </SummaryChip>
          <SummaryChip tone="success">
            열림 <strong className="font-mono">{openCards}</strong>
          </SummaryChip>
          <SummaryChip tone="danger">
            닫힘 <strong className="font-mono">{closedCards}</strong>
          </SummaryChip>
          <span className="inline-flex h-6 items-center gap-1 px-1">
            마지막 업데이트
            <strong className="font-mono font-medium text-slate-700">
              {syncTime ? formatBoardDateTime(syncTime) : "-"}
            </strong>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!repositoryUrl}
            onClick={() => window.open(repositoryUrl, "_blank", "noopener")}
          >
            <ExternalLink />
            GitHub 저장소
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!canUseBoard || isCatalogLoading || isBoardLoading}
            onClick={() => {
              void boardData.refreshWorkspace();
              void boardData.refreshBoard();
            }}
          >
            {isCatalogLoading || isBoardLoading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            새로고침
          </Button>
        </div>

        <div className="board-controls mt-3 flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600">
            <SlidersHorizontal className="size-4" />
            필터
          </span>

          <Select
            value={state || "__all__"}
            onValueChange={(value) => {
              setState(
                value && value !== "__all__" ? (value as BoardIssueState) : ""
              );
              setSelectedIssueId(null);
            }}
          >
            <SelectTrigger
              aria-label={`상태 필터: ${stateFilterLabel}`}
              className={cn(
                "h-9 min-w-28 border-slate-300 bg-white",
                state && "border-violet-300 bg-violet-50 text-violet-700"
              )}
            >
              <SelectValue>상태: {stateFilterLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">상태 전체</SelectItem>
              {(boardData.filterOptions?.states ?? []).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={assignee || "__all__"}
            onValueChange={(value) => {
              setAssignee(value && value !== "__all__" ? value : "");
              setSelectedIssueId(null);
            }}
          >
            <SelectTrigger
              aria-label={`담당자 필터: ${assigneeFilterLabel}`}
              className={cn(
                "h-9 min-w-32 border-slate-300 bg-white",
                assignee && "border-violet-300 bg-violet-50 text-violet-700"
              )}
            >
              <SelectValue>담당자: {assigneeFilterLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">담당자 전체</SelectItem>
              {(boardData.filterOptions?.assignees ?? []).map((option) => (
                <SelectItem key={option.login} value={option.login}>
                  @{option.login} ({option.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={label || "__all__"}
            onValueChange={(value) => {
              setLabel(value && value !== "__all__" ? value : "");
              setSelectedIssueId(null);
            }}
          >
            <SelectTrigger
              aria-label={`라벨 필터: ${labelFilterLabel}`}
              className={cn(
                "h-9 min-w-28 border-slate-300 bg-white",
                label && "border-violet-300 bg-violet-50 text-violet-700"
              )}
            >
              <SelectValue>라벨: {labelFilterLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">라벨 전체</SelectItem>
              {(boardData.filterOptions?.labels ?? []).map((option) => (
                <SelectItem key={option.name} value={option.name}>
                  {option.name} ({option.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="hidden flex-1 lg:block" />

          <label className="relative min-w-48 flex-1 lg:max-w-72">
            <span className="sr-only">이슈 검색</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-9 rounded-lg border-slate-300 bg-white pl-9 text-sm shadow-sm md:text-sm"
              value={query}
              placeholder="Search issues"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setSelectedIssueId(null);
              }}
            />
          </label>

          <Button
            {...pageCursorTargetAttributes({
              id: "create-issue",
              label: "이슈 추가",
              type: "board_action"
            })}
            type="button"
            size="sm"
            className="h-9"
            disabled={!canUseBoard || !selectedBoardId || isBoardLoading}
            onClick={() => {
              setIssueCreateError(null);
              setIsIssueCreateModalOpen(true);
            }}
          >
            <Plus />
            새 이슈
          </Button>
        </div>
      </section>

      {needsSignIn ? (
        <p className="mx-7 mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-[21px] font-medium text-slate-500">
          Board를 보려면 로그인이 필요합니다.
        </p>
      ) : null}

      {boardData.catalogError ? (
        <p className="mx-7 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[21px] font-medium text-red-600">
          GitHub repository, ProjectV2 또는 Board 목록을 불러오지 못했습니다.
        </p>
      ) : null}

      {boardData.boardError ? (
        <p className="mx-7 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[21px] font-medium text-red-600">
          Board 상세, 컬럼 또는 이슈를 불러오지 못했습니다.
        </p>
      ) : null}

      {statusMoveError ? (
        <p className="mx-7 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[21px] font-medium text-red-600">
          {statusMoveError}
        </p>
      ) : null}

      <BoardKanban
        board={boardData.board}
        boardStatus={boardData.boardStatus}
        columns={boardData.columns}
        issues={boardData.issues}
        movingIssueId={movingIssueId}
        selectedIssueId={selectedIssueId}
        onOpenIssue={handleOpenIssue}
        onMoveIssue={(input) => void handleMoveIssueStatus(input)}
      />

      <section id="issues" className="sr-only" aria-label="이슈 상세" />

      <BoardIssueCreateDialog
        columns={boardData.columns}
        disabled={!canUseBoard || !selectedBoardId || isBoardLoading}
        error={issueCreateError}
        isCreating={isCreatingIssue}
        open={isIssueCreateModalOpen}
        onClose={() => {
          if (isCreatingIssue) {
            return;
          }

          setIsIssueCreateModalOpen(false);
          setIssueCreateError(null);
        }}
        onCreateIssue={(input) => handleCreateIssue(input)}
      />

      <BoardIssueSheet
        accessToken={accessToken}
        boardId={selectedBoardId}
        issueId={selectedIssueId}
        workspaceId={workspaceId}
        onClose={() => setSelectedIssueId(null)}
        onIssueUpdated={handleIssueUpdated}
      />
    </PageCursorSurface>
  );
}
