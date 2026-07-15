import type {
  CurrentMeetingPayload,
  CurrentUserActiveMeetingPayload,
  CurrentRecordingPayload,
  DeleteMeetingRoomPayload,
  EndRecordingPayload,
  JoinMeetingInput,
  JoinMeetingPayload,
  LeaveMeetingPayload,
  MeetingDetailPayload,
  MeetingRoomListPayload,
  MeetingRoomMutationPayload,
  MeetingRoomNameInput,
  MeetingReportActionItemMutationPayload,
  MeetingReportDetailPayload,
  MeetingReportDeletionPayload,
  MeetingReportListPayload,
  MeetingReportListQuery,
  MeetingReportRegenerationPayload,
  ParticipantListPayload,
  RecordingListPayload,
  StartMeetingInput,
  StartMeetingPayload,
  StartRecordingPayload,
  UpdateMeetingReportActionItemInput
} from "@/features/meeting/types";

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

type MeetingClientOptions = {
  accessToken?: string | null;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

type MeetingApiSuccessResponse<T> = {
  success: true;
  data: T;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultMeetingApiBaseUrl() {
  const appServerOrigin = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ?? DEFAULT_APP_SERVER_ORIGIN
  );

  return appServerOrigin.endsWith(API_BASE_PATH)
    ? appServerOrigin
    : `${appServerOrigin}${API_BASE_PATH}`;
}

export function getMeetingApiBaseUrl(baseUrl = defaultMeetingApiBaseUrl()) {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);

  return normalizedBaseUrl.endsWith(API_BASE_PATH)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}${API_BASE_PATH}`;
}

export function buildMeetingApiUrl(
  path: `/${string}`,
  baseUrl = defaultMeetingApiBaseUrl()
) {
  return `${getMeetingApiBaseUrl(baseUrl)}${path}`;
}

export class MeetingApiError extends Error {
  status?: number;
  path?: string;
  code?: string;

  constructor(
    message: string,
    options: {
      status?: number;
      path?: string;
      code?: string;
    } = {}
  ) {
    super(message);
    this.name = "MeetingApiError";
    this.status = options.status;
    this.path = options.path;
    this.code = options.code;
  }
}

function readApiErrorMessage(payload: unknown) {
  if (
    isRecord(payload) &&
    payload.success === false &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string"
  ) {
    return {
      code:
        typeof payload.error.code === "string"
          ? payload.error.code
          : undefined,
      message: payload.error.message
    };
  }

  return null;
}

async function readMeetingJson(response: Response, path: string) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new MeetingApiError("Meeting API returned invalid JSON", {
      status: response.status,
      path
    });
  }
}

function unwrapMeetingData<T>(
  payload: unknown,
  {
    path,
    status
  }: {
    path: string;
    status: number;
  }
) {
  if (
    isRecord(payload) &&
    payload.success === true &&
    Object.hasOwn(payload, "data")
  ) {
    return (payload as MeetingApiSuccessResponse<T>).data;
  }

  if (
    isRecord(payload) &&
    payload.success === false &&
    isRecord(payload.error)
  ) {
    throw new MeetingApiError(
      typeof payload.error.message === "string"
        ? payload.error.message
        : "Meeting API request failed",
      {
        code:
          typeof payload.error.code === "string"
            ? payload.error.code
            : undefined,
        path,
        status
      }
    );
  }

  throw new MeetingApiError("Meeting API returned an unexpected response", {
    path,
    status
  });
}

function appendSearchParam(
  params: URLSearchParams,
  key: string,
  value: string | number | boolean | null | undefined
) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  params.set(key, String(value));
}

function withQueryParams(path: `/${string}`, query: object = {}) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null ||
      value === undefined
    ) {
      appendSearchParam(params, key, value);
    }
  }

  const search = params.toString();
  return search ? (`${path}?${search}` as `/${string}`) : path;
}

function withJsonBody(body: unknown, init: RequestInit = {}) {
  return {
    ...init,
    body: JSON.stringify(body)
  };
}

async function requestMeetingData<T>(
  path: `/${string}`,
  init: RequestInit | undefined,
  {
    accessToken,
    baseUrl,
    fetcher
  }: {
    accessToken: string | null;
    baseUrl: string;
    fetcher: typeof fetch;
  }
) {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetcher(buildMeetingApiUrl(path, baseUrl), {
    credentials: "same-origin",
    ...init,
    headers
  });
  const payload = await readMeetingJson(response, path);

  if (!response.ok) {
    const apiError = readApiErrorMessage(payload);
    throw new MeetingApiError(
      apiError?.message ?? "Meeting API request failed",
      {
        code: apiError?.code,
        path,
        status: response.status
      }
    );
  }

  return unwrapMeetingData<T>(payload, {
    path,
    status: response.status
  });
}

function workspaceMeetingsPath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/meetings` as const;
}

