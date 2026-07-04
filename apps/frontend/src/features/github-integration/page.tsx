import { MainShell } from "@/components/main-shell";
import { GithubPanel } from "@/features/github-integration/components/github-panel";
import { githubIntegrationNavigation } from "@/features/github-integration/navigation";

export function GithubPage() {
  return (
    <MainShell activeFeatureId={githubIntegrationNavigation.id}>
      <GithubPanel />
    </MainShell>
  );
}
