"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GalleryVerticalEnd, GitBranch, Loader2, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  loadAuthSessionEntry,
  type AuthSessionData
} from "@/features/auth/auth-session";
import {
  startProviderLogin,
  type LoginProvider
} from "@/features/auth/api/client";
import { LoginFloatingShapes } from "@/features/auth/components/login-floating-shapes";
import { LoginScene } from "@/features/auth/components/login-scene";
import {
  getStoredAuthSession,
  saveSelectedWorkspaceId
} from "@/features/auth/session-storage";

type LoginStatus = {
  pendingProvider: LoginProvider | null;
  errorMessage: string | null;
};

export function LoginPage() {
  const router = useRouter();
  const [status, setStatus] = useState<LoginStatus>({
    pendingProvider: null,
    errorMessage: null
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");

    if (error) {
      setStatus((currentStatus) => ({
        ...currentStatus,
        errorMessage: getErrorMessage(error)
      }));
      return;
    }

    const storedSession = getStoredAuthSession();
    if (!storedSession) {
      return;
    }

    void loadAuthSessionEntry(storedSession.accessToken)
      .then((session) => {
        routeToEntry(router, session, readReturnUrl());
      })
      .catch(() => undefined);
  }, [router]);

  const handleStartLogin = async (provider: LoginProvider) => {
    setStatus({
      pendingProvider: provider,
      errorMessage: null
    });

    try {
      const start = await startProviderLogin(provider, readReturnUrl());
      window.location.assign(start.authorizeUrl);
    } catch (error) {
      setStatus({
        pendingProvider: null,
        errorMessage:
          error instanceof Error
            ? error.message
            : "로그인을 시작하지 못했습니다."
      });
    }
  };

  return (
    <LoginScene decorations={<LoginFloatingShapes />}>
      <div className="flex w-full max-w-lg flex-col gap-6">
        <a className="flex items-center gap-3 self-center text-lg font-semibold" href="#">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GalleryVerticalEnd className="size-5" />
          </div>
          PILO
        </a>

        <Card className="shadow-xl">
          <CardHeader className="px-10 pt-10 pb-5 text-center">
            <CardTitle className="text-3xl">Welcome back</CardTitle>
            <CardDescription>
              Login with your GitHub or Google account
            </CardDescription>
          </CardHeader>
          <CardContent className="px-10 pb-10">
            <form className="grid gap-6" onSubmit={(event) => event.preventDefault()}>
              <div className="grid gap-3">
                <Button
                  className="h-14 w-full text-base"
                  disabled={status.pendingProvider !== null}
                  onClick={() => void handleStartLogin("github")}
                  type="button"
                  variant="outline"
                >
                  {status.pendingProvider === "github" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <GitBranch className="size-4" />
                  )}
                  Login with GitHub
                </Button>
                <Button
                  className="h-14 w-full text-base"
                  disabled={status.pendingProvider !== null}
                  onClick={() => void handleStartLogin("google")}
                  type="button"
                  variant="outline"
                >
                  {status.pendingProvider === "google" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <UserRound className="size-4" />
                  )}
                  Login with Google
                </Button>
              </div>
            </form>

            {status.errorMessage ? (
              <p className="mt-4 text-sm text-destructive">{status.errorMessage}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </LoginScene>
  );
}

function readReturnUrl() {
  const params = new URLSearchParams(window.location.search);
  const returnUrl = params.get("returnUrl");

  return returnUrl?.startsWith("/") && !returnUrl.startsWith("//")
    ? returnUrl
    : "/calendar";
}

function routeToEntry(
  router: ReturnType<typeof useRouter>,
  session: AuthSessionData,
  returnUrl: string
) {
  saveSelectedWorkspaceId(session.activeWorkspaceId);
  router.replace(returnUrl || "/calendar");
}

function getErrorMessage(error: string) {
  if (error === "session_expired") {
    return "다시 로그인해주세요.";
  }

  if (error.includes("google")) {
    return "Google 로그인을 완료하지 못했습니다.";
  }

  if (error.includes("github")) {
    return "GitHub 로그인을 완료하지 못했습니다.";
  }

  return "로그인을 완료하지 못했습니다.";
}
