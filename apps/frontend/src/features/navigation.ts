import { calendarNavigation } from "@/features/calendar/navigation";
import { canvasNavigation } from "@/features/canvas/navigation";
import { chatNavigation } from "@/features/chat/navigation";
import { driveNavigation } from "@/features/drive/navigation";
import { homeNavigation } from "@/features/home/navigation";
import { meetingNavigation } from "@/features/meeting/navigation";
import { prReviewNavigation } from "@/features/pr-review/navigation";
import { boardNavigation } from "@/features/board/navigation";
import { sqlErdNavigation } from "@/features/sql-erd/navigation";
import type { FeatureNavigationItem } from "@/features/navigation-types";

export const featureNavigationItems: FeatureNavigationItem[] = [
  homeNavigation,
  chatNavigation,
  calendarNavigation,
  boardNavigation,
  sqlErdNavigation,
  prReviewNavigation,
  meetingNavigation,
  canvasNavigation,
  driveNavigation
];

export function getFeatureNavigationItem(featureId: string) {
  return (
    featureNavigationItems.find((feature) => feature.id === featureId) ??
    homeNavigation
  );
}

export function getFeatureNavigationItemForPathname(pathname: string | null) {
  const currentPathname = pathname || homeNavigation.href;

  return (
    [...featureNavigationItems]
      .sort((first, second) => second.href.length - first.href.length)
      .find(
        (feature) =>
          currentPathname === feature.href ||
          currentPathname.startsWith(`${feature.href}/`)
      ) ?? homeNavigation
  );
}
