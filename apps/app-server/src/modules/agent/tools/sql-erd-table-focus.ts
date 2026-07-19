import { badRequest } from "../../../common/api-error";

export { createSqlErdModelFingerprint } from "../../sql-erd/sql-erd-model-fingerprint";

const PROJECTION_MAX_CHARACTERS = 9_000;
const CATALOG_NAME_LIMITS = [64, 48, 32, 24, 16, 8] as const;
const OPTIONAL_TEXT_LIMIT = 120;
const COLUMN_NAME_LIMIT = 80;
const MAX_COLUMNS_PER_PROJECTED_TABLE = 12;

type SqlErdModelColumn = {
  name: string;
  primaryKey: boolean;
  foreignKey: boolean;
  comment: string | null;
};

type SqlErdModelTable = {
  id: string;
  name: string;
  schemaName: string | null;
  comment: string | null;
  columns: SqlErdModelColumn[];
};

type SqlErdModelRelation = {
  id: string;
  fromTableId: string;
  toTableId: string;
};

type ParsedSqlErdModel = {
  tables: SqlErdModelTable[];
  relations: SqlErdModelRelation[];
};

export type SqlErdAgentProjectedColumn = {
  name: string;
  primaryKey: boolean;
  foreignKey: boolean;
  comment?: string;
};

export type SqlErdAgentProjectedTable = {
  ref: string;
  name: string;
  schemaName?: string;
  comment?: string;
  columns?: SqlErdAgentProjectedColumn[];
};

export interface SqlErdAgentSchemaProjection {
  tables: SqlErdAgentProjectedTable[];
  edges: Array<[string, string]>;
  truncated: boolean;
}

export type SqlErdAgentTableFocusInput = {
  primaryTableRefs: string[];
  relatedTableRefs: string[];
};

export type ResolvedSqlErdAgentTableFocus = {
  primaryTableIds: string[];
  relatedTableIds: string[];
  relationIds: string[];
  tables: Array<{
    ref: string;
    id: string;
    name: string;
    role: "primary" | "related";
  }>;
};

export function buildSqlErdAgentSchemaProjection(
  modelJson: Record<string, unknown>,
  featureQuery: string
): SqlErdAgentSchemaProjection {
  const model = parseSqlErdModel(modelJson);
  const tableRefById = new Map(
    model.tables.map((table, index) => [table.id, `t${index + 1}`])
  );
  const edges = model.relations.flatMap((relation) => {
    const fromRef = tableRefById.get(relation.fromTableId);
    const toRef = tableRefById.get(relation.toTableId);
    return fromRef && toRef ? ([[fromRef, toRef]] as Array<[string, string]>) : [];
  });

  let nameLimit: number = CATALOG_NAME_LIMITS[0];
  let tables = createCatalogTables(model.tables, nameLimit);
  let projection: SqlErdAgentSchemaProjection = {
    tables,
    edges,
    truncated: model.tables.some(
      (table) => unicodeLength(table.name) > nameLimit
    )
  };

  for (const candidateLimit of CATALOG_NAME_LIMITS.slice(1)) {
    if (serializedLength(projection) <= PROJECTION_MAX_CHARACTERS) {
      break;
    }
    nameLimit = candidateLimit;
    tables = createCatalogTables(model.tables, nameLimit);
    projection = {
      tables,
      edges,
      truncated: model.tables.some(
        (table) => unicodeLength(table.name) > nameLimit
      )
    };
  }

  if (serializedLength(projection) > PROJECTION_MAX_CHARACTERS) {
    throw badRequest("SQLtoERD schema catalog exceeds Agent projection limit");
  }

  const queryTerms = normalizedQueryTerms(featureQuery);
  model.tables.forEach((table, tableIndex) => {
    const projectedTable = projection.tables[tableIndex];
    if (!projectedTable) return;

    projection.truncated =
      tryAddOptionalText(
        projection,
        projectedTable,
        "schemaName",
        table.schemaName,
        OPTIONAL_TEXT_LIMIT
      ) || projection.truncated;
    projection.truncated =
      tryAddOptionalText(
        projection,
        projectedTable,
        "comment",
        table.comment,
        OPTIONAL_TEXT_LIMIT
      ) || projection.truncated;

    const orderedColumns = [...table.columns].sort((left, right) => {
      return (
        columnPriority(right, queryTerms) - columnPriority(left, queryTerms)
      );
    });
    const candidates = orderedColumns.slice(0, MAX_COLUMNS_PER_PROJECTED_TABLE);
    const projectedColumns: SqlErdAgentProjectedColumn[] = [];

    for (const column of candidates) {
      const projectedColumn: SqlErdAgentProjectedColumn = {
        name: boundText(column.name, COLUMN_NAME_LIMIT),
        primaryKey: column.primaryKey,
        foreignKey: column.foreignKey
      };
      const boundedComment = boundNullableText(column.comment, OPTIONAL_TEXT_LIMIT);
      if (boundedComment) projectedColumn.comment = boundedComment;

      projectedColumns.push(projectedColumn);
      projectedTable.columns = projectedColumns;
      if (serializedLength(projection) > PROJECTION_MAX_CHARACTERS) {
        projectedColumns.pop();
        projection.truncated = true;
        if (projectedColumns.length === 0) delete projectedTable.columns;
        break;
      }
    }

    if (
      orderedColumns.length > projectedColumns.length ||
      candidates.some(
        (column, index) =>
          unicodeLength(column.name) > COLUMN_NAME_LIMIT ||
          (column.comment !== null &&
            column.comment !== projectedColumns[index]?.comment)
      )
    ) {
      projection.truncated = true;
    }
  });

  return projection;
}

