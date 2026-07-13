import type { BoardGithubRepositoryPayload } from "@/features/board/types";

export function selectBoardProjectRepositoryId(
  repositories: BoardGithubRepositoryPayload[],
  selectedRepositoryId?: string | null
) {
  const normalizedSelectedRepositoryId = selectedRepositoryId?.trim();

  return (
    repositories.find(
      (repository) => repository.id === normalizedSelectedRepositoryId
    )?.id ?? repositories[0]?.id
  );
}
