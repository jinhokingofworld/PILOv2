"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type PanelProps = {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  className?: string;
  contentClassName?: string;
  defaultOpen?: boolean;
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
  collapsible = false,
  className,
  contentClassName,
  defaultOpen = true
}: PanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const panelClassName = cn(
    "rounded-[8px] border border-[#d9dee8] bg-white shadow-[0_18px_45px_rgba(15,20,34,0.08)]",
    className
  );
  const headerClassName = cn(
    "flex items-start justify-between gap-4 px-5 py-4",
    (!collapsible || isOpen) && "border-b border-[#eef1f6]"
  );
  const header = (
    <div className={headerClassName}>
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
      {action || collapsible ? (
        <div className="flex shrink-0 items-center gap-2">
          {action ? <div className="shrink-0">{action}</div> : null}
          {collapsible ? (
            <CollapsibleTrigger
              aria-label={`${title} 섹션 접기/펼치기`}
              className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#d9dee8] bg-white text-[#687184] transition-colors hover:bg-[#f7f8fb] hover:text-[#101828] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3157d5]/30"
              type="button"
            >
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  isOpen && "rotate-180"
                )}
              />
            </CollapsibleTrigger>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (collapsible) {
    return (
      <section className={panelClassName}>
        <Collapsible onOpenChange={setIsOpen} open={isOpen}>
          {header}
          {isOpen ? (
            <CollapsibleContent className={cn("px-5 py-4", contentClassName)}>
              {children}
            </CollapsibleContent>
          ) : null}
        </Collapsible>
      </section>
    );
  }

  return (
    <section className={panelClassName}>
      {header}
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

export function GithubConnectProgress({ value }: { value: number }) {
  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={value}
      className="h-2 overflow-hidden rounded-full bg-[#eef1f6]"
      role="progressbar"
    >
      <span
        className="block h-full rounded-full bg-[#2f6bff]"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
