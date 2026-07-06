import { GitPullRequestArrow } from "lucide-react";

import type { FeatureNavigationItem } from "@/features/navigation-types";

export const prReviewNavigation: FeatureNavigationItem = {
  id: "pr-review",
  title: "PR 리뷰",
  label: "PR review",
  description: "Open PR을 선택해 AI 분석 기반 리뷰 흐름을 시작합니다.",
  action: "리뷰 시작",
  href: "/pr-review",
  icon: GitPullRequestArrow,
  items: [
    { title: "PR 선택", href: "/pr-review" }
  ]
};
