import * as dagre from "@dagrejs/dagre";
import { payloadTooLarge } from "../../common/api-error";
import {
  createSqlErdColumnId,
  createSqlErdConstraintId,
  createSqlErdForeignKeyRelationId,
  createSqlErdTableId
} from "./sql-erd-schema-identity";
import {
  SqlErdGeneratedSchema,
  SqlErdSchemaColumnSpec,
  SqlErdSchemaDefaultValueSpec,
  SqlErdSchemaDialect,
  SqlErdSchemaGenerationWarning,
  SqlErdSchemaSpecV1,
  SqlErdSchemaTableSpec,
  SqlErdSchemaTypeKind
} from "./sql-erd-schema-spec.types";
import { validateSqlErdSchemaSpec } from "./sql-erd-schema-spec.validation";
import { validateSqlErdLayoutJson } from "./sql-erd.validation";

const MAX_GENERATED_VALUE_BYTES = 1024 * 1024;
const MAX_SOURCE_SNAPSHOT_BYTES = 3 * 1024 * 1024;
const AUTO_LAYOUT_MARGIN = 80;
const AUTO_LAYOUT_NODE_GAP = 72;
const AUTO_LAYOUT_RANK_GAP = 144;

interface GeneratedColumn {
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  foreignKey: boolean;
  unique: boolean;
  defaultValue: string | null;
  comment: null;
  spec: SqlErdSchemaColumnSpec;
}

interface GeneratedConstraint {
  id: string;
  kind: "primary_key" | "unique";
  columnIds: string[];
  name: string | null;
}

interface GeneratedTable {
  id: string;
  name: string;
  schemaName: string | null;
  columns: GeneratedColumn[];
  constraints: GeneratedConstraint[];
  comment: null;
  spec: SqlErdSchemaTableSpec;
}

interface GeneratedRelation {
  id: string;
  kind: "foreign_key";
  fromTableId: string;
  fromColumnIds: string[];
  toTableId: string;
  toColumnIds: string[];
  constraintName: string | null;
}

export function generateSqlErdSchema(input: unknown): SqlErdGeneratedSchema {
  const spec = validateSqlErdSchemaSpec(input);
  const dialect = spec.requestedDialect ?? "postgresql";
  const warnings = createWarnings(spec, dialect);
  const { tables, relations } = createModel(spec, dialect);
  const modelJson = {
    version: 1,
    schema: {
      tables: tables.map(stripTableSpec),
      relations
    }
  };
  const sourceText = renderDdl(tables, relations, dialect);
  const layoutJson = createInitialLayout(tables, relations);

  validateSqlErdLayoutJson(layoutJson, modelJson);
  assertGeneratedSizes(sourceText, modelJson, layoutJson);

  return {
    dialect,
    layoutJson,
    modelJson,
    relationCount: relations.length,
    sourceText,
    tableCount: tables.length,
    title: spec.title,
    warnings
  };
}

