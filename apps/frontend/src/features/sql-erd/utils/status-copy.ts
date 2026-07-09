import type { SqlErdSessionLoadState } from "@/features/sql-erd/utils/session-state";

export type SqlErdGenerateErrorCode =
  | "EMPTY_SOURCE"
  | "UNSUPPORTED_DIALECT"
  | "PARSE_FAILED"
  | "NO_CREATE_TABLE";

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
      "Workspace session could not be saved. Check your connection and try Generate again.",
    tone: "error"
  };
}
