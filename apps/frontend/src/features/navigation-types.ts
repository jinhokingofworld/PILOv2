import type { LucideIcon } from "lucide-react";

export type FeatureNavigationSubItem = {
  title: string;
  href: string;
};

export type FeatureNavigationItem = {
  id: string;
  title: string;
  label: string;
  description: string;
  action: string;
  href: string;
  navigateOnTrigger?: boolean;
  icon: LucideIcon;
  items: FeatureNavigationSubItem[];
};
