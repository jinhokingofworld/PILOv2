export type LoginProvider = "google" | "github";
export type WorkspaceRole = "owner" | "member";
export type WorkspaceInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

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
  role: WorkspaceRole;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMember = {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  invitedByUserId: string | null;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
    activeWorkspaceId: string | null;
    lastSeenAt: string | null;
  };
};

export type UserPresencePayload = {
  activeWorkspaceId: string | null;
  lastSeenAt: string;
};

export type WorkspaceInvitation = {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  status: WorkspaceInvitationStatus;
  invitedByUserId: string;
  acceptedByUserId: string | null;
  revokedByUserId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateWorkspaceInvitationPayload = {
  invitation: WorkspaceInvitation;
  invitationToken: string;
  acceptUrl: string;
};

export type WorkspaceInvitationTokenPayload = {
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
  status: WorkspaceInvitationStatus;
  expiresAt: string;
};

export type CurrentUserWorkspaceInvitation = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
  status: WorkspaceInvitationStatus;
  invitedByUserId: string;
  expiresAt: string;
  createdAt: string;
};

export type AcceptWorkspaceInvitationPayload = {
  workspace: Workspace;
  membership: WorkspaceMember;
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
    keepalive = false,
    method = "GET"
  }: {
    accessToken?: string | null;
    body?: unknown;
    keepalive?: boolean;
    method?: string;
  } = {}
) {
  const response = await fetch(buildAuthApiUrl(path), {
    method,
    credentials: "same-origin",
    keepalive,
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

export async function updateCurrentUserPresence(
  accessToken: string,
  activeWorkspaceId: string | null,
  options: {
    keepalive?: boolean;
  } = {}
) {
  return requestJson<UserPresencePayload>("/me/presence", {
    accessToken,
    body: {
      activeWorkspaceId
    },
    keepalive: options.keepalive,
    method: "POST"
  });
}

export async function listWorkspaces(accessToken: string) {
  return requestJson<Workspace[]>("/workspaces", {
    accessToken
  });
}

export async function listWorkspaceMembers(
  accessToken: string,
  workspaceId: string
) {
  return requestJson<WorkspaceMember[]>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members`,
    {
      accessToken
    }
  );
}

export async function removeWorkspaceMember(
  accessToken: string,
  workspaceId: string,
  userId: string
) {
  return requestJson<{ removed: true }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(
      userId
    )}`,
    {
      accessToken,
      method: "DELETE"
    }
  );
}

export async function leaveWorkspace(accessToken: string, workspaceId: string) {
  return requestJson<{ removed: true }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members/me`,
    {
      accessToken,
      method: "DELETE"
    }
  );
}

export async function listWorkspaceInvitations(
  accessToken: string,
  workspaceId: string
) {
  return requestJson<WorkspaceInvitation[]>(
    `/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
    {
      accessToken
    }
  );
}

export async function createWorkspaceInvitation(
  accessToken: string,
  workspaceId: string,
  email: string
) {
  return requestJson<CreateWorkspaceInvitationPayload>(
    `/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
    {
      accessToken,
      method: "POST",
      body: {
        email,
        role: "member"
      }
    }
  );
}

export async function listCurrentUserWorkspaceInvitations(accessToken: string) {
  return requestJson<CurrentUserWorkspaceInvitation[]>(
    "/me/workspace-invitations",
    {
      accessToken
    }
  );
}

export async function acceptCurrentUserWorkspaceInvitation(
  accessToken: string,
  invitationId: string
) {
  return requestJson<AcceptWorkspaceInvitationPayload>(
    `/me/workspace-invitations/${encodeURIComponent(invitationId)}/accept`,
    {
      accessToken,
      method: "POST"
    }
  );
}

export async function rejectCurrentUserWorkspaceInvitation(
  accessToken: string,
  invitationId: string
) {
  return requestJson<WorkspaceInvitation>(
    `/me/workspace-invitations/${encodeURIComponent(invitationId)}/reject`,
    {
      accessToken,
      method: "POST"
    }
  );
}

export async function getWorkspaceInvitation(
  accessToken: string,
  invitationToken: string
) {
  return requestJson<WorkspaceInvitationTokenPayload>(
    `/workspace-invitations/${encodeURIComponent(invitationToken)}`,
    {
      accessToken
    }
  );
}

export async function acceptWorkspaceInvitation(
  accessToken: string,
  invitationToken: string
) {
  return requestJson<AcceptWorkspaceInvitationPayload>(
    `/workspace-invitations/${encodeURIComponent(invitationToken)}/accept`,
    {
      accessToken,
      method: "POST"
    }
  );
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
