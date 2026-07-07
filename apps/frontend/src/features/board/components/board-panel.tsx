"use client";

import {
  KanbanSquare,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardHydrationForm } from "@/features/board/components/board-hydration-form";
import { BoardIssueCreateForm } from "@/features/board/components/board-issue-create-form";
import { BoardIssueSheet } from "@/features/board/components/board-issue-sheet";
import { BoardKanban } from "@/features/board/components/board-kanban";
import { useBoardWorkspaceData } from "@/features/board/hooks/use-board-workspace-data";
import { boardNavigation } from "@/features/board/navigation";
import type {
  BoardIssueCardPayload,
  BoardIssueState
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
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [selectedProjectV2Id, setSelectedProjectV2Id] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<BoardIssueState | "">("");
  const [assignee, setAssignee] = useState("");
  const [label, setLabel] = useState("");
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const [issueCreateError, setIssueCreateError] = useState<string | null>(null);
  const [statusMoveError, setStatusMoveError] = useState<string | null>(null);
  const [isHydrating, setIsHydrating] = useState(false);
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
    if (!boardData.boards.length) {
      setSelectedBoardId("");
      return;
    }

    if (
      !selectedBoardId ||
      !boardData.boards.some((board) => board.id === selectedBoardId)
    ) {
      setSelectedBoardId(boardData.boards[0].id);
    }
  }, [boardData.boards, selectedBoardId]);

  useEffect(() => {
    if (!selectedBoardSummary) return;

    setSelectedRepositoryId(selectedBoardSummary.repository.id);
    setSelectedProjectV2Id(selectedBoardSummary.project.id);
  }, [selectedBoardSummary]);

  useEffect(() => {
    if (selectedBoardSummary) return;

    if (!selectedRepositoryId && boardData.repositories[0]) {
      setSelectedRepositoryId(boardData.repositories[0].id);
    }

    if (!selectedProjectV2Id && boardData.projects[0]) {
      setSelectedProjectV2Id(boardData.projects[0].id);
    }
  }, [
    boardData.projects,
    boardData.repositories,
    selectedBoardSummary,
    selectedProjectV2Id,
    selectedRepositoryId
  ]);

  async function handleHydrateBoard() {
    if (!selectedRepositoryId || !selectedProjectV2Id) {
      setHydrateError("저장소와 ProjectV2를 선택해주세요.");
      return;
    }

    setIsHydrating(true);
    setHydrateError(null);

    try {
      const board = await boardData.hydrateBoard({
        projectV2Id: selectedProjectV2Id,
        repositoryId: selectedRepositoryId
      });
      setSelectedBoardId(board.id);
    } catch (error) {
      setHydrateError(
        error instanceof Error
          ? error.message
          : "Board hydrate를 완료하지 못했습니다."
      );
    } finally {
      setIsHydrating(false);
    }
  }

  function handleOpenIssue(issue: BoardIssueCardPayload) {
    setSelectedIssueId(issue.id);
  }

  async function handleCreateIssue(input: {
    body?: string;
    columnId: string;
    title: string;
  }) {
    setIsCreatingIssue(true);
    setIssueCreateError(null);

    try {
      const issue = await boardData.createBoardIssue(input);
      setSelectedIssueId(issue.id);
    } catch (error) {
      setIssueCreateError(
        error instanceof Error ? error.message : "Board issue를 생성하지 못했습니다."
      );
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
      <section className="board-toolbar flex min-h-[74px] flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-7 py-5 backdrop-blur">
        <div className="board-title flex min-w-0 items-center gap-3">
          <div className="board-icon grid size-10 shrink-0 place-items-center rounded-xl border border-violet-200 bg-violet-50 text-violet-600">
            <KanbanSquare className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[26px] font-bold leading-tight tracking-normal">
              {selectedBoardSummary?.name ?? boardNavigation.title}
            </h1>
            <p className="mt-1 truncate text-[12.5px] font-medium text-slate-500">
              {selectedBoardSummary?.repository.fullName ??
                boardNavigation.description}
            </p>
          </div>
        </div>

        <div className="board-controls flex min-w-0 flex-wrap items-center justify-end gap-2">
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
            disabled={!boardData.boards.length || isBoardLoading}
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

      <div className="board-hydrate-dock border-b border-slate-200 bg-white/70 px-7 py-4">
        <BoardHydrationForm
          error={hydrateError}
          isHydrating={isHydrating}
          projects={boardData.projects}
          repositories={boardData.repositories}
          selectedProjectV2Id={selectedProjectV2Id}
          selectedRepositoryId={selectedRepositoryId}
          onHydrate={() => void handleHydrateBoard()}
          onSelectProjectV2={setSelectedProjectV2Id}
          onSelectRepository={setSelectedRepositoryId}
        />
      </div>

      <div className="board-issue-create-dock border-b border-slate-200 bg-white/70 px-7 py-4">
        <BoardIssueCreateForm
          columns={boardData.columns}
          disabled={!canUseBoard || !selectedBoardId || isBoardLoading}
          error={issueCreateError}
          isCreating={isCreatingIssue}
          onCreateIssue={(input) => handleCreateIssue(input)}
        />
      </div>

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
