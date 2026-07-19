"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createBoardApiClient } from "@/features/board/api/client";
import {
  createBoardRequestCoordinator,
  resolveBackgroundSnapshot
} from "@/features/board/utils/board-request-coordinator";
import { selectBoardProjectRepositoryId } from "@/features/board/utils/board-project-repository";
import { loadAllBoardIssuePages } from "@/features/board/utils/board-issue-page-loader";
import type {
  BoardColumnPayload,
  BoardDetailPayload,
  BoardFilterOptionsPayload,
  BoardGithubProjectV2Payload,
  BoardGithubRepositoryPayload,
  BoardIssueCardPayload,
  BoardPaginatedPayload,
  BoardPayload,
  ActiveBoardSourcePayload,
  CreateBoardInput,
  CreateBoardIssueCommand,
  ListBoardIssuesQuery,
  UpdateBoardIssueStatusInput
} from "@/features/board/types";

type BoardWorkspaceStatus = "idle" | "loading" | "success" | "error";

type BoardWorkspaceCatalog = {
  repositories: BoardGithubRepositoryPayload[];
  projects: BoardGithubProjectV2Payload[];
  boards: BoardPayload[];
  boardsMeta: BoardPaginatedPayload<BoardPayload>["meta"] | null;
  activeSource: ActiveBoardSourcePayload | null;
};

type BoardWorkspaceBoardState = {
  board: BoardDetailPayload | null;
  columns: BoardColumnPayload[];
  issues: BoardIssueCardPayload[];
  issuesMeta: BoardPaginatedPayload<BoardIssueCardPayload>["meta"] | null;
  filterOptions: BoardFilterOptionsPayload | null;
};

type BoardIssuesLoadProgress = {
  error: Error | null;
  isLoading: boolean;
  loaded: number;
  total: number;
};

type UseBoardWorkspaceDataOptions = {
  accessToken?: string | null;
  boardId?: string;
  enabled?: boolean;
  issueQuery?: ListBoardIssuesQuery;
  repositoryId?: string | null;
  workspaceId: string;
};

const emptyCatalog: BoardWorkspaceCatalog = {
  repositories: [],
  projects: [],
  boards: [],
  boardsMeta: null,
  activeSource: null
};

const emptyBoardState: BoardWorkspaceBoardState = {
  board: null,
  columns: [],
  issues: [],
  issuesMeta: null,
  filterOptions: null
};
const BOARD_ISSUES_PAGE_LIMIT = 100;

function errorFromUnknown(error: unknown) {
  return error instanceof Error
    ? error
    : new Error("Board data could not be loaded");
}

