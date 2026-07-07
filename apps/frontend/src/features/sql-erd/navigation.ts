import { Database } from "lucide-react";

import type { FeatureNavigationItem } from "@/features/navigation-types";

export const sqlErdNavigation: FeatureNavigationItem = {
  id: "sqltoerd",
  title: "SQLtoERD",
  label: "SQLtoERD",
  description: "SQL DDL을 기반으로 Workspace ERD session을 확인합니다.",
  action: "SQLtoERD 열기",
  href: "/sql-erd",
  icon: Database,
  items: [
    { title: "Source", href: "/sql-erd#source" },
    { title: "Canvas", href: "/sql-erd#canvas" },
    { title: "Inspector", href: "/sql-erd#inspector" }
  ]
};
