import { HttpStatus } from "@nestjs/common";
import { ApiError } from "../../common/api-error";

export const GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_MESSAGE =
  "GitHub account is already connected to another PILO account";

export const GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_QUERY_VALUE =
  "account_already_connected";

const POSTGRES_UNIQUE_VIOLATION_CODE = "23505";
const GITHUB_ACCOUNT_UNIQUE_CONSTRAINTS = new Set([
  "users_github_user_id_key",
  "users_github_login_key"
]);

export class GithubOAuthAccountAlreadyConnectedError extends ApiError {
  constructor(readonly returnUrl: string | null) {
    super(
      HttpStatus.CONFLICT,
      "CONFLICT",
      GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_MESSAGE
    );
  }
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
  const url = new URL(returnUrl);
  url.searchParams.set("github_oauth_error", errorValue);
  return url.toString();
}
