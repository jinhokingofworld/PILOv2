import { Mic2 } from "lucide-react";

import type { FeatureNavigationItem } from "@/features/navigation-types";

export const meetingNavigation: FeatureNavigationItem = {
  id: "voice-chat",
  title: "음성회의",
  label: "Voice meeting",
  description: "회의 참여, 녹음, 회의록 확인과 재생성을 관리합니다.",
  action: "회의 입장",
  href: "/meeting",
  icon: Mic2,
  items: [
    { title: "회의 입장", href: "/meeting#room" },
    { title: "회의록", href: "/meeting#report" }
  ]
};
