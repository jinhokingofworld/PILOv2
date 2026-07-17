"use client";

import {
  getSqlErdSessionCandidates,
  type SqlErdSessionCandidate
} from "@/features/agent/resource-links";
import type {
  AgentRun,
  SubmitAgentRunInput
} from "@/features/agent/types";

type AgentSqlErdSessionCandidatesProps = {
  disabled: boolean;
  onSelect: (input: SubmitAgentRunInput) => void;
  run: AgentRun;
};

function formatCandidateDate(candidate: SqlErdSessionCandidate) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(candidate.updatedAt));
}

export function AgentSqlErdSessionCandidates({
  disabled,
  onSelect,
  run
}: AgentSqlErdSessionCandidatesProps) {
  const candidates = getSqlErdSessionCandidates(run);
  if (candidates.length === 0) return null;

  return (
    <div className="mt-2 space-y-2" aria-label="SQLtoERD 세션 후보">
      {candidates.map((candidate) => (
        <button
          key={candidate.selectionToken}
          type="button"
          disabled={disabled}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() =>
            onSelect({
              message: `${candidate.title} 세션을 선택했습니다.`,
              selection: {
                kind: "sql_erd_session",
                token: candidate.selectionToken
              }
            })
          }
        >
          <span className="block text-sm font-medium text-slate-900">
            {candidate.title}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            수정 {formatCandidateDate(candidate)} · 테이블 {candidate.tableCount}개 ·
            관계 {candidate.relationCount}개
          </span>
        </button>
      ))}
    </div>
  );
}
