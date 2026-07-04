import { MainShell } from "@/components/main-shell";
import { CanvasPanel } from "@/features/canvas/components/canvas-panel";
import { canvasNavigation } from "@/features/canvas/navigation";

export function CanvasPage() {
  return (
    <MainShell activeFeatureId={canvasNavigation.id}>
      <CanvasPanel />
    </MainShell>
  );
}
