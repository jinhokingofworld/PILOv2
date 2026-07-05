"use client";

import { useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Code2,
  FileText,
  GitPullRequest,
  MessageSquare
} from "lucide-react";

import { cn } from "@/lib/utils";

type FloatingShape = {
  title: string;
  body: string;
  label: string;
  positionClassName: string;
  cardClassName: string;
  badgeClassName: string;
  icon: typeof CalendarDays;
  floatX: string;
  floatY: string;
  rotate: string;
  drift: string;
  duration: string;
  delay: string;
};

const floatingShapes: FloatingShape[] = [
  {
    title: "오늘 일정",
    body: "10:30 캘린더 리뷰",
    label: "CAL",
    positionClassName: "left-[9%] top-[22%] hidden md:block",
    cardClassName: "bg-white/95 shadow-lg",
    badgeClassName: "bg-sky-100 text-sky-700",
    icon: CalendarDays,
    floatX: "12px",
    floatY: "-14px",
    rotate: "-6deg",
    drift: "2deg",
    duration: "8.5s",
    delay: "-1s"
  },
  {
    title: "auth.guard.ts",
    body: "if (!session) redirect('/login')",
    label: "CODE",
    positionClassName: "right-[9%] top-[18%] hidden lg:block",
    cardClassName: "bg-zinc-950 text-zinc-50 shadow-xl",
    badgeClassName: "bg-violet-500/20 text-violet-200",
    icon: Code2,
    floatX: "-10px",
    floatY: "13px",
    rotate: "5deg",
    drift: "-2deg",
    duration: "9s",
    delay: "-2.5s"
  },
  {
    title: "회의록",
    body: "Task 2개 생성 예정",
    label: "MEET",
    positionClassName: "left-[12%] top-[50%] hidden lg:block",
    cardClassName: "bg-white/95 shadow-lg",
    badgeClassName: "bg-emerald-100 text-emerald-700",
    icon: MessageSquare,
    floatX: "10px",
    floatY: "12px",
    rotate: "2deg",
    drift: "2deg",
    duration: "7.8s",
    delay: "-3s"
  },
  {
    title: "기능 명세",
    body: "Workspace / Canvas",
    label: "FILE",
    positionClassName: "right-[5%] top-[47%] hidden md:block",
    cardClassName: "bg-white/95 shadow-lg",
    badgeClassName: "bg-violet-100 text-violet-700",
    icon: FileText,
    floatX: "-13px",
    floatY: "-10px",
    rotate: "-3deg",
    drift: "-2deg",
    duration: "8.2s",
    delay: "-1.8s"
  },
  {
    title: "로그인 API 연동",
    body: "통합 OAuth",
    label: "TASK",
    positionClassName: "bottom-[17%] left-[16%] hidden lg:block",
    cardClassName: "bg-white/95 shadow-lg",
    badgeClassName: "bg-rose-100 text-rose-700",
    icon: CheckCircle2,
    floatX: "14px",
    floatY: "-9px",
    rotate: "4deg",
    drift: "-2deg",
    duration: "9.5s",
    delay: "-4s"
  },
  {
    title: "PR #84",
    body: "세션 진입 흐름",
    label: "PR",
    positionClassName: "bottom-[18%] right-[15%] hidden lg:block",
    cardClassName: "bg-white/95 shadow-lg",
    badgeClassName: "bg-amber-100 text-amber-700",
    icon: GitPullRequest,
    floatX: "-12px",
    floatY: "11px",
    rotate: "-4deg",
    drift: "2deg",
    duration: "8.8s",
    delay: "-2.2s"
  }
];

export function LoginFloatingShapes() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[5] transition-opacity duration-500"
    >
      <div className="absolute left-[17%] top-[38%] hidden h-px w-[20%] -rotate-[152deg] bg-violet-300/60 lg:block" />
      <div className="absolute right-[17%] top-[37%] hidden h-px w-[18%] -rotate-[18deg] bg-violet-300/60 lg:block" />
      <div className="absolute bottom-[29%] left-[17%] hidden h-px w-[18%] -rotate-[18deg] bg-violet-300/60 lg:block" />
      <div className="absolute bottom-[30%] right-[17%] hidden h-px w-[18%] rotate-[18deg] bg-violet-300/60 lg:block" />

      {floatingShapes.map((shape) => (
        <FloatingShapeCard key={shape.title} shape={shape} />
      ))}
    </div>
  );
}

function FloatingShapeCard({ shape }: { shape: FloatingShape }) {
  const Icon = shape.icon;
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const cardStyle = {
    "--login-float-x": shape.floatX,
    "--login-float-y": shape.floatY,
    "--login-shape-rotate": shape.rotate,
    "--login-shape-drift": shape.drift,
    "--login-float-duration": shape.duration,
    animationDelay: shape.delay
  } as CSSProperties;
  const shellStyle = {
    transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`
  } as CSSProperties;

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    setOffset({
      x: dragState.offsetX + event.clientX - dragState.startX,
      y: dragState.offsetY + event.clientY - dragState.startY
    });
  };

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className={cn(
        "pointer-events-auto absolute cursor-grab touch-none select-none active:cursor-grabbing",
        shape.positionClassName
      )}
      onPointerCancel={stopDragging}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      style={shellStyle}
    >
      <div
        className={cn(
          "login-floating-shape w-44 rounded-lg border p-4",
          shape.cardClassName
        )}
        style={cardStyle}
      >
        <div
          className={cn(
            "mb-3 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold",
            shape.badgeClassName
          )}
        >
          <Icon className="size-3" />
          {shape.label}
        </div>
        <div className="text-sm font-semibold leading-tight">{shape.title}</div>
        <div className="mt-1 text-xs leading-5 opacity-70">{shape.body}</div>
      </div>
    </div>
  );
}
