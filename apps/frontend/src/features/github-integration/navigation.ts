import { GitBranch } from "lucide-react";

import type { FeatureNavigationItem } from "@/features/navigation-types";

export const githubIntegrationNavigation: FeatureNavigationItem = {
  id: "github",
  title: "GitHub",
  label: "GitHub sync",
  description: "Repository, Issue, PR, ProjectV2 동기화 상태로 진입합니다.",
  action: "연동 확인",
  href: "/github",
  icon: GitBranch,
  items: [
    { title: "연동 상태", href: "/github#status" },
    { title: "저장소", href: "/github#repositories" },
    { title: "ProjectV2", href: "/github#project" }
  ]
};
