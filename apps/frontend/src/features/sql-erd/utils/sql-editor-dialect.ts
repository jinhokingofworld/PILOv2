import {
  MySQL,
  PostgreSQL,
  SQLite,
  sql,
  type SQLDialect
} from "@codemirror/lang-sql";
import { Compartment, type Extension } from "@codemirror/state";

import type {
  SqltoerdDialect,
  SqltoerdResolvedDialect
} from "@/features/sql-erd/types";

export const DEFAULT_SQL_SOURCE_EDITOR_DIALECT: SqltoerdResolvedDialect =
  "postgresql";

export function resolveSqlSourceEditorDialect(
  selectedDialect: SqltoerdDialect,
  lastResolvedDialect: SqltoerdResolvedDialect | null
): SqltoerdResolvedDialect {
  if (selectedDialect !== "auto") {
    return selectedDialect;
  }

  return lastResolvedDialect ?? DEFAULT_SQL_SOURCE_EDITOR_DIALECT;
}

export function getSqlSourceEditorCodeMirrorDialect(
  dialect: SqltoerdResolvedDialect
): SQLDialect {
  if (dialect === "mysql") {
    return MySQL;
  }

  if (dialect === "sqlite") {
    return SQLite;
  }

  return PostgreSQL;
}

export function getSqlSourceEditorLanguageExtension(
  dialect: SqltoerdResolvedDialect
): Extension {
  return sql({
    dialect: getSqlSourceEditorCodeMirrorDialect(dialect)
  });
}

export function createSqlSourceEditorDialectReconfigureEffect(
  compartment: Compartment,
  dialect: SqltoerdResolvedDialect
) {
  return compartment.reconfigure(
    getSqlSourceEditorLanguageExtension(dialect)
  );
}
