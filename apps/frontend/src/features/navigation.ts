import { calendarNavigation } from "@/features/calendar/navigation";
import { canvasNavigation } from "@/features/canvas/navigation";
import { driveNavigation } from "@/features/drive/navigation";
import { githubIntegrationNavigation } from "@/features/github-integration/navigation";
import { meetingNavigation } from "@/features/meeting/navigation";
import { prReviewNavigation } from "@/features/pr-review/navigation";
import { boardNavigation } from "@/features/board/navigation";
import type { FeatureNavigationItem } from "@/features/navigation-types";

export const featureNavigationItems: FeatureNavigationItem[] = [
  calendarNavigation,
  driveNavigation,
  githubIntegrationNavigation,
  boardNavigation,
  prReviewNavigation,
  meetingNavigation,
  canvasNavigation
];

export function getFeatureNavigationItem(featureId: string) {
  return (
    featureNavigationItems.find((feature) => feature.id === featureId) ??
    calendarNavigation
  );
}
