import type {
  SqlErdSelection,
  SqltoerdSessionPayload,
  SqltoerdSessionFixture
} from "@/features/sql-erd/types";

export type SqlErdViewSession = Pick<
  SqltoerdSessionPayload,
  | "dialect"
  | "layoutJson"
  | "modelJson"
  | "settingsJson"
  | "sourceFormat"
  | "sourceText"
  | "title"
> & {
  id: string | null;
  revision: number | null;
};

export type SqlErdSessionLoadState = {
  label: string;
  message: string;
  tone: "error" | "neutral" | "success";
};

export type LayoutAutosaveBlockReason =
  | "conflict"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_payload"
  | "unknown_non_transient";

export type LayoutAutosavePausedBannerViewModel = {
  canRetry: boolean;
  message: string;
  reason: LayoutAutosaveBlockReason;
};

export const SQL_ERD_LAYOUT_AUTOSAVE_DEBOUNCE_MS = 2000;
export const SQL_ERD_LAYOUT_AUTOSAVE_MAX_RETRY_DELAY_MS = 30000;

export type SqlErdSessionReloadFailureAction =
  | {
      kind: "fallback_to_sample";
      sessionLoadState: SqlErdSessionLoadState;
      selectedSqlErdObject: SqlErdSelection;
    }
  | {
      kind: "preserve_current";
      sessionLoadState: SqlErdSessionLoadState;
    };

export function createSampleSqlErdViewSession(
  fixture: SqltoerdSessionFixture
): SqlErdViewSession {
  return {
    id: null,
    revision: null,
    title: fixture.title,
    sourceFormat: fixture.sourceFormat,
    dialect: fixture.dialect,
    sourceText: fixture.sourceText,
    modelJson: fixture.modelJson,
    layoutJson: fixture.layoutJson,
    settingsJson: fixture.settingsJson
  };
}

export function createWorkspaceSqlErdViewSession(
  session: SqltoerdSessionPayload
): SqlErdViewSession {
  return {
    id: session.id,
    revision: session.revision,
    title: session.title,
    sourceFormat: session.sourceFormat,
    dialect: session.dialect,
    sourceText: session.sourceText,
    modelJson: session.modelJson,
    layoutJson: session.layoutJson,
    settingsJson: session.settingsJson
  };
}

export function getLayoutAutosaveBlockReasonForStatus(
  status: number | null | undefined
): LayoutAutosaveBlockReason | null {
  if (status === 409) {
    return "conflict";
  }

  if (status === 401) {
    return "unauthorized";
  }

  if (status === 403) {
    return "forbidden";
  }

  if (status === 404) {
    return "not_found";
  }

  if (status === 400 || status === 413) {
    return "invalid_payload";
  }

  if (typeof status !== "number") {
    return null;
  }

  if (status === 408 || status === 429 || status >= 500) {
    return null;
  }

  return "unknown_non_transient";
}

export function isLayoutAutosaveTransientStatus(
  status: number | null | undefined
) {
  return getLayoutAutosaveBlockReasonForStatus(status) === null;
}

export function getLayoutAutosaveDelayMs(retryAttempt: number) {
  return Math.min(
    SQL_ERD_LAYOUT_AUTOSAVE_DEBOUNCE_MS * 2 ** retryAttempt,
    SQL_ERD_LAYOUT_AUTOSAVE_MAX_RETRY_DELAY_MS
  );
}

export function getLayoutAutosavePausedBanner(
  reason: LayoutAutosaveBlockReason
): LayoutAutosavePausedBannerViewModel {
  if (reason === "conflict") {
    return {
      canRetry: false,
      message:
        "Workspace session changed. Reload the latest session before saving this layout.",
      reason
    };
  }

  if (reason === "unauthorized") {
    return {
      canRetry: false,
      message: "Sign in again, then reload this SQLtoERD session.",
      reason
    };
  }

  if (reason === "forbidden") {
    return {
      canRetry: false,
      message: "You do not have permission to save this SQLtoERD session.",
      reason
    };
  }

  if (reason === "not_found") {
    return {
      canRetry: false,
      message:
        "This SQLtoERD session was deleted or cannot be found. Reload the session.",
      reason
    };
  }

  if (reason === "invalid_payload") {
    return {
      canRetry: true,
      message:
        "Current layout payload cannot be autosaved. Try moving a table again or reload the session.",
      reason
    };
  }

  return {
    canRetry: true,
    message:
      "Autosave stopped after a non-retryable API error. Retry once or reload the session.",
    reason
  };
}

export function getSqlErdSessionReloadFailureAction({
  fallbackToSampleOnFailure
}: {
  fallbackToSampleOnFailure: boolean;
}): SqlErdSessionReloadFailureAction {
  if (fallbackToSampleOnFailure) {
    return {
      kind: "fallback_to_sample",
      selectedSqlErdObject: { type: "none" },
      sessionLoadState: {
        label: "Sample",
        message:
          "Workspace session could not be loaded. Showing the built-in sample instead.",
        tone: "neutral"
      }
    };
  }

  return {
    kind: "preserve_current",
    sessionLoadState: {
      label: "Reload failed",
      message:
        "Workspace session could not be reloaded. Keep editing the current ERD or try reloading again.",
      tone: "error"
    }
  };
}

export function getSqlErdSessionLoadFailureState({
  hasLoadedSession
}: {
  hasLoadedSession: boolean;
}): SqlErdSessionLoadState {
  if (!hasLoadedSession) {
    return {
      label: "Load failed",
      message:
        "Workspace session could not be loaded. Try again or return to the session list.",
      tone: "error"
    };
  }

  return getSqlErdSessionReloadFailureAction({
    fallbackToSampleOnFailure: false
  }).sessionLoadState;
}

export function shouldApplySqlErdSessionLoadResult(
  requestId: number,
  currentRequestId: number
) {
  return requestId === currentRequestId;
}
