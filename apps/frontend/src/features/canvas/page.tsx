import { Suspense } from "react";

import { CanvasPanel } from "@/features/canvas/components/canvas-panel";

export function CanvasPage() {
  return (
    <Suspense fallback={null}>
      <CanvasPanel />
    </Suspense>
  );
}
