import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PanelProps = {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

type PillTone = "default" | "success" | "warning" | "danger" | "info";

const pillClassNames: Record<PillTone, string> = {
  default: "border-[#d8dde8] bg-[#f7f8fb] text-[#4f5b73]",
  danger: "border-[#ffc9c9] bg-[#fff1f1] text-[#b42318]",
  info: "border-[#bfd7ff] bg-[#eff6ff] text-[#1d4ed8]",
  success: "border-[#b8e8ca] bg-[#effbf3] text-[#10743c]",
  warning: "border-[#f2d18a] bg-[#fff8e8] text-[#9a5f00]"
};

export function GithubConnectPanel({
  title,
  subtitle,
  icon,
  action,
  children,
  className,
  contentClassName
}: PanelProps) {
  return (
    <section
      className={cn(
        "rounded-[8px] border border-[#d9dee8] bg-white shadow-[0_18px_45px_rgba(15,20,34,0.08)]",
        className
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-[#eef1f6] px-5 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[#101828]">
            {icon ? (
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[#f0f4ff] text-[#3157d5]">
                {icon}
              </span>
            ) : null}
            <span className="truncate">{title}</span>
          </h2>
          {subtitle ? (
            <p className="mt-1 text-[13px] leading-5 text-[#687184]">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={cn("px-5 py-4", contentClassName)}>{children}</div>
    </section>
  );
}

export function GithubConnectPill({
  children,
  tone = "default",
  className
}: {
  children: ReactNode;
  tone?: PillTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2.5 text-[12px] font-semibold",
        pillClassNames[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function GithubConnectEmptyState({
  children
}: {
  children: ReactNode;
}) {
  return (
    <div className="rounded-[8px] border border-dashed border-[#cfd6e3] bg-[#f7f8fb] px-4 py-5 text-center text-[13px] leading-5 text-[#697386]">
      {children}
    </div>
  );
}

export function GithubConnectFieldRow({
  label,
  value
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[118px_minmax(0,1fr)] gap-3 border-b border-[#eef1f6] py-2.5 last:border-b-0 max-[520px]:grid-cols-1 max-[520px]:gap-1">
      <dt className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#838da0]">
        {label}
      </dt>
      <dd className="min-w-0 text-[13px] leading-5 text-[#293142]">{value}</dd>
    </div>
  );
}

export function GithubConnectProgress({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[#eef1f6]">
      <span
        className="block h-full rounded-full bg-[#2f6bff]"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
