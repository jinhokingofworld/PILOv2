import { Mic2 } from "lucide-react";

import type { FeatureNavigationItem } from "@/features/navigation-types";

export const meetingNavigation: FeatureNavigationItem = {
  id: "voice-chat",
  title: "음성채팅",
  label: "Voice meeting",
  description: "회의 참여, 녹음 상태, 회의록 생성 흐름을 확인합니다.",
  action: "회의 입장",
  href: "/meeting",
  icon: Mic2,
  items: [
    { title: "회의 입장", href: "/meeting#room" },
    { title: "녹음 상태", href: "/meeting#recording" },
    { title: "회의록", href: "/meeting#report" }
  ]
};
