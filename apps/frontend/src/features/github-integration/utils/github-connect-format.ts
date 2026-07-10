import type {
  GithubSyncStatus,
  GithubSyncTarget
} from "@/features/github-integration/types";

export function formatGithubConnectNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

export function formatGithubConnectDateTime(value: string | null) {
  if (!value) {
    return "없음";
  }

  try {
    return new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatGithubConnectShortDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toISOString().slice(0, 10);
}

export function getGithubConnectSyncStatusLabel(status: GithubSyncStatus) {
  if (status === "running") {
    return "진행 중";
  }

  if (status === "success") {
    return "성공";
  }

  return "실패";
}

export function getGithubConnectSyncTargetLabel(target: GithubSyncTarget) {
  const labels: Record<GithubSyncTarget, string> = {
    full: "전체",
    issues: "Issue",
    project_v2: "ProjectV2",
    project_v2_fields: "ProjectV2 필드",
    project_v2_items: "ProjectV2 아이템",
    pull_requests: "Pull Request",
    repositories: "저장소"
  };

  return labels[target];
}
