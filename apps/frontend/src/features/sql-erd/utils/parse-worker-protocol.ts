import type {
  SqltoerdDialect,
  SqltoerdLayoutJsonV1,
  SqltoerdModelJsonV1,
  SqltoerdResolvedDialect
} from "@/features/sql-erd/types";
import {
  parseSqlDdlToErdModel,
  type SqltoerdDdlParseError
} from "@/features/sql-erd/utils/ddl-parser";
import {
  createSqltoerdAutoLayoutTableSizes,
  createSqltoerdIncrementalLayout
} from "@/features/sql-erd/utils/auto-layout";
import type { SqltoerdSourceMap } from "@/features/sql-erd/utils/sql-source-map";

export type ParseWorkerRequest = {
  dialect: SqltoerdDialect;
  previousLayoutJson: SqltoerdLayoutJsonV1;
  requestSequence: number;
  sessionId: string;
  sourceMapModelJson?: SqltoerdModelJsonV1;
  sourceText: string;
};

export type ParseWorkerResponse =
  | {
      cancelled: false;
      layoutJson: SqltoerdLayoutJsonV1;
      modelJson: SqltoerdModelJsonV1;
      ok: true;
      requestSequence: number;
      resolvedDialect: SqltoerdResolvedDialect;
      sessionId: string;
      sourceMap: SqltoerdSourceMap;
    }
  | {
      cancelled: true;
      ok: false;
      requestSequence: number;
      sessionId: string;
    }
  | {
      cancelled: false;
      error: SqltoerdDdlParseError;
      ok: false;
      requestSequence: number;
      sessionId: string;
    };

export function executeSqlErdParseWorkerRequest(
  request: ParseWorkerRequest
): ParseWorkerResponse {
  const parseResult = parseSqlDdlToErdModel({
    dialect: request.dialect,
    sourceMapModelJson: request.sourceMapModelJson,
    sourceText: request.sourceText
  });

  if (!parseResult.ok) {
    return {
      cancelled: false,
      error: parseResult.error,
      ok: false,
      requestSequence: request.requestSequence,
      sessionId: request.sessionId
    };
  }

  return {
    cancelled: false,
    layoutJson: createSqltoerdIncrementalLayout({
      layoutJson: request.previousLayoutJson,
      modelJson: parseResult.modelJson,
      tableSizes: createSqltoerdAutoLayoutTableSizes(
        parseResult.modelJson,
        request.previousLayoutJson
      )
    }),
    modelJson: parseResult.modelJson,
    ok: true,
    requestSequence: request.requestSequence,
    resolvedDialect: parseResult.resolvedDialect,
    sessionId: request.sessionId,
    sourceMap: parseResult.sourceMap
  };
}

export function createSqlErdParseWorkerCancellation(
  request: Pick<ParseWorkerRequest, "requestSequence" | "sessionId">
): ParseWorkerResponse {
  return {
    cancelled: true,
    ok: false,
    requestSequence: request.requestSequence,
    sessionId: request.sessionId
  };
}
