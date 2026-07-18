"use client";

import { getMeetingCandidateSelections } from "@/features/agent/resource-links";
import type { AgentRun, SubmitAgentRunInput } from "@/features/agent/types";

type AgentMeetingCandidateSelectionsProps = {
  disabled: boolean;
  onSelect: (input: SubmitAgentRunInput) => void;
  run: AgentRun;
};

export function AgentMeetingCandidateSelections({
  disabled,
  onSelect,
  run
}: AgentMeetingCandidateSelectionsProps) {
  const candidates = getMeetingCandidateSelections(run);
  if (candidates.length === 0) return null;

  return (
    <div className="mt-2 space-y-2" aria-label="Meeting 후보">
      {candidates.map((candidate) => (
        <button
          key={candidate.candidateSelectionId}
          type="button"
          disabled={disabled}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() =>
            onSelect({
              message: `${candidate.label} 후보를 선택했습니다.`,
              selection: {
                kind: "meeting_candidate",
                candidateSelectionId: candidate.candidateSelectionId
              }
            })
          }
        >
          <span className="block text-sm font-medium text-slate-900">
            {candidate.label}
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
    </div>
  );
}
