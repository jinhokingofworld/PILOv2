"use client";

import { getAgentCandidateSelections } from "@/features/agent/resource-links";
import type { AgentRun, SubmitAgentRunInput } from "@/features/agent/types";

type AgentCandidateSelectionsProps = {
  disabled: boolean;
  onSelect: (input: SubmitAgentRunInput) => void;
  onRetry: () => void;
  run: AgentRun;
};

export function AgentCandidateSelections({
  disabled,
  onSelect,
  onRetry,
  run
}: AgentCandidateSelectionsProps) {
  const candidates = getAgentCandidateSelections(run);
  if (candidates.length === 0) return null;

  return (
    <div className="mt-2 space-y-2" aria-label="후보 선택">
      <p className="text-xs text-slate-500">아래 후보 중 하나를 선택해 주세요.</p>
      {candidates.map((candidate, index) => (
        <button
          key={candidate.key}
          type="button"
          disabled={disabled}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() =>
            onSelect({
              message: `${index + 1}번 후보를 선택했습니다.`,
              selection: candidate.selection
            })
          }
        >
          <span className="block text-sm font-medium text-slate-900">
            {index + 1}. {candidate.label}
          </span>
          {candidate.description || candidate.status ? (
            <span className="mt-0.5 block text-xs text-slate-500">
              {[candidate.description, candidate.status]
                .filter((value): value is string => Boolean(value))
                .join(" · ")}
            </span>
          ) : null}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        className="text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onRetry}
      >
        다시 찾기
      </button>
    </div>
  );
}
