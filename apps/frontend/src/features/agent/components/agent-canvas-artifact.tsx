"use client";

import { useEffect, useMemo, useState } from "react";
import { CanvasHtmlArtifactPreview } from "@/components/canvas-html-artifact-preview";
import { presentCanvasAgentDelegationRunOnce } from "@/features/agent/canvas-delegation-context";
import type { AgentRun } from "@/features/agent/types";
import { createCanvasAgentClient } from "@/features/canvas/api/canvas-agent-client";
import type {
  CanvasAgentHtmlArtifact,
  CanvasAgentSelectedScene,
} from "@/features/canvas/api/canvas-agent-types";

export function AgentCanvasArtifact({ run }: { run: AgentRun }) {
  const client = useMemo(() => createCanvasAgentClient(), []);
  const delegation = readDelegation(run);
  const [artifact, setArtifact] = useState<CanvasAgentHtmlArtifact | null>(null);

  useEffect(() => {
    if (!delegation || run.status !== "completed") return;
    let cancelled = false;
    void client
      .getRun(run.workspaceId, delegation.canvasId, delegation.runId)
      .then((detail) => {
        if (cancelled) return;
        setArtifact(detail.run.artifact);
        const selectedScene = run.requestContext?.surface === "canvas"
          ? run.requestContext.canvasContext.selectedScene ?? null
          : null;
        presentCanvasAgentDelegationRunOnce({
          canvasId: delegation.canvasId,
          run: detail.run,
          selectedScene: selectedScene as CanvasAgentSelectedScene | null,
        });
      })
      .catch(() => {
        if (!cancelled) setArtifact(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, delegation?.canvasId, delegation?.runId, run]);

  return artifact ? <CanvasHtmlArtifactPreview artifact={artifact} /> : null;
}

function readDelegation(run: AgentRun) {
  for (const step of run.steps) {
    for (const resource of step.resourceRefs) {
      const canvasId = resource.metadata?.canvasId;
      if (
        resource.domain === "canvas" &&
        resource.resourceType === "canvas_agent_run" &&
        typeof resource.resourceId === "string" &&
        typeof canvasId === "string"
      ) {
        return { canvasId, runId: resource.resourceId };
      }
    }
  }
  return null;
}