export function resolveSqlErdAgentTableFocus(
  modelJson: Record<string, unknown>,
  input: SqlErdAgentTableFocusInput
): ResolvedSqlErdAgentTableFocus {
  const model = parseSqlErdModel(modelJson);
  const tableByRef = new Map(
    model.tables.map((table, index) => [`t${index + 1}`, table])
  );
  const primaryRefs = validateUniqueRefs(
    input.primaryTableRefs,
    "primary",
    true
  );
  const relatedRefs = validateUniqueRefs(
    input.relatedTableRefs,
    "related",
    false
  );
  const primaryRefSet = new Set(primaryRefs);
  const relatedRefSet = new Set(relatedRefs);

  for (const ref of relatedRefs) {
    if (primaryRefSet.has(ref)) {
      throw badRequest("related table reference overlaps primary table reference");
    }
  }
  for (const ref of [...primaryRefs, ...relatedRefs]) {
    if (!tableByRef.has(ref)) {
      throw badRequest(`unknown table reference: ${ref}`);
    }
  }

  const refByTableId = new Map(
    model.tables.map((table, index) => [table.id, `t${index + 1}`])
  );
  for (const relatedRef of relatedRefs) {
    const hasDirectPrimaryRelation = model.relations.some((relation) => {
      const fromRef = refByTableId.get(relation.fromTableId);
      const toRef = refByTableId.get(relation.toTableId);
      return (
        (fromRef === relatedRef && toRef && primaryRefSet.has(toRef)) ||
        (toRef === relatedRef && fromRef && primaryRefSet.has(fromRef))
      );
    });
    if (!hasDirectPrimaryRelation) {
      throw badRequest(
        `related table reference must have a direct primary relation: ${relatedRef}`
      );
    }
  }

  const selectedRefs = new Set([...primaryRefs, ...relatedRefs]);
  const relationIds = model.relations.flatMap((relation) => {
    const fromRef = refByTableId.get(relation.fromTableId);
    const toRef = refByTableId.get(relation.toTableId);
    return fromRef &&
      toRef &&
      selectedRefs.has(fromRef) &&
      selectedRefs.has(toRef)
      ? [relation.id]
      : [];
  });

  const toResolvedTable = (
    ref: string,
    role: "primary" | "related"
  ) => {
    const table = tableByRef.get(ref);
    if (!table) throw badRequest(`unknown table reference: ${ref}`);
    return { ref, id: table.id, name: table.name, role };
  };
  const primaryTables = primaryRefs.map((ref) =>
    toResolvedTable(ref, "primary")
  );
  const relatedTables = relatedRefs.map((ref) =>
    toResolvedTable(ref, "related")
  );

  return {
    primaryTableIds: primaryTables.map((table) => table.id),
    relatedTableIds: relatedTables.map((table) => table.id),
    relationIds,
    tables: [...primaryTables, ...relatedTables]
  };
}