function createModel(spec: SqlErdSchemaSpecV1, dialect: SqlErdSchemaDialect) {
  const relationSourceColumns = new Set(
    spec.relations.flatMap((relation) =>
      relation.fromColumnKeys.map(
        (columnKey) => `${relation.fromTableKey}\u0000${columnKey}`
      )
    )
  );
  const tables = spec.tables.map((tableSpec) => {
    const primaryColumnKeys = new Set(tableSpec.primaryKey?.columnKeys ?? []);
    const uniqueColumnKeys = new Set(
      tableSpec.uniqueConstraints
        .filter((constraint) => constraint.columnKeys.length === 1)
        .map((constraint) => constraint.columnKeys[0])
    );
    const columns = tableSpec.columns.map((columnSpec) => ({
      id: createSqlErdColumnId(
        tableSpec.schemaName,
        tableSpec.name,
        columnSpec.name
      ),
      name: columnSpec.name,
      dataType: renderDataType(columnSpec, dialect),
      nullable: columnSpec.nullable,
      primaryKey: primaryColumnKeys.has(columnSpec.key),
      foreignKey: relationSourceColumns.has(
        `${tableSpec.key}\u0000${columnSpec.key}`
      ),
      unique: uniqueColumnKeys.has(columnSpec.key),
      defaultValue: renderDefaultValue(columnSpec.defaultValue, dialect),
      comment: null,
      spec: columnSpec
    }));
    const columnsByKey = new Map(
      tableSpec.columns.map((column, index) => [column.key, columns[index]])
    );
    const constraints: GeneratedConstraint[] = [];

    if (tableSpec.primaryKey) {
      constraints.push({
        id: createSqlErdConstraintId(
          tableSpec.schemaName,
          tableSpec.name,
          "primary_key",
          tableSpec.primaryKey.columnKeys.map(
            (key) => columnsByKey.get(key)!.name
          )
        ),
        kind: "primary_key",
        columnIds: tableSpec.primaryKey.columnKeys.map(
          (key) => columnsByKey.get(key)!.id
        ),
        name: tableSpec.primaryKey.name
      });
    }

    for (const uniqueConstraint of tableSpec.uniqueConstraints) {
      constraints.push({
        id: createSqlErdConstraintId(
          tableSpec.schemaName,
          tableSpec.name,
          "unique",
          uniqueConstraint.columnKeys.map((key) => columnsByKey.get(key)!.name)
        ),
        kind: "unique",
        columnIds: uniqueConstraint.columnKeys.map(
          (key) => columnsByKey.get(key)!.id
        ),
        name: uniqueConstraint.name
      });
    }

    return {
      id: createSqlErdTableId(tableSpec.schemaName, tableSpec.name),
      name: tableSpec.name,
      schemaName: tableSpec.schemaName,
      columns,
      constraints,
      comment: null,
      spec: tableSpec
    } satisfies GeneratedTable;
  });
  const tablesByKey = new Map(
    spec.tables.map((tableSpec, index) => [tableSpec.key, tables[index]])
  );
  const relations = spec.relations.map((relationSpec) => {
    const fromTable = tablesByKey.get(relationSpec.fromTableKey)!;
    const toTable = tablesByKey.get(relationSpec.toTableKey)!;
    const fromColumnsByKey = new Map(
      fromTable.spec.columns.map((column, index) => [
        column.key,
        fromTable.columns[index]
      ])
    );
    const toColumnsByKey = new Map(
      toTable.spec.columns.map((column, index) => [
        column.key,
        toTable.columns[index]
      ])
    );
    const fromColumns = relationSpec.fromColumnKeys.map(
      (key) => fromColumnsByKey.get(key)!
    );
    const toColumns = relationSpec.toColumnKeys.map(
      (key) => toColumnsByKey.get(key)!
    );

    return {
      id: createSqlErdForeignKeyRelationId({
        fromTable,
        fromColumnNames: fromColumns.map((column) => column.name),
        toTable,
        toColumnNames: toColumns.map((column) => column.name)
      }),
      kind: "foreign_key",
      fromTableId: fromTable.id,
      fromColumnIds: fromColumns.map((column) => column.id),
      toTableId: toTable.id,
      toColumnIds: toColumns.map((column) => column.id),
      constraintName: relationSpec.name
    } satisfies GeneratedRelation;
  });

  return { tables, relations };
}

function stripTableSpec(table: GeneratedTable) {
  return {
    id: table.id,
    name: table.name,
    schemaName: table.schemaName,
    columns: table.columns.map(({ spec: _spec, ...column }) => column),
    constraints: table.constraints,
    comment: table.comment
  };
}

