import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { canvasNavigation } from "@/features/canvas/navigation";

const canvasSections = [
  {
    id: "recent",
    title: "최근 캔버스",
    description: "최근 작업한 캔버스와 이어서 작업할 항목을 확인합니다."
  },
  {
    id: "new",
    title: "새 캔버스",
    description: "새 자유형 작업 공간을 생성하는 흐름을 연결합니다."
  },
  {
    id: "board",
    title: "도형 보드",
    description: "도형, 메모, 코드블럭을 배치할 캔버스 영역을 준비합니다."
  }
];

export function CanvasPanel() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="border-primary/20 bg-primary text-primary-foreground">
        <CardHeader>
          <CardTitle>{canvasNavigation.title} 시작 영역</CardTitle>
          <CardDescription className="text-primary-foreground/75">
            {canvasNavigation.label}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="max-w-2xl text-sm leading-6 text-primary-foreground/80">
            {canvasNavigation.description}
          </p>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-3" aria-label="캔버스 영역">
        {canvasSections.map((section) => (
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
