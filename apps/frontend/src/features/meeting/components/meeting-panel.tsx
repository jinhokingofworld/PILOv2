import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { meetingNavigation } from "@/features/meeting/navigation";

const meetingSections = [
  {
    id: "room",
    title: "회의 입장",
    description: "진행 중인 회의와 새 회의 입장 흐름을 관리합니다."
  },
  {
    id: "recording",
    title: "녹음 상태",
    description: "회의 녹음 진행 상태와 참여자 상태를 확인합니다."
  },
  {
    id: "report",
    title: "회의록",
    description: "회의 종료 후 생성되는 회의록 흐름을 연결합니다."
  }
];

export function MeetingPanel() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="border-primary/20 bg-primary text-primary-foreground">
        <CardHeader>
          <CardTitle>{meetingNavigation.title} 시작 영역</CardTitle>
          <CardDescription className="text-primary-foreground/75">
            {meetingNavigation.label}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="max-w-2xl text-sm leading-6 text-primary-foreground/80">
            {meetingNavigation.description}
          </p>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-3" aria-label="음성채팅 영역">
        {meetingSections.map((section) => (
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
