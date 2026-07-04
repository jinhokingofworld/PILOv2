import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { prReviewNavigation } from "@/features/pr-review/navigation";

const prReviewSections = [
  {
    id: "open",
    title: "Open PR",
    description: "리뷰할 열린 PR 목록과 선택 흐름을 관리합니다."
  },
  {
    id: "analysis",
    title: "분석 결과",
    description: "AI 분석 결과와 파일별 판단을 확인합니다."
  },
  {
    id: "submit",
    title: "리뷰 제출",
    description: "GitHub Review 제출 전 최종 판단을 정리합니다."
  }
];

export function PrReviewPanel() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="border-primary/20 bg-primary text-primary-foreground">
        <CardHeader>
          <CardTitle>{prReviewNavigation.title} 시작 영역</CardTitle>
          <CardDescription className="text-primary-foreground/75">
            {prReviewNavigation.label}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="max-w-2xl text-sm leading-6 text-primary-foreground/80">
            {prReviewNavigation.description}
          </p>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-3" aria-label="PR 리뷰 영역">
        {prReviewSections.map((section) => (
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
