import { PanelsTopLeft } from "lucide-react";

import type { FeatureNavigationItem } from "@/features/navigation-types";

export const canvasNavigation: FeatureNavigationItem = {
  id: "canvas",
  title: "캔버스",
  label: "Canvas",
  description: "메모, 도형, 코드블럭을 배치하는 자유형 작업 공간입니다.",
  action: "캔버스 열기",
  href: "/canvas",
  icon: PanelsTopLeft,
  items: [
    { title: "최근 캔버스", href: "/canvas#recent" },
    { title: "새 캔버스", href: "/canvas#new" },
    { title: "도형 보드", href: "/canvas#board" }
  ]
};
