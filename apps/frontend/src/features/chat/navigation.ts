import { MessageCircle } from "lucide-react";

import type { FeatureNavigationItem } from "@/features/navigation-types";

export const chatNavigation: FeatureNavigationItem = {
  id: "chat",
  title: "채팅",
  label: "Chat",
  description: "Workspace 멤버와 실시간으로 대화합니다.",
  action: "채팅 보기",
  href: "/chat",
  icon: MessageCircle,
  items: []
};
