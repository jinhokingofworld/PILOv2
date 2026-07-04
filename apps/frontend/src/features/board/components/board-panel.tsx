import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { boardNavigation } from "@/features/board/navigation";

const boardSections = [
  {
    id: "kanban",
    title: "칸반 보드",
    description: "Workspace의 이슈 카드 흐름을 보드 형태로 확인합니다."
  },
  {
    id: "columns",
    title: "컬럼",
    description: "GitHub ProjectV2 컬럼과 상태 흐름을 관리합니다."
  },
  {
    id: "issues",
    title: "이슈 상세",
    description: "보드 카드에서 연결되는 이슈 상세 화면을 다룹니다."
  }
];

export function BoardPanel() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          {boardNavigation.label}
        </p>
        <h1 className="text-2xl font-semibold tracking-normal">
          {boardNavigation.title}
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {boardNavigation.description}
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3" aria-label="보드 영역">
        {boardSections.map((section) => (
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
