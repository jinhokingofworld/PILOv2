"use client";

import { useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

import {
  getSqlErdSessionHeaderTitleSnapshot,
  resolveSqlErdSessionHeaderTitle,
  subscribeSqlErdSessionHeaderTitle
} from "@/features/sql-erd/session-header-title-store";

export function SqlErdSessionHeaderTitle({ fallback }: { fallback: string }) {
  const sessionId = useSearchParams().get("sessionId");
  const snapshot = useSyncExternalStore(
    subscribeSqlErdSessionHeaderTitle,
    getSqlErdSessionHeaderTitleSnapshot,
    () => null
  );

  return (
    <span className="truncate">
      {resolveSqlErdSessionHeaderTitle(snapshot, sessionId, fallback)}
    </span>
  );
}
