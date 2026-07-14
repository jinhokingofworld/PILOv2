import type {
  GithubActiveBoardSource,
  GithubProjectV2,
  GithubRepository
} from "@/features/github-integration/types";

type ProjectV2SelectionInput = {
  projects: ReadonlyArray<Pick<GithubProjectV2, "id" | "repositoryIds">>;
  preferredProjectV2Id?: string;
  repositoryId?: string;
  allowFallbackSelection?: boolean;
};

type GithubActiveBoardSelectionInput = {
  repositories: ReadonlyArray<Pick<GithubRepository, "id">>;
  projects: ReadonlyArray<Pick<GithubProjectV2, "id" | "repositoryIds">>;
  activeBoardSource: GithubActiveBoardSource | null;
  preferredRepositoryId?: string;
  preferredProjectV2Id?: string;
};

export type GithubActiveBoardSelection = {
  repositoryId: string;
  projectV2Id: string;
};

export function selectProjectV2IdForRepository({
  projects,
  preferredProjectV2Id,
  repositoryId,
  allowFallbackSelection = true
}: ProjectV2SelectionInput): string {
  const preferredProject = projects.find(
    (project) => project.id === preferredProjectV2Id
  );

  if (repositoryId) {
    if (preferredProject?.repositoryIds.includes(repositoryId)) {
      return preferredProject.id;
    }

    if (!allowFallbackSelection) {
      return "";
    }

    const linkedProject = projects.find((project) =>
      project.repositoryIds.includes(repositoryId)
    );
    if (linkedProject) {
      return linkedProject.id;
    }
  }

  return preferredProject?.id ??
    (allowFallbackSelection ? projects[0]?.id : undefined) ??
    "";
}

export function resolveGithubActiveBoardSelection({
  repositories,
  projects,
  activeBoardSource,
  preferredRepositoryId,
  preferredProjectV2Id
}: GithubActiveBoardSelectionInput): GithubActiveBoardSelection {
  const requestedRepositoryId =
    preferredRepositoryId !== undefined
      ? preferredRepositoryId
      : (activeBoardSource?.repository.id ?? "");
  const repository = repositories.find(
    (candidate) => candidate.id === requestedRepositoryId
  );
  if (!repository) {
    return { repositoryId: "", projectV2Id: "" };
  }

  const requestedProjectV2Id =
    preferredProjectV2Id !== undefined
      ? preferredProjectV2Id
      : (activeBoardSource?.project.id ?? "");

  return {
    repositoryId: repository.id,
    projectV2Id: selectProjectV2IdForRepository({
      projects,
      preferredProjectV2Id: requestedProjectV2Id,
      repositoryId: repository.id,
      allowFallbackSelection: false
    })
  };
}