function renderDdl(
  tables: GeneratedTable[],
  relations: GeneratedRelation[],
  dialect: SqlErdSchemaDialect
) {
  const relationsByTableId = new Map<string, GeneratedRelation[]>();
  for (const relation of relations) {
    const tableRelations = relationsByTableId.get(relation.fromTableId) ?? [];
    tableRelations.push(relation);
    relationsByTableId.set(relation.fromTableId, tableRelations);
  }
  const tablesById = new Map(tables.map((table) => [table.id, table]));

  return tables
    .map((table) => {
      const inlineAutoIncrementPrimaryKey = getInlineAutoIncrementPrimaryKey(
        table,
        dialect
      );
      const lines = [
        ...table.columns.map((column) =>
          renderColumn(column, dialect, column.id === inlineAutoIncrementPrimaryKey)
        ),
        ...table.constraints
          .filter(
            (constraint) =>
              constraint.kind !== "primary_key" ||
              inlineAutoIncrementPrimaryKey === null
          )
          .map((constraint) => renderConstraint(constraint, table, dialect)),
        ...(relationsByTableId.get(table.id) ?? []).map((relation) =>
          renderRelation(relation, tablesById, dialect)
        )
      ];

      return `CREATE TABLE ${quoteTable(table, dialect)} (\n${lines
        .map((line) => `  ${line}`)
        .join(",\n")}\n);`;
    })
    .join("\n\n");
}

function renderColumn(
  column: GeneratedColumn,
  dialect: SqlErdSchemaDialect,
  inlineAutoIncrementPrimaryKey: boolean
) {
  const parts = [quoteIdentifier(column.name, dialect), column.dataType];

  if (inlineAutoIncrementPrimaryKey) {
    parts.push("PRIMARY KEY AUTOINCREMENT");
  } else {
    if (!column.nullable) {
      parts.push("NOT NULL");
    }
    if (column.spec.autoIncrement && dialect === "mysql") {
      parts.push("AUTO_INCREMENT");
    }
  }
  if (column.defaultValue !== null) {
    parts.push(`DEFAULT ${column.defaultValue}`);
  }

  return parts.join(" ");
}

function renderConstraint(
  constraint: GeneratedConstraint,
  table: GeneratedTable,
  dialect: SqlErdSchemaDialect
) {
  const columnsById = new Map(table.columns.map((column) => [column.id, column]));
  const name = constraint.name
    ? `CONSTRAINT ${quoteIdentifier(constraint.name, dialect)} `
    : "";
  const keyword = constraint.kind === "primary_key" ? "PRIMARY KEY" : "UNIQUE";
  const columns = constraint.columnIds.map((columnId) =>
    quoteIdentifier(columnsById.get(columnId)!.name, dialect)
  );
  return `${name}${keyword} (${columns.join(", ")})`;
}

function renderRelation(
  relation: GeneratedRelation,
  tablesById: Map<string, GeneratedTable>,
  dialect: SqlErdSchemaDialect
) {
  const fromTable = tablesById.get(relation.fromTableId)!;
  const toTable = tablesById.get(relation.toTableId)!;
  const fromColumnsById = new Map(
    fromTable.columns.map((column) => [column.id, column])
  );
  const toColumnsById = new Map(
    toTable.columns.map((column) => [column.id, column])
  );
  const name = relation.constraintName
    ? `CONSTRAINT ${quoteIdentifier(relation.constraintName, dialect)} `
    : "";
  const fromColumns = relation.fromColumnIds.map((columnId) =>
    quoteIdentifier(fromColumnsById.get(columnId)!.name, dialect)
  );
  const toColumns = relation.toColumnIds.map((columnId) =>
    quoteIdentifier(toColumnsById.get(columnId)!.name, dialect)
  );

  return `${name}FOREIGN KEY (${fromColumns.join(", ")}) REFERENCES ${quoteTable(
    toTable,
    dialect
  )} (${toColumns.join(", ")})`;
}

