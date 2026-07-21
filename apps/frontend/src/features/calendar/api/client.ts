import type {
  CalendarEvent,
  CreateCalendarEventInput,
  DeleteCalendarEventResult,
  ListCalendarEventsQuery,
  UpdateCalendarEventInput
} from "@/features/calendar/types";

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

type CalendarClientOptions = {
  accessToken?: string | null;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

type CalendarApiSuccessResponse<T> = {
  success: true;
  data: T;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultCalendarApiBaseUrl() {
  const appServerOrigin = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ?? DEFAULT_APP_SERVER_ORIGIN
  );

  return appServerOrigin.endsWith(API_BASE_PATH)
    ? appServerOrigin
    : `${appServerOrigin}${API_BASE_PATH}`;
}

export function getCalendarApiBaseUrl(baseUrl = defaultCalendarApiBaseUrl()) {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);

  return normalizedBaseUrl.endsWith(API_BASE_PATH)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}${API_BASE_PATH}`;
}

export function buildCalendarApiUrl(
  path: `/${string}`,
  baseUrl = defaultCalendarApiBaseUrl()
) {
  return `${getCalendarApiBaseUrl(baseUrl)}${path}`;
}

export class CalendarApiError extends Error {
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
    this.name = "CalendarApiError";
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

async function readCalendarJson(response: Response, path: string) {
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new CalendarApiError("Calendar API returned invalid JSON", {
      status: response.status,
      path
    });
  }
}

function unwrapCalendarData<T>(
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
    return (payload as CalendarApiSuccessResponse<T>).data;
  }

  if (
    isRecord(payload) &&
    payload.success === false &&
    isRecord(payload.error)
  ) {
    throw new CalendarApiError(
      typeof payload.error.message === "string"
        ? payload.error.message
        : "Calendar API request failed",
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

  throw new CalendarApiError("Calendar API returned an unexpected response", {
    path,
    status
  });
}

function withJsonBody(body: unknown, init: RequestInit = {}) {
  return {
    ...init,
    body: JSON.stringify(body)
  };
}

async function requestCalendarData<T>(
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

  const response = await fetcher(buildCalendarApiUrl(path, baseUrl), {
    credentials: "same-origin",
    ...init,
    headers
  });
  const payload = await readCalendarJson(response, path);

  if (!response.ok) {
    const apiError = readApiErrorMessage(payload);
    throw new CalendarApiError(
      apiError?.message ?? "Calendar API request failed",
      {
        code: apiError?.code,
        path,
        status: response.status
      }
    );
  }

  return unwrapCalendarData<T>(payload, {
    path,
    status: response.status
  });
}

function calendarEventsPath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/calendar/events` as const;
}

function calendarEventPath(workspaceId: string, eventId: string | number) {
  return `${calendarEventsPath(workspaceId)}/${encodeURIComponent(String(eventId))}` as const;
}

export function createCalendarApiClient({
  accessToken = null,
  baseUrl = defaultCalendarApiBaseUrl(),
  fetcher = fetch
}: CalendarClientOptions = {}) {
  const requestOptions = {
    accessToken: accessToken?.trim() || null,
    baseUrl,
    fetcher
  };

  return {
    async listEvents(workspaceId: string, query: ListCalendarEventsQuery) {
      const searchParams = new URLSearchParams({
        start: query.start,
        end: query.end
      });
      const path =
        `${calendarEventsPath(workspaceId)}?${searchParams.toString()}` as const;

      return requestCalendarData<CalendarEvent[]>(
        path,
        undefined,
        requestOptions
      );
    },

    async getEvent(workspaceId: string, eventId: string | number) {
      return requestCalendarData<CalendarEvent>(
        calendarEventPath(workspaceId, eventId),
        undefined,
        requestOptions
      );
    },

    async createEvent(workspaceId: string, body: CreateCalendarEventInput) {
      return requestCalendarData<CalendarEvent>(
        calendarEventsPath(workspaceId),
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async updateEvent(
      workspaceId: string,
      eventId: string | number,
      body: UpdateCalendarEventInput
    ) {
      return requestCalendarData<CalendarEvent>(
        calendarEventPath(workspaceId, eventId),
        withJsonBody(body, { method: "PATCH" }),
        requestOptions
      );
    },

    async deleteEvent(workspaceId: string, eventId: string | number) {
      return requestCalendarData<DeleteCalendarEventResult>(
        calendarEventPath(workspaceId, eventId),
        { method: "DELETE" },
        requestOptions
      );
    },

    async retryGoogleSync(workspaceId: string, eventId: string | number) {
      return requestCalendarData<{ queued: true }>(
        `${calendarEventPath(workspaceId, eventId)}/google-sync/retry` as const,
        { method: "POST" }, requestOptions
      );
    }
  };
}
