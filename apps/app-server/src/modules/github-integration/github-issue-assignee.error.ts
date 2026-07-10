import { HttpStatus } from "@nestjs/common";
import { ApiError } from "../../common/api-error";

export const GITHUB_ISSUE_ASSIGNEE_INVALID_MESSAGE =
  "One or more assignees cannot be assigned to this repository";

export class GithubIssueAssigneeValidationError extends ApiError {
  constructor() {
    super(
      HttpStatus.BAD_REQUEST,
      "BAD_REQUEST",
      GITHUB_ISSUE_ASSIGNEE_INVALID_MESSAGE
    );
  }
}