function getInlineAutoIncrementPrimaryKey(
  table: GeneratedTable,
  dialect: SqlErdSchemaDialect
) {
  if (dialect !== "sqlite") {
    return null;
  }
  const autoIncrementColumn = table.columns.find(
    (column) => column.spec.autoIncrement
  );
  return autoIncrementColumn?.id ?? null;
}

function renderDataType(
  column: SqlErdSchemaColumnSpec,
  dialect: SqlErdSchemaDialect
): string {
  const { kind, length, precision, scale } = column.dataType;
  if (column.autoIncrement) {
    if (dialect === "postgresql") {
      return kind === "smallint"
        ? "SMALLSERIAL"
        : kind === "integer"
          ? "SERIAL"
          : "BIGSERIAL";
    }
    if (dialect === "sqlite") {
      return "INTEGER";
    }
  }

  const common: Partial<Record<SqlErdSchemaTypeKind, string>> = {
    bigint: "BIGINT",
    boolean: "BOOLEAN",
    char: `CHAR(${length})`,
    date: "DATE",
    decimal: `DECIMAL(${precision}, ${scale})`,
    integer: dialect === "mysql" ? "INT" : "INTEGER",
    real: "REAL",
    smallint: "SMALLINT",
    text: "TEXT",
    time: "TIME",
    timestamp: "TIMESTAMP",
    varchar: `VARCHAR(${length})`
  };
  if (common[kind]) {
    return common[kind]!;
  }

  switch (kind) {
    case "binary":
      return dialect === "postgresql"
        ? "BYTEA"
        : dialect === "mysql"
          ? `BINARY(${length})`
          : "BLOB";
    case "double":
      return dialect === "postgresql" ? "DOUBLE PRECISION" : "DOUBLE";
    case "json":
      return dialect === "postgresql"
        ? "JSONB"
        : dialect === "mysql"
          ? "JSON"
          : "TEXT";
    case "timestamp_tz":
      return dialect === "postgresql" ? "TIMESTAMPTZ" : "TIMESTAMP";
    case "uuid":
      return dialect === "postgresql"
        ? "UUID"
        : dialect === "mysql"
          ? "CHAR(36)"
          : "TEXT";
  }

  throw new Error(`Unsupported schema data type: ${kind}`);
}

function renderDefaultValue(
  value: SqlErdSchemaDefaultValueSpec | null,
  dialect: SqlErdSchemaDialect
) {
  if (!value) {
    return null;
  }
  if (value.kind === "current_date") {
    return "CURRENT_DATE";
  }
  if (value.kind === "current_timestamp") {
    return "CURRENT_TIMESTAMP";
  }
  if (value.value === null) {
    return "NULL";
  }
  if (typeof value.value === "string") {
    return `'${value.value.replaceAll("'", "''")}'`;
  }
  if (typeof value.value === "boolean") {
    return dialect === "sqlite" ? (value.value ? "1" : "0") : value.value ? "TRUE" : "FALSE";
  }
  return String(value.value);
}

function quoteTable(table: GeneratedTable, dialect: SqlErdSchemaDialect) {
  return table.schemaName
    ? `${quoteIdentifier(table.schemaName, dialect)}.${quoteIdentifier(
        table.name,
        dialect
      )}`
    : quoteIdentifier(table.name, dialect);
}

function quoteIdentifier(value: string, dialect: SqlErdSchemaDialect) {
  return dialect === "mysql"
    ? `\`${value.replaceAll("`", "``")}\``
    : `"${value.replaceAll('"', '""')}"`;
}

