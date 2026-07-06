export const PILO_ACCESS_TOKEN_STORAGE_KEY = "pilo:access-token";
export const PILO_ACCESS_TOKEN_EXPIRES_AT_STORAGE_KEY = "pilo:access-token-expires-at";
export const PILO_SELECTED_WORKSPACE_ID_STORAGE_KEY = "pilo:workspace-id";
export const PILO_DEV_PREVIEW_ACCESS_TOKEN = "pilo_dev_preview_ui_only";
export const PILO_DEV_PREVIEW_WORKSPACE_ID =
  "00000000-0000-4000-8000-000000000136";

const LOCAL_DEV_PREVIEW_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export type StoredAuthSession = {
  accessToken: string;
  expiresAt: string | null;
};

export function saveAuthSession(session: StoredAuthSession) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PILO_ACCESS_TOKEN_STORAGE_KEY, session.accessToken);

  if (session.expiresAt) {
    window.localStorage.setItem(
      PILO_ACCESS_TOKEN_EXPIRES_AT_STORAGE_KEY,
      session.expiresAt
    );
  } else {
    window.localStorage.removeItem(PILO_ACCESS_TOKEN_EXPIRES_AT_STORAGE_KEY);
  }
}

export function saveDevPreviewAuthSession() {
  saveAuthSession({
    accessToken: PILO_DEV_PREVIEW_ACCESS_TOKEN,
    expiresAt: null
  });
  saveSelectedWorkspaceId(PILO_DEV_PREVIEW_WORKSPACE_ID);
}

export function isDevPreviewAccessToken(accessToken: string) {
  return accessToken === PILO_DEV_PREVIEW_ACCESS_TOKEN;
}

export function isDevPreviewEnabled() {
  if (process.env.NEXT_PUBLIC_PILO_ENABLE_UI_PREVIEW !== "true") {
    return false;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return LOCAL_DEV_PREVIEW_HOSTNAMES.has(window.location.hostname);
}

export function getStoredAuthSession(): StoredAuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const accessToken = window.localStorage.getItem(PILO_ACCESS_TOKEN_STORAGE_KEY);
  const expiresAt = window.localStorage.getItem(
    PILO_ACCESS_TOKEN_EXPIRES_AT_STORAGE_KEY
  );

  if (!accessToken) {
    return null;
  }

  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    clearStoredAuthSession();
    return null;
  }

  return {
    accessToken,
    expiresAt
  };
}

export function clearStoredAuthSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(PILO_ACCESS_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(PILO_ACCESS_TOKEN_EXPIRES_AT_STORAGE_KEY);
  window.localStorage.removeItem(PILO_SELECTED_WORKSPACE_ID_STORAGE_KEY);
}

export function getSelectedWorkspaceId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(PILO_SELECTED_WORKSPACE_ID_STORAGE_KEY);
}

export function saveSelectedWorkspaceId(workspaceId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PILO_SELECTED_WORKSPACE_ID_STORAGE_KEY, workspaceId);
}
