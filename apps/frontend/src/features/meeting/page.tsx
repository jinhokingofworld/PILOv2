import { MainShell } from "@/components/main-shell";
import { MeetingPanel } from "@/features/meeting/components/meeting-panel";
import { meetingNavigation } from "@/features/meeting/navigation";

export function MeetingPage() {
  return (
    <MainShell activeFeatureId={meetingNavigation.id}>
      <MeetingPanel />
    </MainShell>
  );
}
