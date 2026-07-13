import {
  buildAuthApiUrl,
  type UserProfile
} from "@/features/auth/api/client";

export type SettingsTheme = "system" | "light" | "dark";
export type SettingsDensity = "comfortable" | "compact";
export type SettingsLandingPage = "home" | "calendar" | "board" | "canvas";

export type SettingsPayload = {
  theme: SettingsTheme;
  density: SettingsDensity;
  defaultWorkspaceId: string | null;
  defaultLandingPage: SettingsLandingPage;
  restoreLastWorkspace: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type UpdateProfileInput = {
  displayName: string | null;
  jobTitle: string | null;
  bio: string | null;
  avatarMode: "provider" | "custom" | "initials";
  customAvatarUrl: string | null;
  avatarColor: string;
};

export type UpdateSettingsInput = Pick<
  SettingsPayload,
  | "theme"
  | "density"
  | "defaultWorkspaceId"
  | "defaultLandingPage"
  | "restoreLastWorkspace"
>;

type ApiSuccessResponse<T> = { success: true; data: T };

export class SettingsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "SettingsApiError";
  }
}

export async function getCurrentSettings(accessToken: string) {
  return requestJson<SettingsPayload>("/me/settings", accessToken);
}

export async function updateCurrentSettings(
  accessToken: string,
  input: UpdateSettingsInput
) {
  return requestJson<SettingsPayload>("/me/settings", accessToken, {
    body: input,
    method: "PATCH"
  });
}

export async function updateCurrentProfile(
  accessToken: string,
  input: UpdateProfileInput
) {
  return requestJson<UserProfile>("/me/profile", accessToken, {
    body: input,
    method: "PATCH"
  });
}

export async function deleteCurrentAccount(
  accessToken: string,
  confirmationText: string
) {
  return requestJson<{ deleted: true }>("/me", accessToken, {
    body: { confirmationText },
    method: "DELETE"
  });
}

async function requestJson<T>(
  path: `/${string}`,
  accessToken: string,
  options: { body?: unknown; method?: string } = {}
) {
  const response = await fetch(buildAuthApiUrl(path), {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = readApiError(payload);
    throw new SettingsApiError(
      error.message ?? "설정 요청을 처리하지 못했습니다.",
      response.status,
      error.code
    );
  }
  if (!isSuccess<T>(payload)) {
    throw new SettingsApiError("잘못된 설정 API 응답입니다.", response.status, null);
  }
  return payload.data;
}

function isSuccess<T>(value: unknown): value is ApiSuccessResponse<T> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "success" in value &&
      value.success === true &&
      "data" in value
  );
}

function readApiError(value: unknown): { code: string | null; message: string | null } {
  if (!value || typeof value !== "object" || !("error" in value)) {
    return { code: null, message: null };
  }
  const error = value.error;
  if (!error || typeof error !== "object") {
    return { code: null, message: null };
  }
  return {
    code: "code" in error && typeof error.code === "string" ? error.code : null,
    message:
      "message" in error && typeof error.message === "string"
        ? error.message
        : null
  };
}
