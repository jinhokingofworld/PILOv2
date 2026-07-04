import { MainShell } from "@/components/main-shell";
import { CalendarPanel } from "@/features/calendar/components/calendar-panel";
import { calendarNavigation } from "@/features/calendar/navigation";

export function CalendarPage() {
  return (
    <MainShell activeFeatureId={calendarNavigation.id}>
      <CalendarPanel />
    </MainShell>
  );
}
