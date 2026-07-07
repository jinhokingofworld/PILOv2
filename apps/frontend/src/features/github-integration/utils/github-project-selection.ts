import type { GithubProjectV2 } from "@/features/github-integration/types";

type ProjectV2SelectionInput = {
  projects: GithubProjectV2[];
  preferredProjectV2Id?: string;
  repositoryId?: string;
};

export function selectProjectV2IdForRepository({
  projects,
  preferredProjectV2Id,
  repositoryId
}: ProjectV2SelectionInput): string {
  const preferredProject = projects.find(
    (project) => project.id === preferredProjectV2Id
  );

  if (repositoryId) {
    if (preferredProject?.repositoryIds.includes(repositoryId)) {
      return preferredProject.id;
    }

    const linkedProject = projects.find((project) =>
      project.repositoryIds.includes(repositoryId)
    );
    if (linkedProject) {
      return linkedProject.id;
    }
  }

  return preferredProject?.id ?? projects[0]?.id ?? "";
}
