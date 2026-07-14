import type { GithubSyncStatus } from "@/features/github-integration/types";

export function getGithubManualSyncActionMessage(
  targetLabel: string,
  status: GithubSyncStatus
) {
  if (status === "queued") {
    return `${targetLabel} 동기화를 시작했습니다. 진행 상태를 확인하고 있습니다.`;
  }

  if (status === "running") {
    return `${targetLabel} 동기화가 진행 중입니다.`;
  }

  const statusLabel = status === "success" ? "성공" : "실패";
  return `${targetLabel} 동기화가 ${statusLabel} 상태로 종료되었습니다.`;
}
