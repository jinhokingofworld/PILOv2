import { MainShell } from "@/components/main-shell";
import { SqlErdPanel } from "@/features/sql-erd/components/sql-erd-panel";
import { sqlErdNavigation } from "@/features/sql-erd/navigation";

export function SqlErdPage() {
  return (
    <MainShell activeFeatureId={sqlErdNavigation.id}>
      <SqlErdPanel />
    </MainShell>
  );
}
