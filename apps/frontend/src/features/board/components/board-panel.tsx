"use client";

import {
  Loader2,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardIssueCreateDialog } from "@/features/board/components/board-issue-create-dialog";
import { BoardIssueSheet } from "@/features/board/components/board-issue-sheet";
import { BoardKanban } from "@/features/board/components/board-kanban";
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

const selectClassName =
  "h-9 rounded-[11px] border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-sm outline-none transition focus-visible:border-violet-300 focus-visible:ring-2 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-50";

function SummaryChip({
  children,
  tone = "default"
}: {
  children: React.ReactNode;
  tone?: "default" | "danger" | "success" | "warning";
}) {
  return (
    <span
      className={cn(
        "summary-chip inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border bg-white px-3 text-[11.5px] font-bold text-slate-600 shadow-sm",
        tone === "danger" && "border-red-200 bg-red-50 text-red-600",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-700"
      )}
    >
      {children}
    </span>
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
    reloadActiveSource: boardData.reloadWorkspace,
    reloadBoard: boardData.reloadBoard,
    workspaceId
  });
  const selectedBoardSummary = boardData.boards.find(
    (board) => board.id === selectedBoardId
  );
  const canUseBoard = Boolean(workspaceId.trim() && accessToken);
  const needsSignIn = !accessToken;
  const isCatalogLoading = boardData.catalogStatus === "loading";
  const isBoardLoading = boardData.boardStatus === "loading";
  const totalCards = boardData.board?.summary.totalCards ?? boardData.issues.length;
  const openCards = boardData.board?.summary.openCards ?? "-";
  const closedCards = boardData.board?.summary.closedCards ?? "-";
  const syncLabel = boardData.board?.sync.status ?? selectedBoardSummary?.syncStatus ?? "-";
  const syncTime =
    boardData.board?.sync.lastSyncedAt ??
    selectedBoardSummary?.lastSyncedAt ??
    null;

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
  }, [boardData.activeSource?.boardId, selectedBoardId]);

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
    void boardData.reloadBoard();
  }

  return (
    <div
      data-board-main
      className="workspace-board -m-6 min-h-[calc(100vh-3.5rem)] overflow-hidden border-l border-slate-200 bg-slate-50 text-slate-950"
    >
      <section className="board-toolbar flex min-h-[74px] items-center justify-end border-b border-slate-200 bg-white/90 px-7 py-5 backdrop-blur">
        <div className="board-controls flex w-full min-w-0 flex-wrap items-center justify-end gap-2">
          <label className="relative w-[min(100%,260px)] min-w-48">
            <span className="sr-only">이슈 검색</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-9 rounded-[11px] border-slate-200 bg-white pl-9 text-[12.5px] shadow-sm"
              value={query}
              placeholder="Search issues"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setSelectedIssueId(null);
              }}
            />
          </label>

          <select
            className={selectClassName}
            disabled
            value={selectedBoardId}
            onChange={(event) => {
              setSelectedBoardId(event.currentTarget.value);
              setSelectedIssueId(null);
            }}
          >
            <option value="">Board 선택</option>
            {boardData.boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canUseBoard || isCatalogLoading || isBoardLoading}
            onClick={() => {
              void boardData.reloadWorkspace();
              void boardData.reloadBoard();
            }}
          >
            {isCatalogLoading || isBoardLoading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            새로고침
          </Button>

          <Button
            type="button"
            size="sm"
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
        <p className="mx-7 mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-500">
          Board를 보려면 로그인이 필요합니다.
        </p>
      ) : null}

      {boardData.catalogError ? (
        <p className="mx-7 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          GitHub repository, ProjectV2 또는 Board 목록을 불러오지 못했습니다.
        </p>
      ) : null}

      <section className="board-summary flex items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white/60 px-7 py-4">
        <SummaryChip>
          Columns <strong className="font-mono text-slate-950">{boardData.columns.length}</strong>
        </SummaryChip>
        <SummaryChip>
          Cards <strong className="font-mono text-slate-950">{totalCards}</strong>
        </SummaryChip>
        <SummaryChip tone="success">
          Open <strong className="font-mono">{openCards}</strong>
        </SummaryChip>
        <SummaryChip tone="danger">
          Closed <strong className="font-mono">{closedCards}</strong>
        </SummaryChip>
        <SummaryChip tone={syncLabel === "failed" ? "danger" : "default"}>
          Sync <strong className="font-mono">{syncLabel}</strong>
        </SummaryChip>
        <SummaryChip tone="warning">
          Updated{" "}
          <strong className="font-mono">
            {syncTime ? formatBoardDateTime(syncTime) : "never"}
          </strong>
        </SummaryChip>
      </section>

      <section className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/50 px-7 py-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500">
          <SlidersHorizontal className="size-4" />
          Filters
        </span>
        <select
          className={selectClassName}
          value={state}
          onChange={(event) => {
            setState(event.currentTarget.value as BoardIssueState | "");
            setSelectedIssueId(null);
          }}
        >
          <option value="">상태 전체</option>
          {(boardData.filterOptions?.states ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({option.count})
            </option>
          ))}
        </select>
        <select
          className={selectClassName}
          value={assignee}
          onChange={(event) => {
            setAssignee(event.currentTarget.value);
            setSelectedIssueId(null);
          }}
        >
          <option value="">담당자 전체</option>
          {(boardData.filterOptions?.assignees ?? []).map((option) => (
            <option key={option.login} value={option.login}>
              @{option.login} ({option.count})
            </option>
          ))}
        </select>
        <select
          className={selectClassName}
          value={label}
          onChange={(event) => {
            setLabel(event.currentTarget.value);
            setSelectedIssueId(null);
          }}
        >
          <option value="">Label 전체</option>
          {(boardData.filterOptions?.labels ?? []).map((option) => (
            <option key={option.name} value={option.name}>
              {option.name} ({option.count})
            </option>
          ))}
        </select>
      </section>

      {boardData.boardError ? (
        <p className="mx-7 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          Board 상세, 컬럼 또는 이슈를 불러오지 못했습니다.
        </p>
      ) : null}

      {statusMoveError ? (
        <p className="mx-7 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
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
    </div>
  );
}
