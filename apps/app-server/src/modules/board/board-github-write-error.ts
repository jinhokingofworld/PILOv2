import { ApiError } from "../../common/api-error";
import { GithubIssueAssigneeValidationError } from "../github-integration/github-issue-assignee.error";
import { boardBadGateway } from "./board-api-error";

const PRESERVED_GITHUB_ERROR_MESSAGES = [
  "GitHub OAuth connection",
  "GitHub ProjectV2 OAuth",
  "Current user not found"
] as const;

export function rethrowBoardGithubWriteError(
  error: unknown,
  fallbackMessage: string
): never {
  if (error instanceof ApiError && shouldPreserveApiError(error)) {
    throw error;
  }

  throw boardBadGateway(fallbackMessage);
}

function shouldPreserveApiError(error: ApiError): boolean {
  if (error instanceof GithubIssueAssigneeValidationError) {
    return true;
  }

  if (error.getStatus() === 403) {
    return true;
  }

  const response = error.getResponse();
  if (
    !response ||
    typeof response !== "object" ||
    Array.isArray(response) ||
    !("error" in response)
  ) {
    return false;
  }

  const apiError = (response as { error?: { message?: unknown } }).error;
  const errorMessage = apiError?.message;
  if (typeof errorMessage !== "string") {
    return false;
  }

  return PRESERVED_GITHUB_ERROR_MESSAGES.some((message) =>
    errorMessage.includes(message)
  );
}
