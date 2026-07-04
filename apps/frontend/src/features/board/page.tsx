import { MainShell } from "@/components/main-shell";
import { BoardPanel } from "@/features/board/components/board-panel";
import { boardNavigation } from "@/features/board/navigation";

export function BoardPage() {
  return (
    <MainShell activeFeatureId={boardNavigation.id}>
      <BoardPanel />
    </MainShell>
  );
}