function workspaceMeetingRoomsPath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/meeting-rooms` as const;
}

function meetingRoomPath(workspaceId: string, meetingRoomId: string) {
  return `${workspaceMeetingRoomsPath(workspaceId)}/${encodeURIComponent(
    meetingRoomId
  )}` as const;
}

function meetingPath(workspaceId: string, meetingId: string) {
  return `${workspaceMeetingsPath(workspaceId)}/${encodeURIComponent(
    meetingId
  )}` as const;
}

function meetingRecordingsPath(workspaceId: string, meetingId: string) {
  return `${meetingPath(workspaceId, meetingId)}/recordings` as const;
}

function workspaceMeetingReportsPath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/meeting-reports` as const;
}

function meetingReportPath(workspaceId: string, reportId: string) {
  return `${workspaceMeetingReportsPath(workspaceId)}/${encodeURIComponent(
    reportId
  )}` as const;
}

function meetingReportActionItemPath(
  workspaceId: string,
  reportId: string,
  actionItemId: string
) {
  return `${meetingReportPath(workspaceId, reportId)}/action-items/${encodeURIComponent(
    actionItemId
  )}` as const;
}

export function createMeetingApiClient({
  accessToken = null,
  baseUrl = defaultMeetingApiBaseUrl(),
  fetcher = fetch
}: MeetingClientOptions = {}) {
  const requestOptions = {
    accessToken: accessToken?.trim() || null,
    baseUrl,
    fetcher
  };

  return {
    async listMeetingRooms(workspaceId: string) {
      return requestMeetingData<MeetingRoomListPayload>(
        workspaceMeetingRoomsPath(workspaceId),
        undefined,
        requestOptions
      );
    },

    async createMeetingRoom(workspaceId: string, body: MeetingRoomNameInput) {
      return requestMeetingData<MeetingRoomMutationPayload>(
        workspaceMeetingRoomsPath(workspaceId),
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async updateMeetingRoom(
      workspaceId: string,
      meetingRoomId: string,
      body: MeetingRoomNameInput
    ) {
      return requestMeetingData<MeetingRoomMutationPayload>(
        meetingRoomPath(workspaceId, meetingRoomId),
        withJsonBody(body, { method: "PATCH" }),
        requestOptions
      );
    },

    async deleteMeetingRoom(workspaceId: string, meetingRoomId: string) {
      return requestMeetingData<DeleteMeetingRoomPayload>(
        meetingRoomPath(workspaceId, meetingRoomId),
        { method: "DELETE" },
        requestOptions
      );
    },

    async getCurrentUserActiveMeeting() {
      return requestMeetingData<CurrentUserActiveMeetingPayload>(
        "/me/meetings/active",
        undefined,
        requestOptions
      );
    },

    async getCurrentMeetingInRoom(workspaceId: string, meetingRoomId: string) {
      return requestMeetingData<CurrentMeetingPayload>(
        `${meetingRoomPath(workspaceId, meetingRoomId)}/current`,
        undefined,
        requestOptions
      );
    },

    async startMeetingInRoom(
      workspaceId: string,
      meetingRoomId: string,
      body: StartMeetingInput = {}
    ) {
      return requestMeetingData<StartMeetingPayload>(
        `${meetingRoomPath(workspaceId, meetingRoomId)}/meetings`,
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async getCurrentMeeting(workspaceId: string) {
      return requestMeetingData<CurrentMeetingPayload>(
        `${workspaceMeetingsPath(workspaceId)}/current`,
        undefined,
        requestOptions
      );
    },

    async startMeeting(workspaceId: string, body: StartMeetingInput = {}) {
      return requestMeetingData<StartMeetingPayload>(
        workspaceMeetingsPath(workspaceId),
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async joinMeeting(
      workspaceId: string,
      meetingId: string,
      body: JoinMeetingInput = {}
    ) {
      return requestMeetingData<JoinMeetingPayload>(
        `${meetingPath(workspaceId, meetingId)}/participants/me`,
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async getMeeting(workspaceId: string, meetingId: string) {
      return requestMeetingData<MeetingDetailPayload>(
        meetingPath(workspaceId, meetingId),
        undefined,
        requestOptions
      );
    },

    async leaveMeeting(workspaceId: string, meetingId: string) {
      return requestMeetingData<LeaveMeetingPayload>(
        `${meetingPath(workspaceId, meetingId)}/participants/me`,
        { method: "DELETE" },
        requestOptions
      );
    },

    async startRecording(workspaceId: string, meetingId: string) {
      return requestMeetingData<StartRecordingPayload>(
        meetingRecordingsPath(workspaceId, meetingId),
        { method: "POST" },
        requestOptions
      );
    },

    async endRecording(
      workspaceId: string,
      meetingId: string,
      recordingId: string
    ) {
      return requestMeetingData<EndRecordingPayload>(
        `${meetingRecordingsPath(workspaceId, meetingId)}/${encodeURIComponent(
          recordingId
        )}/end`,
        { method: "POST" },
        requestOptions
      );
    },

    async listRecordings(workspaceId: string, meetingId: string) {
      return requestMeetingData<RecordingListPayload>(
        meetingRecordingsPath(workspaceId, meetingId),
        undefined,
        requestOptions
      );
    },

    async getCurrentRecording(workspaceId: string, meetingId: string) {
      return requestMeetingData<CurrentRecordingPayload>(
        `${meetingRecordingsPath(workspaceId, meetingId)}/current`,
        undefined,
        requestOptions
      );
    },

    async listParticipants(workspaceId: string, meetingId: string) {
      return requestMeetingData<ParticipantListPayload>(
        `${meetingPath(workspaceId, meetingId)}/participants`,
        undefined,
        requestOptions
      );
    },

    async listMeetingReports(
      workspaceId: string,
      query: MeetingReportListQuery = {}
    ) {
      return requestMeetingData<MeetingReportListPayload>(
        withQueryParams(workspaceMeetingReportsPath(workspaceId), query),
        undefined,
        requestOptions
      );
    },

    async getMeetingReport(workspaceId: string, reportId: string) {
      return requestMeetingData<MeetingReportDetailPayload>(
        meetingReportPath(workspaceId, reportId),
        undefined,
        requestOptions
      );
    },

    async deleteMeetingReport(workspaceId: string, reportId: string) {
      return requestMeetingData<MeetingReportDeletionPayload>(
        meetingReportPath(workspaceId, reportId),
        { method: "DELETE" },
        requestOptions
      );
    },

    async listMeetingReportsByMeeting(workspaceId: string, meetingId: string) {
      return requestMeetingData<MeetingReportListPayload>(
        `${meetingPath(workspaceId, meetingId)}/reports`,
        undefined,
        requestOptions
      );
    },

    async regenerateMeetingReport(workspaceId: string, reportId: string) {
      return requestMeetingData<MeetingReportRegenerationPayload>(
        `${meetingReportPath(workspaceId, reportId)}/regeneration-jobs`,
        { method: "POST" },
        requestOptions
      );
    },

    async updateMeetingReportActionItem(
      workspaceId: string,
      reportId: string,
      actionItemId: string,
      body: UpdateMeetingReportActionItemInput
    ) {
      return requestMeetingData<MeetingReportActionItemMutationPayload>(
        meetingReportActionItemPath(workspaceId, reportId, actionItemId),
        withJsonBody(body, { method: "PATCH" }),
        requestOptions
      );
    },

    async approveMeetingReportActionItem(
      workspaceId: string,
      reportId: string,
      actionItemId: string
    ) {
      return requestMeetingData<MeetingReportActionItemMutationPayload>(
        `${meetingReportActionItemPath(workspaceId, reportId, actionItemId)}/approve`,
        { method: "POST" },
        requestOptions
      );
    },

    async dismissMeetingReportActionItem(
      workspaceId: string,
      reportId: string,
      actionItemId: string
    ) {
      return requestMeetingData<MeetingReportActionItemMutationPayload>(
        `${meetingReportActionItemPath(workspaceId, reportId, actionItemId)}/dismiss`,
        { method: "POST" },
        requestOptions
      );
    }
  };
}
