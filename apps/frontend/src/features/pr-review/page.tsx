import { MainShell } from "@/components/main-shell";
import { PrReviewPanel } from "@/features/pr-review/components/pr-review-panel";
import { prReviewNavigation } from "@/features/pr-review/navigation";

export function PrReviewPage() {
  return (
    <MainShell activeFeatureId={prReviewNavigation.id}>
      <PrReviewPanel />
    </MainShell>
  );
}
