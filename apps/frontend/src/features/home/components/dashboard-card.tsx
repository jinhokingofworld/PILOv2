"use client";

import { type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { pageCursorTargetAttributes } from "@/shared/page-cursor/page-cursor-target";

export function DashboardCard({
  background,
  children,
  className,
  cursorTarget,
  description,
  icon,
  action,
  title,
  titleAdornment,
  titleClassName
}: {
  background?: ReactNode;
  children: ReactNode;
  className?: string;
  cursorTarget?: {
    id: string;
    label?: string;
    type: string;
  };
  description: string | null;
  icon: ReactNode;
  action?: ReactNode;
  title: string;
  titleAdornment?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <Card
      {...(cursorTarget ? pageCursorTargetAttributes(cursorTarget) : {})}
      className={`relative h-full min-h-0 overflow-hidden rounded-[15px] border-[#e7e9ee] bg-white shadow-[0_10px_30px_rgba(32,33,36,0.05)] ${className ?? ""}`}
      size="sm"
    >
      {background ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {background}
        </div>
      ) : null}
      <CardHeader className="relative z-10 gap-1.5 px-5 pt-5">
        <CardTitle className="flex items-center gap-2.5 text-[16px] font-semibold tracking-[-0.01em] text-[#202124]">
          <span className="flex size-8 items-center justify-center rounded-[10px] border border-[#e7e9ee] bg-[#f6f7f9] text-[#747882]">
            {icon}
          </span>
          <span className={titleClassName}>{title}</span>
          {titleAdornment}
        </CardTitle>
        {description ? (
          <CardDescription className="text-[12px] leading-5 text-[#747882]">
            {description}
          </CardDescription>
        ) : null}
        <CardAction>
          {action ?? (
            <Button variant="ghost" size="icon-sm" aria-label={`${title} 열기`}>
              <ChevronRight />
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="relative z-10 flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5">
        {children}
      </CardContent>
    </Card>
  );
}

export function DashboardNavigationAction({
  ariaLabel,
  href
}: {
  ariaLabel: string;
  href: string;
}) {
  const router = useRouter();

  return (
    <Button
      aria-label={ariaLabel}
      onClick={() => router.push(href)}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <ChevronRight />
    </Button>
  );
}



export function DashboardCardMessage({
  children,
  rowSpanClassName = "row-span-5",
  tone = "muted"
}: {
  children: ReactNode;
  rowSpanClassName?: string;
  tone?: "danger" | "muted";
}) {
  return (
    <div
      className={`${rowSpanClassName} flex min-h-0 items-center justify-center rounded-[10px] border border-[#e7e9ee] bg-[#f8f9fb] p-3 text-center text-[12px] font-medium ${
        tone === "danger" ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {children}
    </div>
  );
}



export function StatusPill({
  className = "",
  label,
  tone
}: {
  className?: string;
  label: string;
  tone: "danger" | "muted" | "neutral" | "success";
}) {
  const toneClassName = {
    danger: "border border-red-200 bg-red-50 text-red-700",
    muted: "border bg-muted text-muted-foreground",
    neutral: "border bg-background text-foreground",
    success: "border border-emerald-200 bg-emerald-50 text-emerald-700"
  }[tone];

  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium ${toneClassName} ${className}`}
    >
      {label}
    </span>
  );
}