function parseSqlErdModel(
  modelJson: Record<string, unknown>
): ParsedSqlErdModel {
  if (modelJson.version !== 1 || !isPlainObject(modelJson.schema)) {
    throw badRequest("SQLtoERD modelJson v1 is required");
  }
  const tablesValue = modelJson.schema.tables;
  const relationsValue = modelJson.schema.relations;
  if (!Array.isArray(tablesValue) || !Array.isArray(relationsValue)) {
    throw badRequest("SQLtoERD model tables and relations are required");
  }

  const tables = tablesValue.map((value, index) => {
    if (
      !isPlainObject(value) ||
      typeof value.id !== "string" ||
      typeof value.name !== "string" ||
      !Array.isArray(value.columns)
    ) {
      throw badRequest(`SQLtoERD model table is invalid at index ${index}`);
    }
    const columns = value.columns.map((columnValue, columnIndex) => {
      if (
        !isPlainObject(columnValue) ||
        typeof columnValue.name !== "string" ||
        typeof columnValue.primaryKey !== "boolean" ||
        typeof columnValue.foreignKey !== "boolean"
      ) {
        throw badRequest(
          `SQLtoERD model column is invalid at ${index}:${columnIndex}`
        );
      }
      return {
        name: columnValue.name,
        primaryKey: columnValue.primaryKey,
        foreignKey: columnValue.foreignKey,
        comment: readNullableString(columnValue.comment)
      };
    });
    return {
      id: value.id,
      name: value.name,
      schemaName: readNullableString(value.schemaName),
      comment: readNullableString(value.comment),
      columns
    };
  });
  const tableIds = new Set(tables.map((table) => table.id));
  const relations = relationsValue.flatMap((value, index) => {
    if (
      !isPlainObject(value) ||
      typeof value.id !== "string" ||
      typeof value.fromTableId !== "string" ||
      typeof value.toTableId !== "string"
    ) {
      throw badRequest(`SQLtoERD model relation is invalid at index ${index}`);
    }
    return tableIds.has(value.fromTableId) && tableIds.has(value.toTableId)
      ? [
          {
            id: value.id,
            fromTableId: value.fromTableId,
            toTableId: value.toTableId
          }
        ]
      : [];
  });

  return { tables, relations };
}

function createCatalogTables(
  tables: SqlErdModelTable[],
  nameLimit: number
): SqlErdAgentProjectedTable[] {
  return tables.map((table, index) => ({
    ref: `t${index + 1}`,
    name: boundText(table.name, nameLimit)
  }));
}

function tryAddOptionalText(
  projection: SqlErdAgentSchemaProjection,
  target: SqlErdAgentProjectedTable,
  field: "schemaName" | "comment",
  value: string | null,
  limit: number
): boolean {
  if (!value) return false;
  const bounded = boundText(value, limit);
  target[field] = bounded;
  if (serializedLength(projection) > PROJECTION_MAX_CHARACTERS) {
    delete target[field];
    return true;
  }
  return bounded !== value;
}

function columnPriority(
  column: SqlErdModelColumn,
  queryTerms: string[]
): number {
  let score = 0;
  if (column.primaryKey) score += 4;
  if (column.foreignKey) score += 3;
  const searchable = `${column.name} ${column.comment ?? ""}`.toLowerCase();
  if (queryTerms.some((term) => searchable.includes(term))) score += 2;
  return score;
}

function normalizedQueryTerms(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^\p{L}\p{N}_]+/u))].filter(
    (term) => term.length >= 2
  );
}

function validateUniqueRefs(
  value: string[],
  label: "primary" | "related",
  requireOne: boolean
): string[] {
  if (!Array.isArray(value) || (requireOne && value.length === 0)) {
    throw badRequest(`${label} table references are invalid`);
  }
  if (
    value.some(
      (ref) => typeof ref !== "string" || !/^t[1-9][0-9]*$/.test(ref)
    )
  ) {
    throw badRequest(`${label} table reference is invalid`);
  }
  if (new Set(value).size !== value.length) {
    throw badRequest(`${label} table references must be unique`);
  }
  return value;
}

function boundNullableText(value: string | null, limit: number): string | null {
  return value ? boundText(value, limit) : null;
}

function boundText(value: string, limit: number): string {
  return [...value.trim().replace(/\s+/g, " ")].slice(0, limit).join("");
}

function unicodeLength(value: string): number {
  return [...value].length;
}

function serializedLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
