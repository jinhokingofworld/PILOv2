import { HttpStatus } from "@nestjs/common";
import { ApiError } from "../../common/api-error";
import { GITHUB_PROJECT_OAUTH_SCOPE_ERROR_MESSAGE } from "./github-project-oauth-scope";

export const GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_MESSAGE =
  "GitHub account is already connected to another PILO account";

export const GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_QUERY_VALUE =
  "account_already_connected";

export type GithubCallbackErrorCode =
  | "account_already_connected"
  | "authorization_cancelled"
  | "callback_failed"
  | "connection_failed"
  | "installation_failed"
  | "installation_lookup_failed"
  | "installation_not_accessible"
  | "invalid_state"
  | "project_oauth_account_mismatch"
  | "project_oauth_scope_missing"
  | "stale_callback"
  | "token_exchange_failed";

export const GITHUB_CALLBACK_ERROR_QUERY_PARAM = "github_callback_error";
export const GITHUB_OAUTH_ERROR_QUERY_PARAM = "github_oauth_error";

const CALLBACK_ERROR_BY_MESSAGE = new Map<string, GithubCallbackErrorCode>([
  ["Invalid OAuth state", "invalid_state"],
  ["Invalid ProjectV2 OAuth state", "invalid_state"],
  ["Invalid GitHub App installation state", "invalid_state"],
  ["GitHub OAuth token exchange failed", "token_exchange_failed"],
  [
    GITHUB_PROJECT_OAUTH_SCOPE_ERROR_MESSAGE,
    "project_oauth_scope_missing"
  ],
  [
    "GitHub ProjectV2 OAuth account must match GitHub OAuth account",
    "project_oauth_account_mismatch"
  ],
  [
    "GitHub App installation is not accessible to the connected GitHub user",
    "installation_not_accessible"
  ],
  ["GitHub App installation lookup failed", "installation_lookup_failed"],
  ["GitHub OAuth callback is stale", "stale_callback"],
  ["GitHub App installation could not be saved", "installation_failed"]
]);

const POSTGRES_UNIQUE_VIOLATION_CODE = "23505";
const GITHUB_ACCOUNT_UNIQUE_CONSTRAINTS = new Set([
  "users_github_user_id_key",
  "users_github_login_key"
]);

export class GithubCallbackRedirectError extends ApiError {
  constructor(
    status: HttpStatus,
    code: "BAD_REQUEST" | "CONFLICT",
    message: string,
    readonly returnUrl: string | null,
    readonly callbackError: GithubCallbackErrorCode
  ) {
    super(status, code, message);
  }
}

export class GithubOAuthAccountAlreadyConnectedError extends GithubCallbackRedirectError {
  constructor(returnUrl: string | null) {
    super(
      HttpStatus.CONFLICT,
      "CONFLICT",
      GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_MESSAGE,
      returnUrl,
      GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_QUERY_VALUE
    );
  }
}

export function githubCallbackBadRequest(
  message: string,
  returnUrl: string | null,
  callbackError: GithubCallbackErrorCode
): GithubCallbackRedirectError {
  return new GithubCallbackRedirectError(
    HttpStatus.BAD_REQUEST,
    "BAD_REQUEST",
    message,
    returnUrl,
    callbackError
  );
}

export function isGithubOAuthAccountUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };
  return (
    candidate.code === POSTGRES_UNIQUE_VIOLATION_CODE &&
    typeof candidate.constraint === "string" &&
    GITHUB_ACCOUNT_UNIQUE_CONSTRAINTS.has(candidate.constraint)
  );
}

export function appendGithubOAuthCallbackError(
  returnUrl: string,
  errorValue: string
): string {
  return appendGithubCallbackError(
    returnUrl,
    errorValue as GithubCallbackErrorCode
  );
}

export function appendGithubCallbackError(
  returnUrl: string,
  errorValue: GithubCallbackErrorCode
): string {
  const url = new URL(returnUrl);
  url.searchParams.set(GITHUB_CALLBACK_ERROR_QUERY_PARAM, errorValue);
  if (errorValue === GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_QUERY_VALUE) {
    url.searchParams.set(GITHUB_OAUTH_ERROR_QUERY_PARAM, errorValue);
  }
  return url.toString();
}

export function getGithubCallbackErrorReturnUrl(error: unknown): string | null {
  return error instanceof GithubCallbackRedirectError ? error.returnUrl : null;
}

export function getGithubCallbackErrorCode(
  error: unknown
): GithubCallbackErrorCode {
  if (error instanceof GithubCallbackRedirectError) {
    return error.callbackError;
  }

  const message = readApiErrorMessage(error);
  if (message) {
    return CALLBACK_ERROR_BY_MESSAGE.get(message) ?? "callback_failed";
  }

  return "connection_failed";
}

function readApiErrorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const candidate = error as { response?: unknown };
  if (
    typeof candidate.response === "object" &&
    candidate.response !== null &&
    "error" in candidate.response
  ) {
    const response = candidate.response as { error?: unknown };
    if (
      typeof response.error === "object" &&
      response.error !== null &&
      "message" in response.error
    ) {
      const apiError = response.error as { message?: unknown };
      return typeof apiError.message === "string" ? apiError.message : null;
    }
  }

  return null;
}
