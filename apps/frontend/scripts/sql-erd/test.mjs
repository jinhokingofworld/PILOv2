import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSqlErdFile(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const [apiSpec, types, commerceFixture, modelUtils, navigation] =
  await Promise.all([
    readSqlErdFile("../../../../docs/api/sqltoerd-api.md"),
    readSqlErdFile("../../src/features/sql-erd/types/index.ts"),
    readSqlErdFile("../../src/features/sql-erd/fixtures/commerce.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/model.ts"),
    readSqlErdFile("../../src/features/sql-erd/navigation.ts")
  ]);

for (const typeName of [
  "SqltoerdModelJsonV1",
  "ErdTable",
  "ErdColumn",
  "ErdRelation",
  "ErdConstraint",
  "SqltoerdLayoutJsonV1"
]) {
  assert.match(apiSpec, new RegExp(`type ${typeName}`));
  assert.match(types, new RegExp(`export type ${typeName}`));
}

assert.match(types, /export const SQLTOERD_MODEL_JSON_VERSION = 1/);
assert.match(types, /export const SQLTOERD_LAYOUT_JSON_VERSION = 1/);
assert.match(types, /export type SqltoerdSourceFormat = "sql"/);
assert.match(types, /export type SqltoerdDialect = "auto" \| "postgresql" \| "mysql"/);
assert.match(types, /kind: "foreign_key"/);
assert.match(types, /kind: "primary_key" \| "unique"/);

assert.match(commerceFixture, /commerceSqltoerdFixture/);
assert.match(commerceFixture, /title: "Commerce ERD"/);
assert.match(commerceFixture, /sourceFormat: "sql"/);
assert.match(commerceFixture, /dialect: "postgresql"/);
assert.match(commerceFixture, /version: SQLTOERD_MODEL_JSON_VERSION/);
assert.match(commerceFixture, /version: SQLTOERD_LAYOUT_JSON_VERSION/);

for (const tableId of [
  "table.users",
  "table.addresses",
  "table.products",
  "table.orders",
  "table.order_items",
  "table.reviews"
]) {
  assert.match(commerceFixture, new RegExp(tableId.replace(".", "\\.")));
}

assert.equal(
  commerceFixture.match(/createForeignKeyRelation\(\s*"relation\./g)?.length,
  7
);
assert.match(commerceFixture, /relation\.order_items\.order_id\.orders\.id/);
assert.match(commerceFixture, /relation\.reviews\.user_id\.users\.id/);

assert.match(modelUtils, /getSqltoerdModelCounts/);
assert.match(modelUtils, /createSqltoerdModelIndex/);
assert.match(modelUtils, /findErdTable/);
assert.match(modelUtils, /findErdColumn/);
assert.match(modelUtils, /getTableLayout/);
assert.match(modelUtils, /getRelationEndpoints/);
assert.match(modelUtils, /getTableDisplayName/);
assert.match(modelUtils, /relationsByTableId/);

assert.match(navigation, /SQLtoERD/);
assert.match(navigation, /href: "\/sql-erd"/);
