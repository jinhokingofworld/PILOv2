"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Clock3, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  AgentConfirmation,
  AgentConfirmationPlan,
  AgentRiskLevel
} from "@/features/agent/types";
import { cn } from "@/lib/utils";

type AgentConfirmationCardProps = {
  confirmation: AgentConfirmation;
  disabled?: boolean;
  isApproving?: boolean;
  isRejecting?: boolean;
  nowMs: number;
  onApprove: (choiceId?: string) => void;
  onReject: () => void;
};

const riskLevelLabels: Record<AgentRiskLevel, string> = {
  high: "High",
  low: "Low",
  medium: "Medium"
};

const riskLevelClassNames: Record<AgentRiskLevel, string> = {
  high: "border-red-200 bg-red-50 text-red-700",
  low: "border-emerald-200 bg-emerald-50 text-emerald-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700"
};

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatPlanValue(value: unknown): string {
  if (value === null) {
    return "없음";
  }

  if (value === undefined) {
    return "-";
  }

  if (typeof value === "string") {
    return value.trim() || "-";
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderObjectSummary(value: Record<string, unknown> | null) {
  if (!value || Object.keys(value).length === 0) {
    return <p className="text-xs text-slate-500">표시할 값이 없습니다.</p>;
  }

  return (
    <dl className="space-y-1.5">
      {Object.entries(value).map(([key, entryValue]) => (
        <div
          key={key}
          className="grid grid-cols-[minmax(72px,0.45fr)_minmax(0,1fr)] gap-2 text-xs"
        >
          <dt className="min-w-0 break-words font-medium text-slate-500">
            {key}
          </dt>
          <dd className="min-w-0 break-words text-slate-800">
            {formatPlanValue(entryValue)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function getTargetLabel(plan: AgentConfirmationPlan) {
  const domain = formatPlanValue(plan.target.domain);
  const resourceType = formatPlanValue(plan.target.resourceType);

  if (domain === "-" && resourceType === "-") {
    return "대상 정보 없음";
  }

  return `${domain} / ${resourceType}`;
}

export function AgentConfirmationCard({
  confirmation,
  disabled = false,
  isApproving = false,
  isRejecting = false,
  nowMs,
  onApprove,
  onReject
}: AgentConfirmationCardProps) {
  const plan = confirmation.plan;
  const isChoicePlan = plan?.kind === "choice";
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(
    confirmation.selectedChoiceId
  );

  useEffect(() => {
    setSelectedChoiceId(confirmation.selectedChoiceId);
  }, [confirmation.id, confirmation.selectedChoiceId]);

  const expiresAtMs = new Date(confirmation.expiresAt).getTime();
  const isExpired =
    Number.isFinite(expiresAtMs) && confirmation.status === "pending"
      ? expiresAtMs <= nowMs
      : confirmation.status === "expired";
  const isPending = confirmation.status === "pending" && !isExpired;
  const actionDisabled = disabled || !isPending || isApproving || isRejecting;
  const approveDisabled =
    actionDisabled || (isChoicePlan && !selectedChoiceId);
  const statusLabel = isExpired ? "expired" : confirmation.status;
  const summary = plan?.summary?.trim() || "승인이 필요한 작업입니다.";

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold",
              riskLevelClassNames[confirmation.riskLevel]
            )}
          >
            {riskLevelLabels[confirmation.riskLevel]}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600">
            <Clock3 className="size-3" />
            {formatDateTime(confirmation.expiresAt)}
          </span>
          <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600">
            {statusLabel}
          </span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-900">
          {summary}
        </p>
      </div>

      {plan ? (
        <div className="space-y-3 px-3 py-3">
          <div className="grid gap-1.5 text-xs">
            <span className="font-semibold text-slate-500">Tool</span>
            <span className="min-w-0 break-words rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
              {plan.toolName}
            </span>
          </div>

          <div className="grid gap-1.5 text-xs">
            <span className="font-semibold text-slate-500">Target</span>
            <span className="min-w-0 break-words text-slate-800">
              {getTargetLabel(plan)}
            </span>
          </div>

          {plan.kind === "choice" ? (
            <div className="grid gap-2" role="group" aria-label="실행 방식 선택">
              {plan.choices.map((choice) => {
                const isSelected = selectedChoiceId === choice.id;

                return (
                  <button
                    aria-pressed={isSelected}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left transition-colors",
                      isSelected
                        ? "border-blue-500 bg-blue-50 text-blue-900"
                        : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                    )}
                    disabled={disabled || !isPending || isApproving || isRejecting}
                    key={choice.id}
                    onClick={() => setSelectedChoiceId(choice.id)}
                    type="button"
                  >
                    <span className="block text-sm font-medium">{choice.label}</span>
                    {choice.description ? (
                      <span className="mt-1 block text-xs text-slate-500">
                        {choice.description}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 rounded-md border border-slate-200 p-2">
                <p className="mb-2 text-xs font-semibold text-slate-500">Before</p>
                {renderObjectSummary(plan.before)}
              </div>
              <div className="min-w-0 rounded-md border border-slate-200 p-2">
                <p className="mb-2 text-xs font-semibold text-slate-500">After</p>
                {renderObjectSummary(plan.after)}
              </div>
            </div>
          )}

          <details className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium">
              실행 호출 정보
            </summary>
            <div className="mt-2">{renderObjectSummary(plan.call)}</div>
          </details>
        </div>
      ) : (
        <div className="px-3 py-3 text-sm text-slate-600">
          확인할 plan 정보를 불러오지 못했습니다.
        </div>
      )}

      {isExpired ? (
        <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          이 confirmation은 만료되어 실행할 수 없습니다.
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-slate-200 px-3 py-3 sm:flex-row">
        <Button
          className="w-full sm:flex-1"
          disabled={approveDisabled}
          onClick={() => onApprove(selectedChoiceId ?? undefined)}
          size="sm"
          type="button"
        >
          <Check className="size-3.5" />
          {isApproving ? "승인 중" : "승인"}
        </Button>
        <Button
          className="w-full sm:flex-1"
          disabled={actionDisabled}
          onClick={onReject}
          size="sm"
          type="button"
          variant="outline"
        >
          <X className="size-3.5" />
          {isRejecting ? "거절 중" : "거절"}
        </Button>
      </div>
    </div>
  );
}
