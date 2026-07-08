import { MainShell } from "@/components/main-shell";
import { SqlErdPanel } from "@/features/sql-erd/components/sql-erd-panel";
import { sqlErdNavigation } from "@/features/sql-erd/navigation";

export function SqlErdPage() {
  return (
    <MainShell activeFeatureId={sqlErdNavigation.id}>
      <div className="sql-erd-full-bleed -m-6 h-[calc(100vh-3.5rem)] overflow-hidden">
        <SqlErdPanel />
      </div>
    </MainShell>
  );
}
