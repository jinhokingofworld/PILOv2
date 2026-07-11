import type { SqlErdSessionLoadState } from "@/features/sql-erd/utils/session-state";
import type { SqlErdParseState } from "@/features/sql-erd/utils/sql-edit-state";

export type SqlErdGenerateErrorCode =
  | "EMPTY_SOURCE"
  | "UNSUPPORTED_DIALECT"
  | "PARSE_FAILED"
  | "NO_CREATE_TABLE"
  | "SOURCE_TOO_LARGE";

export function getSqlErdGenerateErrorMessage(
  errorCode: SqlErdGenerateErrorCode | string
) {
  if (errorCode === "EMPTY_SOURCE") {
    return "Enter at least one CREATE TABLE statement to generate an ERD.";
  }

  if (errorCode === "UNSUPPORTED_DIALECT") {
    return "This SQL dialect is not supported yet. Choose PostgreSQL or MySQL.";
  }

  if (errorCode === "NO_CREATE_TABLE") {
    return "SQLtoERD MVP supports CREATE TABLE DDL. Add at least one CREATE TABLE statement.";
  }

  if (errorCode === "SOURCE_TOO_LARGE") {
    return "SQL source is too large. Keep it at or below 1 MiB and try again.";
  }

  return "SQL DDL could not be parsed. Check the CREATE TABLE syntax and try again.";
}

export function getSqlErdSignInRequiredState(): SqlErdSessionLoadState {
  return {
    label: "Sign in",
    message: "Sign in to save this SQLtoERD session in the Workspace.",
    tone: "error"
  };
}

export function getSqlErdWorkspaceSaveErrorState(): SqlErdSessionLoadState {
  return {
    label: "Save error",
    message:
      "Workspace session could not be autosaved. Check your connection; SQL changes will retry automatically.",
    tone: "error"
  };
}

export type SqlErdSourceAutosaveState = "idle" | "pending" | "saving";

export function getSqlErdSourceStatus({
  fallbackState,
  isDraftDirty,
  parse,
  sourceAutosaveState
}: {
  fallbackState: SqlErdSessionLoadState;
  isDraftDirty: boolean;
  parse: SqlErdParseState;
  sourceAutosaveState: SqlErdSourceAutosaveState;
}): SqlErdSessionLoadState {
  if (parse.status === "error") {
    return {
      label: "Parse error",
      message: getSqlErdGenerateErrorMessage(
        parse.error?.code ?? "PARSE_FAILED"
      ),
      tone: "error"
    };
  }

  if (parse.status === "parsing") {
    return {
      label: "Parsing",
      message: "Parsing SQL DDL",
      tone: "neutral"
    };
  }

  if (isDraftDirty) {
    return {
      label: "Waiting",
      message: "Waiting to parse SQL changes",
      tone: "neutral"
    };
  }

  if (sourceAutosaveState === "pending") {
    return {
      label: "Unsaved",
      message: "Parsed SQL changes will autosave",
      tone: "neutral"
    };
  }

  if (sourceAutosaveState === "saving") {
    return {
      label: "Saving",
      message: "Autosaving parsed SQL changes",
      tone: "neutral"
    };
  }

  return fallbackState;
}
