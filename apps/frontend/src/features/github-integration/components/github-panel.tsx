import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { githubIntegrationNavigation } from "@/features/github-integration/navigation";

const githubSections = [
  {
    id: "status",
    title: "연동 상태",
    description: "GitHub App 설치와 동기화 상태를 확인합니다."
  },
  {
    id: "repositories",
    title: "저장소",
    description: "연결된 저장소 목록과 선택 흐름을 관리합니다."
  },
  {
    id: "project",
    title: "ProjectV2",
    description: "ProjectV2 동기화와 이슈 보드 연결 상태를 확인합니다."
  }
];

export function GithubPanel() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="border-primary/20 bg-primary text-primary-foreground">
        <CardHeader>
          <CardTitle>{githubIntegrationNavigation.title} 시작 영역</CardTitle>
          <CardDescription className="text-primary-foreground/75">
            {githubIntegrationNavigation.label}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="max-w-2xl text-sm leading-6 text-primary-foreground/80">
            {githubIntegrationNavigation.description}
          </p>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-3" aria-label="GitHub 영역">
        {githubSections.map((section) => (
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
