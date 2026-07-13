import type {
  ErdColumn,
  ErdTable,
  SqltoerdModelJsonV1
} from "@/features/sql-erd/types";

const MAX_SQLTOERD_RELATION_ID_LENGTH = 256;
const FNV64_MASK = (1n << 64n) - 1n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n;

export function createSqltoerdForeignKeyRelationId(input: {
  forceHashed?: boolean;
  fromColumns: readonly ErdColumn[];
  fromTable: ErdTable;
  toColumns: readonly ErdColumn[];
  toTable: ErdTable;
}) {
  const legacyId = [
    "relation",
    getTableIdPart(input.fromTable),
    input.fromColumns.map((column) => column.name).join("_"),
    getTableIdPart(input.toTable),
    input.toColumns.map((column) => column.name).join("_")
  ].join(".");

  if (!input.forceHashed && isSafeLegacyRelationId(input, legacyId)) {
    return legacyId;
  }

  return `relation.v2.${hashRelationIdentity(input)}`;
}

export function normalizeSqltoerdForeignKeyRelationIds(
  modelJson: SqltoerdModelJsonV1
) {
  const tablesById = new Map(
    modelJson.schema.tables.map((table) => [table.id, table])
  );

  for (const relation of modelJson.schema.relations) {
    const fromTable = tablesById.get(relation.fromTableId);
    const toTable = tablesById.get(relation.toTableId);

    if (!fromTable || !toTable) {
      continue;
    }

    const fromColumns = relation.fromColumnIds
      .map((columnId) => fromTable.columns.find((column) => column.id === columnId))
      .filter((column): column is ErdColumn => Boolean(column));
    const toColumns = relation.toColumnIds
      .map((columnId) => toTable.columns.find((column) => column.id === columnId))
      .filter((column): column is ErdColumn => Boolean(column));

    if (
      fromColumns.length !== relation.fromColumnIds.length ||
      toColumns.length !== relation.toColumnIds.length
    ) {
      continue;
    }

    relation.id = createSqltoerdForeignKeyRelationId({
      fromColumns,
      fromTable,
      toColumns,
      toTable
    });
  }
}

function isSafeLegacyRelationId(
  input: {
    fromColumns: readonly ErdColumn[];
    fromTable: ErdTable;
    toColumns: readonly ErdColumn[];
    toTable: ErdTable;
  },
  legacyId: string
) {
  return (
    legacyId.length <= MAX_SQLTOERD_RELATION_ID_LENGTH &&
    input.fromTable.schemaName === null &&
    input.toTable.schemaName === null &&
    input.fromColumns.length === 1 &&
    input.toColumns.length === 1 &&
    !input.fromTable.name.includes(".") &&
    !input.toTable.name.includes(".") &&
    !input.fromColumns[0].name.includes(".") &&
    !input.toColumns[0].name.includes(".")
  );
}

function hashRelationIdentity(input: {
  fromColumns: readonly ErdColumn[];
  fromTable: ErdTable;
  toColumns: readonly ErdColumn[];
  toTable: ErdTable;
}) {
  const identity = JSON.stringify([
    input.fromTable.schemaName,
    input.fromTable.name,
    input.fromColumns.map((column) => column.name),
    input.toTable.schemaName,
    input.toTable.name,
    input.toColumns.map((column) => column.name)
  ]);

  return `${hash64(identity, FNV64_OFFSET_BASIS)}${hash64(
    `pilo-sqltoerd:${identity}`,
    0x84222325cbf29ce4n
  )}`;
}

function hash64(value: string, seed: bigint) {
  let hash = seed;

  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }

  return hash.toString(16).padStart(16, "0");
}

function getTableIdPart(table: ErdTable) {
  return table.schemaName ? `${table.schemaName}.${table.name}` : table.name;
}
