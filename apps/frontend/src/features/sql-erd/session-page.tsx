"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";

import { SqlErdPanel } from "@/features/sql-erd/components/sql-erd-panel";
import { readSqlErdSessionId } from "@/features/sql-erd/utils/session-navigation";

export function SqlErdSessionPage() {
  return (
    <Suspense fallback={<SqlErdSessionLoading />}>
      <SqlErdSessionRoute />
    </Suspense>
  );
}

function SqlErdSessionRoute() {
  const searchParams = useSearchParams();
  const sessionId = readSqlErdSessionId(searchParams.toString());

  if (!sessionId) {
    return (
      <div className="flex h-screen items-center justify-center bg-muted/20 px-6">
        <div className="max-w-md rounded-xl border bg-background p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Session을 선택해 주세요</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            편집할 SQLtoERD session 정보가 없습니다. 목록에서 session을 다시
            선택해 주세요.
          </p>
          <Link
            className="mt-6 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            href="/sql-erd"
          >
            <ArrowLeft className="size-4" />
            Session 목록으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="sql-erd-full-bleed h-screen overflow-hidden">
      <SqlErdPanel key={sessionId} sessionId={sessionId} />
    </div>
  );
}

function SqlErdSessionLoading() {
  return (
    <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Session을 불러오는 중입니다.
    </div>
  );
}
