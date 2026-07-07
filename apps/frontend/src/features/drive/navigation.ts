import { Folder } from "lucide-react";

import type { FeatureNavigationItem } from "@/features/navigation-types";

export const driveNavigation: FeatureNavigationItem = {
  id: "drive",
  title: "파일",
  label: "Files",
  description: "Workspace 공유 파일과 폴더를 확인합니다.",
  action: "파일 보기",
  href: "/files",
  icon: Folder,
  items: [
    { title: "공유 파일", href: "/files" }
  ]
};
