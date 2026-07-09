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

export function DashboardCard({
  background,
  children,
  className,
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
  description: string | null;
  icon: ReactNode;
  action?: ReactNode;
  title: string;
  titleAdornment?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <Card className={`relative h-full min-h-0 ${className ?? ""} shadow-sm`} size="sm">
      {background ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {background}
        </div>
      ) : null}
      <CardHeader className="relative z-10">
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg border bg-background text-muted-foreground">
            {icon}
          </span>
          <span className={titleClassName}>{title}</span>
          {titleAdornment}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        <CardAction>
          {action ?? (
            <Button variant="ghost" size="icon-sm" aria-label={`${title} 열기`}>
              <ChevronRight />
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="relative z-10 flex min-h-0 flex-1 flex-col gap-4">
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
      className={`${rowSpanClassName} flex min-h-0 items-center justify-center rounded-lg border bg-background/80 p-3 text-center text-xs font-medium shadow-sm backdrop-blur ${
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


