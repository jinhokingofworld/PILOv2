"use client";

import {
  ChevronDown,
  FolderGit2,
  GitBranch,
  PanelsTopLeft,
  RefreshCcw
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type PanelProps = {
  title: string;
  tone?: "connection" | "repository" | "project" | "sync";
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
  tone = "connection",
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
    "relative overflow-hidden gap-0 rounded-[10px] border border-[#e2e6ec] bg-white py-0 shadow-[0_10px_28px_rgba(15,20,34,0.08)] ring-0",
    className
  );
  const headerClassName = cn(
    "relative z-10 flex items-start justify-between gap-4 px-5 py-4",
    (!collapsible || isOpen) && "border-b border-[#edf0f4]"
  );
  const decorationByTone = {
    connection: <GitBranch className="-right-5 -top-6 size-28 text-[#e8ecfa]" />,
    repository: <FolderGit2 className="right-3 top-3 size-20 -rotate-6 text-[#edf0f5]" />,
    project: <PanelsTopLeft className="-right-4 top-5 size-24 text-[#f0eee9]" />,
    sync: <RefreshCcw className="-bottom-5 -right-4 size-28 text-[#e5f1e9]" />
  }[tone];
  const decoration = (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-90 [&>svg]:absolute"
      data-github-panel-decoration={tone}
    >
      {decorationByTone}
    </span>
  );
  const header = (
    <CardHeader className={headerClassName}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
          {icon ? (
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {icon}
            </span>
          ) : null}
          <span className="truncate">{title}</span>
        </h2>
        {subtitle ? (
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
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
              render={
                <Button
                  className="text-muted-foreground"
                  size="icon"
                  type="button"
                  variant="outline"
                />
              }
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
    </CardHeader>
  );

  if (collapsible) {
    return (
      <Card className={panelClassName}>
        {decoration}
        <Collapsible onOpenChange={setIsOpen} open={isOpen}>
          {header}
          {isOpen ? (
            <CollapsibleContent>
              <CardContent className={cn("relative z-10 px-5 py-4", contentClassName)}>
                {children}
              </CardContent>
            </CollapsibleContent>
          ) : null}
        </Collapsible>
      </Card>
    );
  }

  return (
    <Card className={panelClassName}>
      {decoration}
      {header}
      <CardContent className={cn("relative z-10 px-5 py-4", contentClassName)}>
        {children}
      </CardContent>
    </Card>
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
    <Badge
      className={cn(
        "h-6 rounded-full px-2.5 text-[12px] font-semibold",
        pillClassNames[tone],
        className
      )}
      variant="outline"
    >
      {children}
    </Badge>
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
