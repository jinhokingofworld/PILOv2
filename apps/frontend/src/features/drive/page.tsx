import { MainShell } from "@/components/main-shell";
import { DrivePanel } from "@/features/drive/components/drive-panel";
import { driveNavigation } from "@/features/drive/navigation";

export function DrivePage() {
  return (
    <MainShell activeFeatureId={driveNavigation.id}>
      <DrivePanel />
    </MainShell>
  );
}
