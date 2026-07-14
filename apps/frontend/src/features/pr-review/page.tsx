import { PrReviewPanel } from "@/features/pr-review/components/pr-review-panel";

export function PrReviewPage() {
  return <PrReviewPanel />;
}

export function PrReviewRoomsPage() {
  return <PrReviewPanel view="rooms" />;
}
