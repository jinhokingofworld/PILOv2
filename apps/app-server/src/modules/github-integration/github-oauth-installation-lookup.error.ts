import { HttpStatus } from "@nestjs/common";
import { ApiError, type ApiErrorCode } from "../../common/api-error";

export type GithubOAuthInstallationLookupFailure = "reconnect_required" | "transient";

export const GITHUB_OAUTH_RECONNECT_REQUIRED_CODE =
  "GITHUB_OAUTH_RECONNECT_REQUIRED";
export const GITHUB_OAUTH_RECONNECT_REQUIRED_MESSAGE =
  "GitHub OAuth reconnection is required";

export class GithubOAuthReconnectRequiredError extends ApiError {
  constructor() {
    super(
      HttpStatus.BAD_REQUEST,
      GITHUB_OAUTH_RECONNECT_REQUIRED_CODE as ApiErrorCode,
      GITHUB_OAUTH_RECONNECT_REQUIRED_MESSAGE
    );
  }
}

/** Provider details deliberately stay out of this domain error. */
export class GithubOAuthInstallationLookupError extends Error {
  constructor(readonly failure: GithubOAuthInstallationLookupFailure) {
    super(
      failure === "reconnect_required"
        ? GITHUB_OAUTH_RECONNECT_REQUIRED_MESSAGE
        : "GitHub OAuth installation lookup failed"
    );
  }
}
