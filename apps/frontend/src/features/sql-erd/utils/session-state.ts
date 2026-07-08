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
        message: "Workspace session could not be loaded",
        tone: "neutral"
      }
    };
  }

  return {
    kind: "preserve_current",
    sessionLoadState: {
      label: "Reload failed",
      message: "Workspace session could not be reloaded",
      tone: "error"
    }
  };
}

export function shouldApplySqlErdSessionLoadResult(
  requestId: number,
  currentRequestId: number
) {
  return requestId === currentRequestId;
}
