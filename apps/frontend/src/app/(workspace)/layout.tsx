import type { ReactNode } from "react";

import { MainShell } from "@/components/main-shell";
import { AgentChatWidget } from "@/features/agent/components/agent-chat-widget";
import { AuthGate } from "@/features/auth";
import { MeetingRuntimeProvider } from "@/features/meeting/runtime/meeting-runtime-provider";
import { RealtimeProvider } from "@/shared/realtime/realtime-provider";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <RealtimeProvider>
        <MeetingRuntimeProvider>
          <MainShell>{children}</MainShell>
          <AgentChatWidget />
        </MeetingRuntimeProvider>
      </RealtimeProvider>
    </AuthGate>
  );
}
