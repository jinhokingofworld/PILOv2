const MAX_SQL_ERD_RELATION_ID_LENGTH = 256;
const FNV64_MASK = (1n << 64n) - 1n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n;

interface SqlErdSchemaIdentityTable {
  name: string;
  schemaName: string | null;
}

export function createSqlErdTableId(
  schemaName: string | null,
  tableName: string
) {
  return `table.${getTablePart(schemaName, tableName)}`;
}

export function createSqlErdColumnId(
  schemaName: string | null,
  tableName: string,
  columnName: string
) {
  return `column.${getTablePart(schemaName, tableName)}.${columnName}`;
}

export function createSqlErdConstraintId(
  schemaName: string | null,
  tableName: string,
  kind: "primary_key" | "unique",
  columnNames: readonly string[]
) {
  const tablePart = getTablePart(schemaName, tableName);
  return kind === "primary_key"
    ? `constraint.${tablePart}.pk`
    : `constraint.${tablePart}.${columnNames.join("_")}.unique`;
}

export function createSqlErdForeignKeyRelationId(input: {
  forceHashed?: boolean;
  fromColumnNames: readonly string[];
  fromTable: SqlErdSchemaIdentityTable;
  toColumnNames: readonly string[];
  toTable: SqlErdSchemaIdentityTable;
}) {
  const legacyId = [
    "relation",
    getTablePart(input.fromTable.schemaName, input.fromTable.name),
    input.fromColumnNames.join("_"),
    getTablePart(input.toTable.schemaName, input.toTable.name),
    input.toColumnNames.join("_")
  ].join(".");

  if (!input.forceHashed && isSafeLegacyRelationId(input, legacyId)) {
    return legacyId;
  }

  const identity = JSON.stringify([
    input.fromTable.schemaName,
    input.fromTable.name,
    input.fromColumnNames,
    input.toTable.schemaName,
    input.toTable.name,
    input.toColumnNames
  ]);

  return `relation.v2.${hash64(identity, FNV64_OFFSET_BASIS)}${hash64(
    `pilo-sqltoerd:${identity}`,
    0x84222325cbf29ce4n
  )}`;
}

function isSafeLegacyRelationId(
  input: {
    fromColumnNames: readonly string[];
    fromTable: SqlErdSchemaIdentityTable;
    toColumnNames: readonly string[];
    toTable: SqlErdSchemaIdentityTable;
  },
  legacyId: string
) {
  return (
    legacyId.length <= MAX_SQL_ERD_RELATION_ID_LENGTH &&
    input.fromTable.schemaName === null &&
    input.toTable.schemaName === null &&
    input.fromColumnNames.length === 1 &&
    input.toColumnNames.length === 1 &&
    !input.fromTable.name.includes(".") &&
    !input.toTable.name.includes(".") &&
    !input.fromColumnNames[0].includes(".") &&
    !input.toColumnNames[0].includes(".")
  );
}

function hash64(value: string, seed: bigint) {
  let hash = seed;

  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }

  return hash.toString(16).padStart(16, "0");
}

function getTablePart(schemaName: string | null, tableName: string) {
  return schemaName ? `${schemaName}.${tableName}` : tableName;
}
