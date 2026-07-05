export type LoginProvider = "google" | "github";

export type UserProfile = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Workspace = {
  id: string;
  name: string;
  ownerUserId: string | null;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
};

type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};

type LoginStartPayload = {
  authorizeUrl: string;
  state: string;
};

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function getAuthApiBaseUrl() {
  const appServerOrigin = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      DEFAULT_APP_SERVER_ORIGIN
  );

  return appServerOrigin.endsWith(API_BASE_PATH)
    ? appServerOrigin
    : `${appServerOrigin}${API_BASE_PATH}`;
}

export function buildAuthApiUrl(path: `/${string}`) {
  return `${getAuthApiBaseUrl()}${path}`;
}

async function requestJson<T>(
  path: `/${string}`,
  {
    accessToken,
    body,
    method = "GET"
  }: {
    accessToken?: string | null;
    body?: unknown;
    method?: string;
  } = {}
) {
  const response = await fetch(buildAuthApiUrl(path), {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(readApiErrorMessage(payload) ?? "PILO API request failed");
  }

  if (!isApiSuccessResponse<T>(payload)) {
    throw new Error("PILO API returned an invalid response");
  }

  return payload.data;
}

export async function startProviderLogin(
  provider: LoginProvider,
  returnUrl: string | null
) {
  return requestJson<LoginStartPayload>(`/auth/${provider}/start`, {
    method: "POST",
    body: {
      returnUrl
    }
  });
}

export async function getCurrentUser(accessToken: string) {
  return requestJson<UserProfile>("/me", {
    accessToken
  });
}

export async function listWorkspaces(accessToken: string) {
  return requestJson<Workspace[]>("/workspaces", {
    accessToken
  });
}

export async function createWorkspace(accessToken: string, name: string) {
  return requestJson<Workspace>("/workspaces", {
    accessToken,
    method: "POST",
    body: {
      name
    }
  });
}

export async function logoutSession(accessToken: string) {
  return requestJson<{ loggedOut: true }>("/auth/logout", {
    accessToken,
    method: "POST"
  });
}

function isApiSuccessResponse<T>(value: unknown): value is ApiSuccessResponse<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    value.success === true &&
    "data" in value
  );
}

function readApiErrorMessage(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "message" in value.error &&
    typeof value.error.message === "string"
  ) {
    return value.error.message;
  }

  return null;
}
