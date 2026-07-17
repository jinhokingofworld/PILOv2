import { badRequest } from "../../common/api-error";

export interface BoardIssueCreateTarget {
  repository_id: string | null;
  repository_installation_id: string | null;
  repository_owner_login: string | null;
  repository_name: string | null;
  project_v2_id: string | null;
  project_installation_id: string | null;
  github_project_node_id: string | null;
  status_field_id: string | null;
  github_field_node_id: string | null;
  target_status_option_id: string | null;
  target_status_option_github_id: string | null;
}

export type ValidBoardIssueCreateTarget<T extends BoardIssueCreateTarget> = T & {
  repository_id: string;
  repository_installation_id: string;
  repository_owner_login: string;
  repository_name: string;
  project_v2_id: string;
  project_installation_id: string;
  github_project_node_id: string;
  status_field_id: string;
  github_field_node_id: string;
};

export function getBoardIssueCreateTargetError(
  target: BoardIssueCreateTarget
): string | null {
  if (
    !target.repository_id ||
    !target.repository_owner_login ||
    !target.repository_name
  ) {
    return "Board is missing GitHub repository metadata";
  }

  if (
    !target.project_v2_id ||
    !target.github_project_node_id ||
    !target.status_field_id ||
    !target.github_field_node_id
  ) {
    return "Board is missing GitHub ProjectV2 status metadata";
  }

  if (
    !target.repository_installation_id ||
    !target.project_installation_id
  ) {
    return "Board is disconnected from its GitHub installation";
  }

  if (target.repository_installation_id !== target.project_installation_id) {
    return "Board repository and ProjectV2 installations do not match";
  }

  if (target.target_status_option_id && !target.target_status_option_github_id) {
    return "Board column is missing GitHub Status option metadata";
  }

  return null;
}

export function isBoardIssueCreateTargetValid<T extends BoardIssueCreateTarget>(
  target: T
): target is ValidBoardIssueCreateTarget<T> {
  return getBoardIssueCreateTargetError(target) === null;
}

export function assertBoardIssueCreateTarget<T extends BoardIssueCreateTarget>(
  target: T
): asserts target is ValidBoardIssueCreateTarget<T> {
  const error = getBoardIssueCreateTargetError(target);
  if (error) {
    throw badRequest(error);
  }
}
