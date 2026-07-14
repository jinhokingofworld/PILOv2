"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createBoardApiClient } from "@/features/board/api/client";
import { selectBoardProjectRepositoryId } from "@/features/board/utils/board-project-repository";
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
  const boardClient = useMemo(
    () => createBoardApiClient({ accessToken: normalizedAccessToken }),
    [normalizedAccessToken]
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
    const [board, columns, issues, filterOptions] = await Promise.all([
      boardClient.getBoard(normalizedWorkspaceId, normalizedBoardId),
      boardClient.listBoardColumns(normalizedWorkspaceId, normalizedBoardId),
      boardClient.listBoardIssues(normalizedWorkspaceId, normalizedBoardId, {
        ...parsedIssueQuery,
        limit: parsedIssueQuery.limit ?? BOARD_ISSUES_PAGE_LIMIT
      }),
      boardClient.getBoardFilterOptions(normalizedWorkspaceId, normalizedBoardId)
    ]);

    return {
      board,
      columns,
      issues: issues.data,
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
      setCatalog(emptyCatalog);
      setCatalogStatus("idle");
      setCatalogError(null);
      return emptyCatalog;
    }

    setCatalogStatus("loading");
    setCatalogError(null);

    try {
      const nextCatalog = await loadWorkspaceData();
      setCatalog(nextCatalog);
      setCatalogStatus("success");
      return nextCatalog;
    } catch (error) {
      const nextError = errorFromUnknown(error);
      setCatalog(emptyCatalog);
      setCatalogError(nextError);
      setCatalogStatus("error");
      return emptyCatalog;
    }
  }, [canLoad, loadWorkspaceData]);

  const reloadBoard = useCallback(async () => {
    if (!canLoad || !normalizedBoardId) {
      setBoardState(emptyBoardState);
      setBoardStatus("idle");
      setBoardError(null);
      return emptyBoardState;
    }

    setBoardStatus("loading");
    setBoardError(null);

    try {
      const nextBoardState = await loadBoardData();
      setBoardState(nextBoardState);
      setBoardStatus("success");
      return nextBoardState;
    } catch (error) {
      const nextError = errorFromUnknown(error);
      setBoardState(emptyBoardState);
      setBoardError(nextError);
      setBoardStatus("error");
      return emptyBoardState;
    }
  }, [canLoad, loadBoardData, normalizedBoardId]);

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

        setBoardState((current) => ({
          ...current,
          issues: current.issues.map((issue) =>
            issue.id === issueId ? result.issue : issue
          )
        }));

        return result.issue;
      } catch (error) {
        setBoardState(previousBoardState);
        setBoardError(errorFromUnknown(error));
        void reloadBoard();
        throw error;
      }
    },
    [
      boardClient,
      boardState,
      canLoad,
      normalizedBoardId,
      normalizedWorkspaceId,
      reloadBoard
    ]
  );

  const createBoardIssue = useCallback(
    async (input: CreateBoardIssueCommand): Promise<BoardIssueCardPayload> => {
      if (!canLoad || !normalizedBoardId) {
        throw new Error("Board issue creation requires an authenticated board");
      }

      setBoardError(null);

      try {
        const result = await boardClient.createBoardIssue(
          normalizedWorkspaceId,
          normalizedBoardId,
          input
        );

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
        setBoardError(errorFromUnknown(error));
        throw error;
      }
    },
    [boardClient, canLoad, normalizedBoardId, normalizedWorkspaceId]
  );

  useEffect(() => {
    let active = true;

    async function loadCatalog() {
      if (!canLoad) {
        setCatalog(emptyCatalog);
        setCatalogStatus("idle");
        setCatalogError(null);
        return;
      }

      setCatalogStatus("loading");
      setCatalogError(null);

      try {
        const nextCatalog = await loadWorkspaceData();
        if (!active) return;

        setCatalog(nextCatalog);
        setCatalogStatus("success");
      } catch (error) {
        if (!active) return;

        setCatalog(emptyCatalog);
        setCatalogError(errorFromUnknown(error));
        setCatalogStatus("error");
      }
    }

    void loadCatalog();

    return () => {
      active = false;
    };
  }, [canLoad, loadWorkspaceData]);

  useEffect(() => {
    let active = true;

    async function loadSelectedBoard() {
      if (!canLoad || !normalizedBoardId) {
        setBoardState(emptyBoardState);
        setBoardStatus("idle");
        setBoardError(null);
        return;
      }

      setBoardStatus("loading");
      setBoardError(null);

      try {
        const nextBoardState = await loadBoardData();
        if (!active) return;

        setBoardState(nextBoardState);
        setBoardStatus("success");
      } catch (error) {
        if (!active) return;

        setBoardState(emptyBoardState);
        setBoardError(errorFromUnknown(error));
        setBoardStatus("error");
      }
    }

    void loadSelectedBoard();

    return () => {
      active = false;
    };
  }, [canLoad, loadBoardData, normalizedBoardId]);

  return {
    ...catalog,
    ...boardState,
    boardError,
    boardStatus,
    catalogError,
    catalogStatus,
    createBoardIssue,
    hydrateBoard,
    moveIssueStatus,
    reloadBoard,
    reloadWorkspace
  };
}
