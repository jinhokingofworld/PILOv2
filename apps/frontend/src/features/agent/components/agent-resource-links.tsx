"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createAgentApiClient } from "@/features/agent/api/client";
import { getAgentResourceLinks } from "@/features/agent/resource-links";
import type { AgentRun } from "@/features/agent/types";
import { stageSqlErdAgentTableFocus } from "@/features/sql-erd/utils/agent-table-focus";

type AgentResourceLinksProps = {
  accessToken: string | null;
  run: AgentRun;
};

export function AgentResourceLinks({
  accessToken,
  run
}: AgentResourceLinksProps) {
  const router = useRouter();
  const agentApiClient = useMemo(
    () => createAgentApiClient({ accessToken }),
    [accessToken]
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState(false);
  const links = getAgentResourceLinks(run);
  if (links.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {links.map((link) => {
        const className =
          "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-wait disabled:opacity-60";
        const content = (
          <>
            {link.label}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </>
        );
        if (link.navigation) {
          const contextRef = link.navigation.contextRef;
          return (
            <button
              key={link.key}
              type="button"
              disabled={!accessToken?.trim() || pendingKey !== null}
              onClick={async () => {
                setPendingKey(link.key);
                setNavigationError(false);
                try {
                  const navigation = await agentApiClient.resolveContextNavigation(
                    run.workspaceId,
                    run.id,
                    contextRef
                  );
                  if (navigation.focus) {
                    stageSqlErdAgentTableFocus(navigation.focus);
                  }
                  router.push(navigation.href);
                } catch {
                  setNavigationError(true);
                } finally {
                  setPendingKey(null);
                }
              }}
              className={className}
            >
              {content}
            </button>
          );
        }
        if (!link.href) return null;
        return (
          <Link
            key={link.key}
            href={link.href}
            onClick={() => {
              if (link.focus) {
                stageSqlErdAgentTableFocus(link.focus);
              }
            }}
            className={className}
          >
            {content}
          </Link>
        );
      })}
      {navigationError ? (
        <p className="text-xs text-rose-600">관련 화면을 열지 못했습니다.</p>
      ) : null}
    </div>
  );
}
