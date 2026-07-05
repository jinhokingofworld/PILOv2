export type LoginProvider = "google" | "github";

export interface StartLoginRequest {
  returnUrl?: unknown;
}

export interface LoginStartPayload {
  authorizeUrl: string;
  state: string;
}

export interface LoginCallbackQuery {
  code?: unknown;
  state?: unknown;
  error?: unknown;
}

export interface LogoutPayload {
  loggedOut: true;
}