function createInitialLayout(
  tables: GeneratedTable[],
  relations: GeneratedRelation[]
) {
  const sizesByTableId = new Map(
    tables.map((table) => [table.id, getTableCardSize(table)])
  );
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    marginx: AUTO_LAYOUT_MARGIN,
    marginy: AUTO_LAYOUT_MARGIN,
    nodesep: AUTO_LAYOUT_NODE_GAP,
    rankdir: "LR",
    ranksep: AUTO_LAYOUT_RANK_GAP,
    ranker: "network-simplex"
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const table of [...tables].sort((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    graph.setNode(table.id, sizesByTableId.get(table.id)!);
  }
  for (const relation of [...relations].sort((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    graph.setEdge({
      name: relation.id,
      v: relation.toTableId,
      w: relation.fromTableId
    });
  }
  dagre.layout(graph);

  return {
    version: 1,
    tableLayouts: tables.map((table) => {
      const size = sizesByTableId.get(table.id)!;
      const node = graph.node(table.id);
      return {
        tableId: table.id,
        x: roundCoordinate(node.x - size.width / 2),
        y: roundCoordinate(node.y - size.height / 2),
        width: size.width
      };
    }),
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

function getTableCardSize(table: GeneratedTable) {
  const badgeColumnWidth = Math.max(
    72,
    ...table.columns.map((column) => {
      let count = 0;
      count += column.primaryKey ? 1 : 0;
      count += column.foreignKey ? 1 : 0;
      count += column.unique ? 1 : 0;
      count += !column.nullable && !column.primaryKey ? 1 : 0;
      return count === 0 ? 72 : count * 30 + Math.max(0, count - 1) * 4;
    })
  );
  const displayName = table.schemaName
    ? `${table.schemaName}.${table.name}`
    : table.name;
  const titleWidth = displayName.length * 13 + 24 * 2;
  const rowContentWidth = Math.max(
    0,
    ...table.columns.map(
      (column) =>
        badgeColumnWidth +
        28 * 2 +
        column.name.length * 10.5 +
        column.dataType.length * 9.5 +
        16
    )
  );
  return {
    height: 54 + table.columns.length * 42 + 2,
    width: Math.ceil(Math.max(260, titleWidth, rowContentWidth + 24 * 2))
  };
}

function roundCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function createWarnings(
  spec: SqlErdSchemaSpecV1,
  dialect: SqlErdSchemaDialect
): SqlErdSchemaGenerationWarning[] {
  const warnings: SqlErdSchemaGenerationWarning[] = spec.unsupportedFeatures.map(
    (feature) => ({
      code: "UNSUPPORTED_FEATURE",
      feature,
      message: `The requested ${feature} feature is not included in the generated ERD.`
    })
  );

  if (dialect !== "postgresql") {
    for (let tableIndex = 0; tableIndex < spec.tables.length; tableIndex += 1) {
      const table = spec.tables[tableIndex];
      for (let columnIndex = 0; columnIndex < table.columns.length; columnIndex += 1) {
        if (table.columns[columnIndex].dataType.kind === "timestamp_tz") {
          warnings.push({
            code: "PORTABILITY_DOWNGRADE",
            message: `timestamp_tz is rendered as TIMESTAMP for ${dialect}.`,
            path: `tables[${tableIndex}].columns[${columnIndex}].dataType`
          });
        }
      }
    }
  }

  return warnings;
}

function assertGeneratedSizes(
  sourceText: string,
  modelJson: object,
  layoutJson: object
) {
  const sourceBytes = Buffer.byteLength(sourceText, "utf8");
  const modelBytes = Buffer.byteLength(JSON.stringify(modelJson), "utf8");
  const layoutBytes = Buffer.byteLength(JSON.stringify(layoutJson), "utf8");
  if (sourceBytes > MAX_GENERATED_VALUE_BYTES) {
    throw payloadTooLarge("generated sourceText is too large");
  }
  if (modelBytes > MAX_GENERATED_VALUE_BYTES) {
    throw payloadTooLarge("generated modelJson is too large");
  }
  if (layoutBytes > MAX_GENERATED_VALUE_BYTES) {
    throw payloadTooLarge("generated layoutJson is too large");
  }
  if (sourceBytes + modelBytes + layoutBytes > MAX_SOURCE_SNAPSHOT_BYTES) {
    throw payloadTooLarge("generated source snapshot is too large");
  }
}
