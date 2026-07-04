import { LayoutDashboard } from "lucide-react";

import type { FeatureNavigationItem } from "@/features/navigation-types";

export const boardNavigation: FeatureNavigationItem = {
  id: "board",
  title: "보드",
  label: "Board",
  description: "GitHub ProjectV2 기반 칸반 보드와 이슈 흐름을 관리합니다.",
  action: "보드 보기",
  href: "/board",
  icon: LayoutDashboard,
  items: [
    { title: "칸반 보드", href: "/board#kanban" },
    { title: "컬럼", href: "/board#columns" },
    { title: "이슈 상세", href: "/board#issues" }
  ]
};
