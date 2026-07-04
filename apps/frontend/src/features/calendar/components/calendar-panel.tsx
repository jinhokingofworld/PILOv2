import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { calendarNavigation } from "@/features/calendar/navigation";

const calendarSections = [
  {
    id: "month",
    title: "월간 일정",
    description: "Workspace 전체 일정 흐름을 월 단위로 확인합니다."
  },
  {
    id: "today",
    title: "오늘 일정",
    description: "오늘 진행할 일정과 선택 날짜의 작업을 확인합니다."
  },
  {
    id: "new",
    title: "새 일정",
    description: "새 Workspace 일정을 등록하는 흐름을 연결합니다."
  }
];

export function CalendarPanel() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="border-primary/20 bg-primary text-primary-foreground">
        <CardHeader>
          <CardTitle>{calendarNavigation.title} 시작 영역</CardTitle>
          <CardDescription className="text-primary-foreground/75">
            {calendarNavigation.label}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="max-w-2xl text-sm leading-6 text-primary-foreground/80">
            {calendarNavigation.description}
          </p>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-3" aria-label="캘린더 영역">
        {calendarSections.map((section) => (
          <Card id={section.id} key={section.id}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </div>
  );
}
