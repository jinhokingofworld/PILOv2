"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  getCurrentUser,
  listWorkspaces,
  logoutSession,
  type UserProfile,
  type Workspace
} from "@/features/auth/api/client";
import {
  clearStoredAuthSession,
  isDevPreviewAccessToken,
  isDevPreviewEnabled,
  PILO_DEV_PREVIEW_WORKSPACE_ID,
  getSelectedWorkspaceId,
  getStoredAuthSession,
  saveSelectedWorkspaceId
} from "@/features/auth/session-storage";

export type AuthSessionData = {
  accessToken: string;
  user: UserProfile;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeWorkspace: Workspace;
};

type AuthSessionContextValue = AuthSessionData & {
  logout: () => Promise<void>;
  refreshSession: (preferredWorkspaceId?: string) => Promise<void>;
  setActiveWorkspaceId: (workspaceId: string) => void;
};

type AuthGateState =
  | {
      status: "checking";
      session: null;
      message: string;
    }
  | {
      status: "ready";
      session: AuthSessionData;
      message: string;
    };

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);
const DEV_PREVIEW_USER_ID = "00000000-0000-4000-8000-000000000137";
const DEV_PREVIEW_TIMESTAMP = "2026-07-06T00:00:00.000Z";

const devPreviewUser: UserProfile = {
  id: DEV_PREVIEW_USER_ID,
  name: "PILO UI Preview",
  email: "preview@pilo.local",
  avatarUrl: null,
  createdAt: DEV_PREVIEW_TIMESTAMP,
  updatedAt: DEV_PREVIEW_TIMESTAMP
};

const devPreviewWorkspace: Workspace = {
  id: PILO_DEV_PREVIEW_WORKSPACE_ID,
  name: "PILO UI Preview",
  ownerUserId: DEV_PREVIEW_USER_ID,
  role: "owner",
  isOwner: true,
  createdAt: DEV_PREVIEW_TIMESTAMP,
  updatedAt: DEV_PREVIEW_TIMESTAMP
};

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<AuthGateState>({
    status: "checking",
    session: null,
    message: "세션 확인 중"
  });

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setState({
        status: "checking",
        session: null,
        message: "세션 확인 중"
      });

      const storedSession = getStoredAuthSession();
      if (!storedSession) {
        router.replace(`/login?returnUrl=${encodeURIComponent(pathname || "/calendar")}`);
        return;
      }

      try {
        const session = await loadAuthSessionEntry(storedSession.accessToken);
        if (!cancelled) {
          setState({
            status: "ready",
            session,
            message: "세션 확인 완료"
          });
        }
      } catch {
        clearStoredAuthSession();
        if (!cancelled) {
          router.replace(
            `/login?returnUrl=${encodeURIComponent(pathname || "/calendar")}&error=session_expired`
          );
        }
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  const setActiveWorkspaceId = useCallback(
    (workspaceId: string) => {
      if (state.status !== "ready") {
        return;
      }

      const activeWorkspace =
        state.session.workspaces.find((workspace) => workspace.id === workspaceId) ??
        state.session.activeWorkspace;

      saveSelectedWorkspaceId(activeWorkspace.id);
      setState({
        status: "ready",
        message: state.message,
        session: {
          ...state.session,
          activeWorkspaceId: activeWorkspace.id,
          activeWorkspace
        }
      });
    },
    [state]
  );

  const logout = useCallback(async () => {
    const accessToken = state.session?.accessToken;

    if (accessToken) {
      await logoutSession(accessToken).catch(() => undefined);
    }

    clearStoredAuthSession();
    router.replace("/login");
  }, [router, state.session?.accessToken]);

  const refreshSession = useCallback(
    async (preferredWorkspaceId?: string) => {
      if (state.status !== "ready") {
        return;
      }

      if (preferredWorkspaceId) {
        saveSelectedWorkspaceId(preferredWorkspaceId);
      }

      const session = await loadAuthSessionEntry(state.session.accessToken);
      setState({
        status: "ready",
        message: "세션 확인 완료",
        session
      });
    },
    [state]
  );

  const contextValue = useMemo<AuthSessionContextValue | null>(() => {
    if (state.status !== "ready") {
      return null;
    }

    return {
      ...state.session,
      logout,
      refreshSession,
      setActiveWorkspaceId
    };
  }, [logout, refreshSession, setActiveWorkspaceId, state]);

  if (state.status !== "ready" || !contextValue) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-sm text-muted-foreground">
        {state.message}
      </div>
    );
  }

  return (
    <AuthSessionContext.Provider value={contextValue}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  return useContext(AuthSessionContext);
}

export async function loadAuthSessionEntry(
  accessToken: string
): Promise<AuthSessionData> {
  if (isDevPreviewAccessToken(accessToken)) {
    if (!isDevPreviewEnabled()) {
      throw new Error("Dev preview is disabled");
    }

    saveSelectedWorkspaceId(devPreviewWorkspace.id);

    return {
      accessToken,
      user: devPreviewUser,
      workspaces: [devPreviewWorkspace],
      activeWorkspaceId: devPreviewWorkspace.id,
      activeWorkspace: devPreviewWorkspace
    };
  }

  const user = await getCurrentUser(accessToken);
  const workspaces = await listWorkspaces(accessToken);

  if (workspaces.length === 0) {
    throw new Error("Default workspace was not initialized during login");
  }

  const storedWorkspaceId = getSelectedWorkspaceId();
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === storedWorkspaceId) ??
    workspaces[0];

  saveSelectedWorkspaceId(activeWorkspace.id);

  return {
    accessToken,
    user,
    workspaces,
    activeWorkspaceId: activeWorkspace.id,
    activeWorkspace
  };
}
