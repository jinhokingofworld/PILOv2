import type { ErdColumn, ErdTable } from "@/features/sql-erd/types";

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
    !input.toTable.name.includes(".")
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