export function useBoardWorkspaceData({
  accessToken = null,
  boardId = "",
  enabled = true,
  issueQuery = {},
  repositoryId = null,
  workspaceId
}: UseBoardWorkspaceDataOptions) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const normalizedBoardId = boardId.trim();
  const normalizedProjectRepositoryId = repositoryId?.trim() || null;
  const canLoad = Boolean(enabled && normalizedWorkspaceId && normalizedAccessToken);
  const issueQueryKey = JSON.stringify(issueQuery);
  const [catalog, setCatalog] = useState<BoardWorkspaceCatalog>(emptyCatalog);
  const [boardState, setBoardState] =
    useState<BoardWorkspaceBoardState>(emptyBoardState);
  const [catalogStatus, setCatalogStatus] =
    useState<BoardWorkspaceStatus>("idle");
  const [boardStatus, setBoardStatus] = useState<BoardWorkspaceStatus>("idle");
  const [catalogError, setCatalogError] = useState<Error | null>(null);
  const [boardError, setBoardError] = useState<Error | null>(null);
  const [issuesLoadProgress, setIssuesLoadProgress] =
    useState<BoardIssuesLoadProgress>({
      error: null,
      isLoading: false,
      loaded: 0,
      total: 0
    });
  const boardIssueLoadGeneration = useRef(0);
  const boardClient = useMemo(
    () => createBoardApiClient({ accessToken: normalizedAccessToken }),
    [normalizedAccessToken]
  );
  const catalogRequestCoordinator = useMemo(
    () => createBoardRequestCoordinator(),
    []
  );
  const boardRequestCoordinator = useMemo(
    () => createBoardRequestCoordinator(),
    []
  );

  const loadWorkspaceData = useCallback(async () => {
    if (!canLoad) {
      return emptyCatalog;
    }

    const [repositories, boards, activeSource] = await Promise.all([
      boardClient.listGithubRepositories(normalizedWorkspaceId, {
        includeArchived: false,
        limit: 100
      }),
      boardClient.listBoards(normalizedWorkspaceId, {
        limit: 50
      }),
      boardClient.getActiveBoardSource(normalizedWorkspaceId)
    ]);
    const selectedRepositoryId = selectBoardProjectRepositoryId(
      repositories,
      normalizedProjectRepositoryId
    );
    const projects = selectedRepositoryId
      ? await boardClient.listGithubProjectsV2(normalizedWorkspaceId, {
          closed: false,
          limit: 100,
          repositoryId: selectedRepositoryId
        })
      : [];

    return {
      repositories,
      projects,
      boards: boards.data,
      boardsMeta: boards.meta,
      activeSource
    };
  }, [
    boardClient,
    canLoad,
    normalizedProjectRepositoryId,
    normalizedWorkspaceId
  ]);

  const loadBoardData = useCallback(async () => {
    if (!canLoad || !normalizedBoardId) {
      return emptyBoardState;
    }

    const parsedIssueQuery = JSON.parse(issueQueryKey) as ListBoardIssuesQuery;
    const issueLoadGeneration = boardIssueLoadGeneration.current + 1;
    boardIssueLoadGeneration.current = issueLoadGeneration;
    const canPublishIssues = () =>
      boardIssueLoadGeneration.current === issueLoadGeneration;
    let latestIssues: BoardIssueCardPayload[] = [];
    let latestIssuesMeta: BoardPaginatedPayload<BoardIssueCardPayload>["meta"] | null =
      null;
    const boardContext = Promise.all([
      boardClient.getBoard(normalizedWorkspaceId, normalizedBoardId),
      boardClient.listBoardColumns(normalizedWorkspaceId, normalizedBoardId),
      boardClient.getBoardFilterOptions(normalizedWorkspaceId, normalizedBoardId)
    ]);
    setIssuesLoadProgress({
      error: null,
      isLoading: true,
      loaded: 0,
      total: 0
    });
    const issues = await loadAllBoardIssuePages({
      fetchPage: (page) =>
        boardClient.listBoardIssues(normalizedWorkspaceId, normalizedBoardId, {
          ...parsedIssueQuery,
          limit: BOARD_ISSUES_PAGE_LIMIT,
          page
        }),
      onFirstPage: (firstPage) => {
        latestIssues = firstPage.data;
        latestIssuesMeta = firstPage.meta;
        void boardContext.then(([board, columns, filterOptions]) => {
          if (!canPublishIssues()) return;

          setBoardState({
            board,
            columns,
            filterOptions,
            issues: latestIssues,
            issuesMeta: latestIssuesMeta
          });
          setIssuesLoadProgress({
            error: null,
            isLoading: firstPage.meta.total > latestIssues.length,
            loaded: latestIssues.length,
            total: firstPage.meta.total
          });
        });
      },
      onProgress: (result) => {
        if (!canPublishIssues()) return;

        latestIssues = result.items;
        latestIssuesMeta = result.meta;
        void boardContext.then(() => {
          if (!canPublishIssues()) return;

          setBoardState((current) => ({
            ...current,
            issues: latestIssues,
            issuesMeta: latestIssuesMeta
          }));
          setIssuesLoadProgress({
            error:
              result.failedPages.length > 0
                ? new Error("일부 이슈를 불러오지 못했습니다.")
                : null,
            isLoading: true,
            loaded: latestIssues.length,
            total: result.meta.total
          });
        });
      }
    });
    const [board, columns, filterOptions] = await boardContext;

    if (canPublishIssues()) {
      setIssuesLoadProgress({
        error:
          issues.failedPages.length > 0
            ? new Error("일부 이슈를 불러오지 못했습니다.")
            : null,
        isLoading: false,
        loaded: issues.items.length,
        total: issues.meta.total
      });
    }

    return {
      board,
      columns,
      issues: issues.items,
      issuesMeta: issues.meta,
      filterOptions
    };
  }, [
    boardClient,
    canLoad,
    issueQueryKey,
    normalizedBoardId,
    normalizedWorkspaceId
  ]);

  const reloadWorkspace = useCallback(async () => {
    if (!canLoad) {
      catalogRequestCoordinator.invalidate();
      setCatalog(emptyCatalog);
      setCatalogStatus("idle");
      setCatalogError(null);
      return emptyCatalog;
    }

    setCatalogStatus("loading");
    setCatalogError(null);

    const outcome = await catalogRequestCoordinator.run(loadWorkspaceData);
    if (outcome.status === "stale") {
      return null;
    }

    setCatalog((current) => resolveBackgroundSnapshot(current, outcome));
    if (outcome.status === "applied") {
      setCatalogStatus("success");
      return outcome.value;
    }
    if (outcome.status === "failed") {
      setCatalog(emptyCatalog);
      setCatalogError(errorFromUnknown(outcome.error));
      setCatalogStatus("error");
    }

    return emptyCatalog;
  }, [canLoad, catalogRequestCoordinator, loadWorkspaceData]);

  const refreshWorkspace = useCallback(async () => {
    if (!canLoad) {
      catalogRequestCoordinator.invalidate();
      setCatalogError(null);
      return null;
    }

    setCatalogError(null);

    const outcome = await catalogRequestCoordinator.run(loadWorkspaceData);
    if (outcome.status === "applied") {
      setCatalog(outcome.value);
      setCatalogStatus("success");
      return outcome.value;
    }
    if (outcome.status === "failed") {
      setCatalogError(errorFromUnknown(outcome.error));
      setCatalogStatus((current) =>
        current === "success" ? current : "error"
      );
    }

    return null;
  }, [canLoad, catalogRequestCoordinator, loadWorkspaceData]);

  const refreshBoard = useCallback(async () => {
    if (!canLoad || !normalizedBoardId) {
      boardRequestCoordinator.invalidate();
      boardIssueLoadGeneration.current += 1;
      setBoardError(null);
      return null;
    }

    setBoardError(null);

    const outcome = await boardRequestCoordinator.run(loadBoardData);
    if (outcome.status === "stale") {
      return null;
    }

    setBoardState((current) => resolveBackgroundSnapshot(current, outcome));
    if (outcome.status === "applied") {
      setBoardStatus("success");
      return outcome.value;
    }
    if (outcome.status === "failed") {
      setBoardError(errorFromUnknown(outcome.error));
      setBoardStatus((current) =>
        current === "success" ? current : "error"
      );
    }

    return null;
  }, [
    boardRequestCoordinator,
    canLoad,
    loadBoardData,
    normalizedBoardId
  ]);

  const hydrateBoard = useCallback(
    async (input: CreateBoardInput) => {
      if (!canLoad) {
        throw new Error("Board hydration requires an authenticated workspace");
      }

      const board = await boardClient.createBoard(normalizedWorkspaceId, input);
      await reloadWorkspace();
      return board;
    },
    [boardClient, canLoad, normalizedWorkspaceId, reloadWorkspace]
  );

  const moveIssueStatus = useCallback(
    async (
      issueId: string,
      input: UpdateBoardIssueStatusInput
    ): Promise<BoardIssueCardPayload> => {
      if (!canLoad || !normalizedBoardId) {
        throw new Error("Board status update requires an authenticated board");
      }

      const previousBoardState = boardState;
      const currentIssue = previousBoardState.issues.find(
        (issue) => issue.id === issueId
      );

      if (!currentIssue) {
        throw new Error("Board issue could not be found");
      }

      const mutation = boardRequestCoordinator.beginMutation();
      setBoardError(null);
      setBoardState((current) => ({
        ...current,
        issues: current.issues.map((issue) =>
          issue.id === issueId ? { ...issue, columnId: input.columnId } : issue
        )
      }));

      try {
        const result = await boardClient.updateBoardIssueStatus(
          normalizedWorkspaceId,
          normalizedBoardId,
          issueId,
          {
            columnId: input.columnId,
            previousColumnId: input.previousColumnId ?? currentIssue.columnId
          }
        );

        mutation.finish();
        setBoardState((current) => ({
          ...current,
          issues: current.issues.map((issue) =>
            issue.id === issueId ? result.issue : issue
          )
        }));

        return result.issue;
      } catch (error) {
        mutation.finish();
        setBoardState(previousBoardState);
        setBoardError(errorFromUnknown(error));
        void refreshBoard();
        throw error;
      }
    },
    [
      boardClient,
      boardRequestCoordinator,
      boardState,
      canLoad,
      normalizedBoardId,
      normalizedWorkspaceId,
      refreshBoard
    ]
  );

  const createBoardIssue = useCallback(
    async (input: CreateBoardIssueCommand): Promise<BoardIssueCardPayload> => {
      if (!canLoad || !normalizedBoardId) {
        throw new Error("Board issue creation requires an authenticated board");
      }

      const mutation = boardRequestCoordinator.beginMutation();
      setBoardError(null);

      try {
        const result = await boardClient.createBoardIssue(
          normalizedWorkspaceId,
          normalizedBoardId,
          input
        );

        mutation.finish();
        setBoardState((current) => {
          const hasIssue = current.issues.some(
            (issue) => issue.id === result.issue.id
          );
          const nextIssues = hasIssue
            ? current.issues.map((issue) =>
                issue.id === result.issue.id ? result.issue : issue
              )
            : [...current.issues, result.issue];

          return {
            ...current,
            columns: current.columns.map((column) =>
              column.id === result.issue.columnId && !hasIssue
                ? { ...column, issueCount: column.issueCount + 1 }
                : column
            ),
            issues: nextIssues,
            issuesMeta: current.issuesMeta
              ? {
                  ...current.issuesMeta,
                  total: hasIssue
                    ? current.issuesMeta.total
                    : current.issuesMeta.total + 1
                }
              : current.issuesMeta
          };
        });

        return result.issue;
      } catch (error) {
        mutation.finish();
        setBoardError(errorFromUnknown(error));
        throw error;
      }
    },
    [
      boardClient,
      boardRequestCoordinator,
      canLoad,
      normalizedBoardId,
      normalizedWorkspaceId
    ]
  );

  useEffect(() => {
    let active = true;

    async function loadCatalog() {
      if (!canLoad) {
        catalogRequestCoordinator.invalidate();
        setCatalog(emptyCatalog);
        setCatalogStatus("idle");
        setCatalogError(null);
        return;
      }

      setCatalogStatus("loading");
      setCatalogError(null);

      const outcome = await catalogRequestCoordinator.run(loadWorkspaceData);
      if (!active || outcome.status === "stale") {
        return;
      }
      if (outcome.status === "applied") {
        setCatalog(outcome.value);
        setCatalogStatus("success");
      } else {
        setCatalog(emptyCatalog);
        setCatalogError(errorFromUnknown(outcome.error));
        setCatalogStatus("error");
      }
    }

    void loadCatalog();

    return () => {
      active = false;
      catalogRequestCoordinator.invalidate();
    };
  }, [canLoad, catalogRequestCoordinator, loadWorkspaceData]);

  useEffect(() => {
    let active = true;

    async function loadSelectedBoard() {
      if (!canLoad || !normalizedBoardId) {
        boardRequestCoordinator.invalidate();
        boardIssueLoadGeneration.current += 1;
        setBoardState(emptyBoardState);
        setBoardStatus("idle");
        setBoardError(null);
        return;
      }

      setBoardStatus("loading");
      setBoardError(null);

      const outcome = await boardRequestCoordinator.run(loadBoardData);
      if (!active || outcome.status === "stale") {
        return;
      }
      if (outcome.status === "applied") {
        setBoardState(outcome.value);
        setBoardStatus("success");
      } else {
        setBoardState(emptyBoardState);
        setBoardError(errorFromUnknown(outcome.error));
        setBoardStatus("error");
      }
    }

    void loadSelectedBoard();

    return () => {
      active = false;
      boardRequestCoordinator.invalidate();
    };
  }, [
    boardRequestCoordinator,
    canLoad,
    loadBoardData,
    normalizedBoardId
  ]);

  return {
    ...catalog,
    ...boardState,
    boardError,
    issuesLoadProgress,
    boardStatus,
    catalogError,
    catalogStatus,
    createBoardIssue,
    hydrateBoard,
    moveIssueStatus,
    refreshBoard,
    refreshWorkspace,
    reloadWorkspace
  };
}
