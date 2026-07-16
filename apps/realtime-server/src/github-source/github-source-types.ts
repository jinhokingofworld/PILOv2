export type GithubSourceRoomRef = {
  workspaceId: string;
};

export type GithubSourceInvalidation = GithubSourceRoomRef & {
  repositoryId: string;
  sourceId: string;
  sourceNumber: number;
  sourceType: "issue" | "pull_request";
  updatedAt: string;
};
