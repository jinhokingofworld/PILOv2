"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { getAgentResourceLinks } from "@/features/agent/resource-links";
import type { AgentRun } from "@/features/agent/types";
import { stageSqlErdAgentTableFocus } from "@/features/sql-erd/utils/agent-table-focus";

type AgentResourceLinksProps = {
  run: AgentRun;
};

export function AgentResourceLinks({ run }: AgentResourceLinksProps) {
  const links = getAgentResourceLinks(run);
  if (links.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {links.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          onClick={() => {
            if (link.focus) {
              stageSqlErdAgentTableFocus(link.focus);
            }
          }}
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        >
          {link.label}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
