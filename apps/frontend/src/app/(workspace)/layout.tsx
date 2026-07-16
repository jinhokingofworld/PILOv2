import type { ReactNode } from "react";

import { MainShell } from "@/components/main-shell";
import { Toaster } from "@/components/ui/sonner";
import { AgentChatWidget } from "@/features/agent/components/agent-chat-widget";
import { AuthGate } from "@/features/auth";
import { MeetingRuntimeProvider } from "@/features/meeting/runtime/meeting-runtime-provider";
import { RealtimeProvider } from "@/shared/realtime/realtime-provider";
import { WorkspacePresenceProvider } from "@/shared/workspace-presence/workspace-presence-provider";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <RealtimeProvider>
        <WorkspacePresenceProvider>
          <MeetingRuntimeProvider>
            <MainShell>{children}</MainShell>
            <AgentChatWidget />
            <Toaster />
          </MeetingRuntimeProvider>
        </WorkspacePresenceProvider>
      </RealtimeProvider>
    </AuthGate>
  );
}
