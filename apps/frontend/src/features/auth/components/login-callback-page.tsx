"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { loadAuthSessionEntry } from "@/features/auth/auth-session";
import { LoginScene } from "@/features/auth/components/login-scene";
import { saveAuthSession } from "@/features/auth/session-storage";

type CallbackStatus = {
  message: string;
  errorMessage: string | null;
};

const ENTRY_MOTION_MS = 1100;

export function LoginCallbackPage() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(true);
  const [isEnteringWorkspace, setIsEnteringWorkspace] = useState(false);
  const [status, setStatus] = useState<CallbackStatus>({
    message: "로그인 완료 중",
    errorMessage: null
  });

  useEffect(() => {
    let isActive = true;

    async function completeCallback() {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = params.get("access_token");
      const expiresAt = params.get("expires_at");
      const returnTo = params.get("return_to");

      if (!accessToken) {
        if (!isActive) {
          return;
        }
        setIsPending(false);
        setStatus({
          message: "로그인을 완료하지 못했습니다.",
          errorMessage: "세션 토큰이 없습니다."
        });
        return;
      }

      try {
        saveAuthSession({
          accessToken,
          expiresAt
        });
        const session = await loadAuthSessionEntry(accessToken);
        if (!isActive) {
          return;
        }
        setIsPending(false);
        setIsEnteringWorkspace(true);
        setStatus({
          message: `${session.user.name ?? "사용자"}님으로 로그인했습니다.`,
          errorMessage: null
        });
        await waitForMotion(ENTRY_MOTION_MS);
        if (isActive) {
          router.replace(returnTo?.startsWith("/") ? returnTo : "/calendar");
        }
      } catch {
        if (!isActive) {
          return;
        }
        setIsPending(false);
        setIsEnteringWorkspace(false);
        setStatus({
          message: "로그인을 완료하지 못했습니다.",
          errorMessage: "세션 진입에 실패했습니다."
        });
      }
    }

    void completeCallback();

    return () => {
      isActive = false;
    };
  }, [router]);

  return (
    <LoginScene focused={isEnteringWorkspace}>
      <Card
        className="w-full max-w-sm p-6 text-center shadow-xl transition-all duration-700 data-[entering=true]:scale-95 data-[entering=true]:opacity-0"
        data-entering={isEnteringWorkspace ? "true" : "false"}
      >
        <div
          className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground data-[error=true]:bg-destructive data-[error=true]:text-destructive-foreground"
          data-error={status.errorMessage ? "true" : "false"}
        >
          {isPending ? <Loader2 className="size-5 animate-spin" /> : null}
          {!isPending && status.errorMessage ? (
            <AlertCircle className="size-5" />
          ) : null}
          {!isPending && !status.errorMessage ? (
            <CheckCircle2 className="size-5" />
          ) : null}
        </div>
        <p className="text-sm font-medium">{status.message}</p>
        {isPending ? (
          <div className="mx-auto mt-4 h-1.5 w-36 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
          </div>
        ) : null}
        {status.errorMessage ? (
          <p className="mt-3 text-sm text-destructive">{status.errorMessage}</p>
        ) : null}
      </Card>
    </LoginScene>
  );
}

function waitForMotion(durationMs: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}
