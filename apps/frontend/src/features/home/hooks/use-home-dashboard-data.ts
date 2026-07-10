import { useEffect, useMemo, useState } from "react";

import { createBoardApiClient } from "@/features/board/api/client";
import type {
  BoardIssueCardPayload,
  BoardPayload
} from "@/features/board/types";
import { createCalendarApiClient } from "@/features/calendar/api/client";
import type { CalendarEvent } from "@/features/calendar/types";
import {
  createCanvasClient,
  type CanvasBoardSummary
} from "@/features/canvas/api/canvas-client";
import { createGithubIntegrationApiClient } from "@/features/github-integration/api/client";
import type {
  GithubOAuthStatus,
  GithubPullRequest,
  GithubRepository
} from "@/features/github-integration/types";
import { createMeetingApiClient } from "@/features/meeting/api/client";
import type { MeetingReportSummary } from "@/features/meeting/types";
import { createSqlErdApiClient } from "@/features/sql-erd/api/client";
import type { SqltoerdSessionSummary } from "@/features/sql-erd/types";
import { readGithubBoardSelection } from "@/shared/github/board-selection";

export const homeIssueListLimit = 5;
export const homePullRequestListLimit = 3;
export const homeMeetingReportListLimit = 4;
const homeMeetingReportFetchLimit = 100;

type HomeIssuesMode = "assigned" | "recent";

export type HomeIssuesState = {
  error: Error | null;
  githubLogin: string | null;
  issues: BoardIssueCardPayload[];
  mode: HomeIssuesMode;
  status: "idle" | "loading" | "success" | "error";
  total: number;
};

export type HomePullRequestsState = {
  error: Error | null;
  pullRequests: GithubPullRequest[];
  status: "idle" | "loading" | "success" | "error";
  total: number;
};

export type HomeMeetingReportsState = {
  error: Error | null;
  reports: MeetingReportSummary[];
  status: "idle" | "loading" | "success" | "error";
  todayCount: number;
};

export type HomeCanvasState = {
  error: Error | null;
  recentBoard: CanvasBoardSummary | null;
  status: "idle" | "loading" | "success" | "error";
};

export type HomeSqlErdState = {
  error: Error | null;
  session: SqltoerdSessionSummary | null;
  status: "idle" | "loading" | "success" | "error";
};

export type HomeGithubOAuthState = {
  error: Error | null;
  status: "idle" | "loading" | "success" | "error";
  value: GithubOAuthStatus | null;
};


const emptyHomeIssuesState: HomeIssuesState = {
  error: null,
  githubLogin: null,
  issues: [],
  mode: "recent",
  status: "idle",
  total: 0
};

const emptyHomePullRequestsState: HomePullRequestsState = {
  error: null,
  pullRequests: [],
  status: "idle",
  total: 0
};

const emptyHomeMeetingReportsState: HomeMeetingReportsState = {
  error: null,
  reports: [],
  status: "idle",
  todayCount: 0
};

const emptyHomeCanvasState: HomeCanvasState = {
  error: null,
  recentBoard: null,
  status: "idle"
};

const emptyHomeSqlErdState: HomeSqlErdState = {
  error: null,
  session: null,
  status: "idle"
};

const emptyHomeGithubOAuthState: HomeGithubOAuthState = {
  error: null,
  status: "idle",
  value: null
};

