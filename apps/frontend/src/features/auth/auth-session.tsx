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
  createWorkspace,
  getCurrentUser,
  listWorkspaces,
  logoutSession,
  type UserProfile,
  type Workspace
} from "@/features/auth/api/client";
import {
  clearStoredAuthSession,
  getSelectedWorkspaceId,
  getStoredAuthSession,
  saveSelectedWorkspaceId
} from "@/features/auth/session-storage";

export type AuthSessionData = {
  accessToken: string;
  user: UserProfile;
  workspaces: Workspace[];
  activeWorkspaceId: string;
};

type AuthSessionContextValue = AuthSessionData & {
  logout: () => Promise<void>;
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

      saveSelectedWorkspaceId(workspaceId);
      setState({
        status: "ready",
        message: state.message,
        session: {
          ...state.session,
          activeWorkspaceId: workspaceId
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

  const contextValue = useMemo<AuthSessionContextValue | null>(() => {
    if (state.status !== "ready") {
      return null;
    }

    return {
      ...state.session,
      logout,
      setActiveWorkspaceId
    };
  }, [logout, setActiveWorkspaceId, state]);

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
  const user = await getCurrentUser(accessToken);
  let workspaces = await listWorkspaces(accessToken);

  if (workspaces.length === 0) {
    workspaces = [await createWorkspace(accessToken, "PILO")];
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
    activeWorkspaceId: activeWorkspace.id
  };
}
