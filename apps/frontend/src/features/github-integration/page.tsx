"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";
import { buildGithubSettingsCompatibilityPath } from "@/features/github-integration/utils/github-settings-entry";

export function GithubPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const settingsPath = buildGithubSettingsCompatibilityPath(
    searchParams.toString()
  );

  useEffect(() => {
    router.replace(settingsPath);
  }, [router, settingsPath]);

  return (
    <div className="flex min-h-64 items-center justify-center p-6">
      <div
        aria-live="polite"
        className="grid w-full max-w-sm gap-3 text-center"
        role="status"
      >
        <Skeleton className="mx-auto h-8 w-48" />
        <Skeleton className="mx-auto h-4 w-64 max-w-full" />
        <p className="sr-only">GitHub 설정으로 이동하는 중입니다.</p>
      </div>
    </div>
  );
}
