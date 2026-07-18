export type GithubRecoveryEvent =
  | "reconnect_required"
  | "callback_failed"
  | "transient_failure";

export type GithubRecoveryDecision = {
  action: "recover" | "terminal" | "manual" | "retry";
  recovery: boolean;
};

export function getGithubRecoveryDecision(input: {
  event: GithubRecoveryEvent;
  recovery: boolean;
}): GithubRecoveryDecision {
  if (input.event === "reconnect_required") {
    return input.recovery
      ? { action: "terminal", recovery: true }
      : { action: "recover", recovery: true };
  }

  if (input.event === "callback_failed") {
    return input.recovery
      ? { action: "terminal", recovery: true }
      : { action: "manual", recovery: false };
  }

  return { action: "retry", recovery: input.recovery };
}

export function createGithubRecoveryAttemptGate() {
  let pending = false;

  return {
    begin() {
      if (pending) return false;
      pending = true;
      return true;
    },
    complete() {
      pending = false;
    }
  };
}
