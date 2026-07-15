"use client";

import { useSearchParams } from "next/navigation";

import { WorkspaceCanvas } from "@/features/canvas/components/workspace-canvas";

export function CanvasPanel() {
  const searchParams = useSearchParams();
  const boardId = searchParams.get("canvasId")?.trim() || undefined;
  return <WorkspaceCanvas boardId={boardId} />;
}
