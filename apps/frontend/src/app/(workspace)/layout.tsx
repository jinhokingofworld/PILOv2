import type { ReactNode } from "react";

import { AuthGate } from "@/features/auth";
import { MeetingRuntimeProvider } from "@/features/meeting/runtime/meeting-runtime-provider";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <MeetingRuntimeProvider>{children}</MeetingRuntimeProvider>
    </AuthGate>
  );
}
