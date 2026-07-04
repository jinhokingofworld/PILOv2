import { CalendarDays } from "lucide-react";

import type { FeatureNavigationItem } from "@/features/navigation-types";

export const calendarNavigation: FeatureNavigationItem = {
  id: "calendar",
  title: "캘린더",
  label: "Calendar",
  description: "월간 화면에서 Workspace 일정을 확인하고 관리합니다.",
  action: "일정 보기",
  href: "/calendar",
  icon: CalendarDays,
  items: [
    { title: "월간 일정", href: "/calendar#month" },
    { title: "오늘 일정", href: "/calendar#today" },
    { title: "새 일정", href: "/calendar#new" }
  ]
};
