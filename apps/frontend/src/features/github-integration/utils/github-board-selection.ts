export type GithubBoardSelection = {
  projectV2Id: string;
  repositoryId: string;
};

const GITHUB_BOARD_SELECTION_STORAGE_PREFIX = "pilo:github-board-selection";

function selectionStorageKey(workspaceId: string) {
  return `${GITHUB_BOARD_SELECTION_STORAGE_PREFIX}:${workspaceId}`;
}

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function normalizeSelection(
  selection: Partial<GithubBoardSelection> | null | undefined
): GithubBoardSelection | null {
  const projectV2Id = selection?.projectV2Id?.trim() ?? "";
  const repositoryId = selection?.repositoryId?.trim() ?? "";

  if (!projectV2Id || !repositoryId) {
    return null;
  }

  return {
    projectV2Id,
    repositoryId
  };
}

export function rememberGithubBoardSelection(
  workspaceId: string,
  selection: Partial<GithubBoardSelection> | null | undefined
) {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId || !canUseStorage()) {
    return;
  }

  const normalizedSelection = normalizeSelection(selection);
  if (!normalizedSelection) {
    window.localStorage.removeItem(selectionStorageKey(normalizedWorkspaceId));
    return;
  }

  window.localStorage.setItem(
    selectionStorageKey(normalizedWorkspaceId),
    JSON.stringify(normalizedSelection)
  );
}

export function readGithubBoardSelection(
  workspaceId: string
): GithubBoardSelection | null {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId || !canUseStorage()) {
    return null;
  }

  const rawValue = window.localStorage.getItem(
    selectionStorageKey(normalizedWorkspaceId)
  );
  if (!rawValue) {
    return null;
  }

  try {
    return normalizeSelection(JSON.parse(rawValue) as Partial<GithubBoardSelection>);
  } catch {
    window.localStorage.removeItem(selectionStorageKey(normalizedWorkspaceId));
    return null;
  }
}