export function useHomeGithubOAuthStatus({
  accessToken
}: {
  accessToken: string | null;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const githubClient = useMemo(
    () =>
      createGithubIntegrationApiClient({
        accessToken: normalizedAccessToken
      }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomeGithubOAuthState>(
    emptyHomeGithubOAuthState
  );

  useEffect(() => {
    let active = true;

    async function loadGithubOAuthStatus() {
      if (!normalizedAccessToken) {
        setState(emptyHomeGithubOAuthState);
        return;
      }

      setState({
        ...emptyHomeGithubOAuthState,
        status: "loading"
      });

      try {
        const value = await githubClient.getGithubOAuthStatus();

        if (active) {
          setState({
            error: null,
            status: "success",
            value
          });
        }
      } catch (error) {
        if (active) {
          setState({
            error: error instanceof Error ? error : new Error(String(error)),
            status: "error",
            value: null
          });
        }
      }
    }

    void loadGithubOAuthStatus();

    return () => {
      active = false;
    };
  }, [githubClient, normalizedAccessToken]);

  return state;
}

export function useHomeIssues({
  accessToken,
  workspaceId
}: {
  accessToken: string | null;
  workspaceId: string;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const boardClient = useMemo(
    () => createBoardApiClient({ accessToken: normalizedAccessToken }),
    [normalizedAccessToken]
  );
  const githubClient = useMemo(
    () =>
      createGithubIntegrationApiClient({
        accessToken: normalizedAccessToken
      }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomeIssuesState>(emptyHomeIssuesState);

  useEffect(() => {
    let active = true;

    async function loadIssues() {
      if (!normalizedAccessToken || !normalizedWorkspaceId) {
        setState(emptyHomeIssuesState);
        return;
      }

      setState({
        ...emptyHomeIssuesState,
        status: "loading"
      });

      try {
        const [boards, githubStatus] = await Promise.all([
          boardClient.listBoards(normalizedWorkspaceId, {
            limit: 50
          }),
          githubClient.getGithubOAuthStatus().catch(() => null)
        ]);
        const board = selectHomeBoard(boards.data, normalizedWorkspaceId);
        const githubLogin = githubStatus?.githubLogin?.trim() || null;
        const mode: HomeIssuesMode = githubLogin ? "assigned" : "recent";

        if (!board) {
          if (active) {
            setState({
              error: null,
              githubLogin,
              issues: [],
              mode,
              status: "success",
              total: 0
            });
          }
          return;
        }

        const issues = await boardClient.listBoardIssues(
          normalizedWorkspaceId,
          board.id,
          {
            assignee: githubLogin ?? undefined,
            limit: homeIssueListLimit,
            page: 1,
            state: "open"
          }
        );

        if (active) {
          setState({
            error: null,
            githubLogin,
            issues: issues.data,
            mode,
            status: "success",
            total: issues.meta.total
          });
        }
      } catch (error) {
        if (active) {
          setState({
            ...emptyHomeIssuesState,
            error: errorFromUnknown(error),
            status: "error"
          });
        }
      }
    }

    void loadIssues();

    return () => {
      active = false;
    };
  }, [boardClient, githubClient, normalizedAccessToken, normalizedWorkspaceId]);

  return state;
}

export function useHomePullRequests({
  accessToken,
  workspaceId
}: {
  accessToken: string | null;
  workspaceId: string;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const githubClient = useMemo(
    () =>
      createGithubIntegrationApiClient({
        accessToken: normalizedAccessToken
      }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomePullRequestsState>(
    emptyHomePullRequestsState
  );

  useEffect(() => {
    let active = true;

    async function loadPullRequests() {
      if (!normalizedAccessToken || !normalizedWorkspaceId) {
        setState(emptyHomePullRequestsState);
        return;
      }

      setState({
        ...emptyHomePullRequestsState,
        status: "loading"
      });

      try {
        const repositories = await githubClient.listGithubRepositories(
          normalizedWorkspaceId,
          {
            includeArchived: false,
            limit: 100
          }
        );
        const repositoryId = selectHomeRepositoryId(
          repositories.data,
          normalizedWorkspaceId
        );

        if (!repositoryId) {
          if (active) {
            setState({
              error: null,
              pullRequests: [],
              status: "success",
              total: 0
            });
          }
          return;
        }

        const pullRequests = await githubClient.listGithubPullRequests(
          normalizedWorkspaceId,
          repositoryId,
          {
            limit: homePullRequestListLimit,
            page: 1,
            state: "open"
          }
        );

        if (active) {
          setState({
            error: null,
            pullRequests: pullRequests.data,
            status: "success",
            total: pullRequests.meta.total
          });
        }
      } catch (error) {
        if (active) {
          setState({
            ...emptyHomePullRequestsState,
            error: errorFromUnknown(error),
            status: "error"
          });
        }
      }
    }

    void loadPullRequests();

    return () => {
      active = false;
    };
  }, [githubClient, normalizedAccessToken, normalizedWorkspaceId]);

  return state;
}

export function useHomeMeetingReports({
  accessToken,
  workspaceId
}: {
  accessToken: string | null;
  workspaceId: string;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const meetingClient = useMemo(
    () =>
      createMeetingApiClient({
        accessToken: normalizedAccessToken
      }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomeMeetingReportsState>(
    emptyHomeMeetingReportsState
  );

  useEffect(() => {
    let active = true;

    async function loadMeetingReports() {
      if (!normalizedAccessToken || !normalizedWorkspaceId) {
        setState(emptyHomeMeetingReportsState);
        return;
      }

      setState({
        ...emptyHomeMeetingReportsState,
        status: "loading"
      });

      try {
        const reports = await meetingClient.listMeetingReports(
          normalizedWorkspaceId,
          {
            limit: homeMeetingReportFetchLimit
          }
        );

        if (active) {
          setState({
            error: null,
            reports: reports.reports.slice(0, homeMeetingReportListLimit),
            status: "success",
            todayCount: countTodayMeetingReports(reports.reports)
          });
        }
      } catch (error) {
        if (active) {
          setState({
            ...emptyHomeMeetingReportsState,
            error: errorFromUnknown(error),
            status: "error"
          });
        }
      }
    }

    void loadMeetingReports();

    return () => {
      active = false;
    };
  }, [meetingClient, normalizedAccessToken, normalizedWorkspaceId]);

  return state;
}

export function useHomeCanvasSummary({
  accessToken,
  workspaceId
}: {
  accessToken: string | null;
  workspaceId: string;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const canvasClient = useMemo(
    () =>
      createCanvasClient({
        authToken: normalizedAccessToken
      }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomeCanvasState>(emptyHomeCanvasState);

  useEffect(() => {
    let active = true;

    async function loadCanvasSummary() {
      if (!normalizedAccessToken || !normalizedWorkspaceId) {
        setState(emptyHomeCanvasState);
        return;
      }

      setState({
        ...emptyHomeCanvasState,
        status: "loading"
      });

      try {
        const boards = (await canvasClient.listBoards(
          normalizedWorkspaceId
        )) as CanvasBoardSummary[];

        if (active) {
          setState({
            error: null,
            recentBoard: selectRecentlyUpdatedCanvasBoard(boards),
            status: "success"
          });
        }
      } catch (error) {
        if (active) {
          setState({
            ...emptyHomeCanvasState,
            error: errorFromUnknown(error),
            status: "error"
          });
        }
      }
    }

    void loadCanvasSummary();

    return () => {
      active = false;
    };
  }, [canvasClient, normalizedAccessToken, normalizedWorkspaceId]);

  return state;
}

export function useHomeSqlErdSession({
  accessToken,
  workspaceId
}: {
  accessToken: string | null;
  workspaceId: string;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const sqlErdClient = useMemo(
    () =>
      createSqlErdApiClient({
        accessToken: normalizedAccessToken
      }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomeSqlErdState>(emptyHomeSqlErdState);

  useEffect(() => {
    let active = true;

    async function loadSqlErdSession() {
      if (!normalizedAccessToken || !normalizedWorkspaceId) {
        setState(emptyHomeSqlErdState);
        return;
      }

      setState({
        ...emptyHomeSqlErdState,
        status: "loading"
      });

      try {
        const result = await sqlErdClient.listSessions(normalizedWorkspaceId, {
          limit: 1
        });
        const session = result.items[0] ?? null;

        if (active) {
          setState({
            error: null,
            session,
            status: "success"
          });
        }
      } catch (error) {
        if (active) {
          setState({
            ...emptyHomeSqlErdState,
            error: errorFromUnknown(error),
            status: "error"
          });
        }
      }
    }

    void loadSqlErdSession();

    return () => {
      active = false;
    };
  }, [normalizedAccessToken, normalizedWorkspaceId, sqlErdClient]);

  return state;
}

function selectHomeBoard(boards: BoardPayload[], workspaceId: string) {
  const selection = readGithubBoardSelection(workspaceId);

  if (selection) {
    const selectedBoard = boards.find(
      (board) =>
        board.repository.id === selection.repositoryId &&
        board.project.id === selection.projectV2Id
    );

    if (selectedBoard) {
      return selectedBoard;
    }
  }

  return boards[0] ?? null;
}

function selectHomeRepositoryId(
  repositories: GithubRepository[],
  workspaceId: string
) {
  const selection = readGithubBoardSelection(workspaceId);

  if (
    selection &&
    repositories.some((repository) => repository.id === selection.repositoryId)
  ) {
    return selection.repositoryId;
  }

  return repositories[0]?.id ?? null;
}

export type HomeWeekCalendarEventsState = {
  error: Error | null;
  events: CalendarEvent[];
  status: "idle" | "loading" | "success" | "error";
};

const idleHomeWeekCalendarEventsState: HomeWeekCalendarEventsState = {
  error: null,
  events: [],
  status: "idle"
};

export function useHomeWeekCalendarEvents({
  accessToken,
  range,
  workspaceId
}: {
  accessToken: string | null;
  range: {
    end: string;
    start: string;
  };
  workspaceId: string;
}) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const calendarClient = useMemo(
    () => createCalendarApiClient({ accessToken: normalizedAccessToken }),
    [normalizedAccessToken]
  );
  const [state, setState] = useState<HomeWeekCalendarEventsState>(
    idleHomeWeekCalendarEventsState
  );

  useEffect(() => {
    let active = true;

    async function loadWeekEvents() {
      if (!normalizedAccessToken || !normalizedWorkspaceId) {
        setState(idleHomeWeekCalendarEventsState);
        return;
      }

      setState((currentState) => ({
        ...currentState,
        error: null,
        status: "loading"
      }));

      try {
        const events = await calendarClient.listEvents(normalizedWorkspaceId, range);

        if (active) {
          setState({
            error: null,
            events,
            status: "success"
          });
        }
      } catch (error) {
        if (active) {
          setState({
            error: errorFromUnknown(error),
            events: [],
            status: "error"
          });
        }
      }
    }

    void loadWeekEvents();

    return () => {
      active = false;
    };
  }, [
    calendarClient,
    normalizedAccessToken,
    normalizedWorkspaceId,
    range
  ]);

  return state;
}

function errorFromUnknown(error: unknown) {
  return error instanceof Error
    ? error
    : new Error("Home data could not be loaded");
}

function selectRecentlyUpdatedCanvasBoard(boards: CanvasBoardSummary[]) {
  return boards.reduce<CanvasBoardSummary | null>((selectedBoard, board) => {
    if (!board.updatedAt) {
      return selectedBoard;
    }

    if (!selectedBoard) {
      return board;
    }

    return new Date(board.updatedAt).getTime() >
      new Date(selectedBoard.updatedAt).getTime()
      ? board
      : selectedBoard;
  }, null);
}

function countTodayMeetingReports(reports: MeetingReportSummary[]) {
  const today = new Date();

  return reports.filter((report) =>
    isSameCalendarDate(new Date(report.createdAt), today)
  ).length;
}


function isSameCalendarDate(firstDate: Date, secondDate: Date) {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}
