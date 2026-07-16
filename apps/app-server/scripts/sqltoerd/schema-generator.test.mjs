import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createSqlErdColumnId,
  createSqlErdConstraintId,
  createSqlErdForeignKeyRelationId,
  createSqlErdTableId
} = require("../../dist/modules/sql-erd/sql-erd-schema-identity.js");
const {
  validateSqlErdSchemaSpec
} = require("../../dist/modules/sql-erd/sql-erd-schema-spec.validation.js");
const {
  generateSqlErdSchema
} = require("../../dist/modules/sql-erd/sql-erd-schema-generator.js");

function createSchemaSpec(overrides = {}) {
  return {
    version: 1,
    title: "주문 관리",
    requestedDialect: "postgresql",
    tables: [
      {
        key: "users",
        name: "users",
        schemaName: null,
        columns: [
          {
            key: "id",
            name: "id",
            dataType: {
              kind: "bigint",
              length: null,
              precision: null,
              scale: null
            },
            nullable: false,
            autoIncrement: true,
            defaultValue: null
          },
          {
            key: "email",
            name: "email",
            dataType: {
              kind: "varchar",
              length: 255,
              precision: null,
              scale: null
            },
            nullable: false,
            autoIncrement: false,
            defaultValue: null
          }
        ],
        primaryKey: { name: null, columnKeys: ["id"] },
        uniqueConstraints: [{ name: null, columnKeys: ["email"] }]
      },
      {
        key: "orders",
        name: "orders",
        schemaName: null,
        columns: [
          {
            key: "id",
            name: "id",
            dataType: {
              kind: "bigint",
              length: null,
              precision: null,
              scale: null
            },
            nullable: false,
            autoIncrement: true,
            defaultValue: null
          },
          {
            key: "user_id",
            name: "user_id",
            dataType: {
              kind: "bigint",
              length: null,
              precision: null,
              scale: null
            },
            nullable: false,
            autoIncrement: false,
            defaultValue: null
          }
        ],
        primaryKey: { name: null, columnKeys: ["id"] },
        uniqueConstraints: []
      }
    ],
    relations: [
      {
        key: "orders_user",
        name: "fk_orders_user",
        fromTableKey: "orders",
        fromColumnKeys: ["user_id"],
        toTableKey: "users",
        toColumnKeys: ["id"]
      }
    ],
    unsupportedFeatures: [],
    ...overrides
  };
}

function assertApiError(callback, messagePattern) {
  assert.throws(callback, (error) => {
    assert.equal(error.getStatus(), 400);
    assert.match(error.getResponse().error.message, messagePattern);
    return true;
  });
}

const normalized = validateSqlErdSchemaSpec(createSchemaSpec());
assert.equal(normalized.version, 1);
assert.equal(normalized.tables.length, 2);
assert.equal(normalized.relations.length, 1);

assertApiError(
  () => validateSqlErdSchemaSpec({ ...createSchemaSpec(), workspaceId: "forbidden" }),
  /schemaSpec has unknown field: workspaceId/
);
assertApiError(
  () =>
    validateSqlErdSchemaSpec({
      ...createSchemaSpec(),
      relations: [
        {
          ...createSchemaSpec().relations[0],
          fromColumnKeys: ["missing"]
        }
      ]
    }),
  /fromColumnKeys references an unknown column key/
);
assertApiError(
  () =>
    validateSqlErdSchemaSpec({
      ...createSchemaSpec(),
      tables: [
        {
          ...createSchemaSpec().tables[0],
          primaryKey: { name: null, columnKeys: ["email"] }
        }
      ],
      relations: []
    }),
  /autoIncrement column must be the single primary key column/
);
assertApiError(
  () =>
    validateSqlErdSchemaSpec({
      ...createSchemaSpec(),
      tables: [
        {
          ...createSchemaSpec().tables[0],
          columns: [
            {
              ...createSchemaSpec().tables[0].columns[1],
              dataType: {
                kind: "varchar",
                length: 100,
                precision: 10,
                scale: 2
              }
            }
          ],
          primaryKey: null,
          uniqueConstraints: []
        }
      ],
      relations: []
    }),
  /precision and scale are only allowed for decimal/
);
assertApiError(
  () =>
    validateSqlErdSchemaSpec({
      ...createSchemaSpec(),
      tables: [
        {
          ...createSchemaSpec().tables[0],
          columns: [
            { ...createSchemaSpec().tables[0].columns[0], nullable: true },
            createSchemaSpec().tables[0].columns[1]
          ]
        }
      ],
      relations: []
    }),
  /primary key columns must not be nullable/
);
assertApiError(
  () =>
    validateSqlErdSchemaSpec({
      ...createSchemaSpec(),
      tables: [
        {
          ...createSchemaSpec().tables[0],
          columns: [
            {
              ...createSchemaSpec().tables[0].columns[0],
              autoIncrement: false,
              defaultValue: { kind: "literal", value: 1.5 }
            }
          ],
          primaryKey: null,
          uniqueConstraints: []
        }
      ],
      relations: []
    }),
  /integer literal must be an integer/
);
assertApiError(
  () => validateSqlErdSchemaSpec(undefined),
  /schemaSpec must be JSON serializable/
);
assertApiError(
  () =>
    generateSqlErdSchema({
      ...createSchemaSpec(),
      tables: [
        {
          ...createSchemaSpec().tables[0],
          key: "dotted",
          name: "a.b"
        },
        {
          ...createSchemaSpec().tables[1],
          key: "schema_qualified",
          name: "b",
          schemaName: "a"
        }
      ],
      relations: []
    }),
  /duplicate table id/
);

assert.equal(createSqlErdTableId(null, "users"), "table.users");
assert.equal(createSqlErdTableId("public", "users"), "table.public.users");
assert.equal(
  createSqlErdColumnId("public", "users", "id"),
  "column.public.users.id"
);
assert.equal(
  createSqlErdConstraintId("public", "users", "primary_key", ["id"]),
  "constraint.public.users.pk"
);
assert.equal(
  createSqlErdConstraintId(null, "users", "unique", ["email"]),
  "constraint.users.email.unique"
);
assert.equal(
  createSqlErdForeignKeyRelationId({
    fromTable: { schemaName: null, name: "orders" },
    fromColumnNames: ["user_id"],
    toTable: { schemaName: null, name: "users" },
    toColumnNames: ["id"]
  }),
  "relation.orders.user_id.users.id"
);

const compositeRelationId = createSqlErdForeignKeyRelationId({
  fromTable: { schemaName: "sales", name: "line_items" },
  fromColumnNames: ["order_id", "tenant_id"],
  toTable: { schemaName: "sales", name: "orders" },
  toColumnNames: ["id", "tenant_id"]
});
assert.match(compositeRelationId, /^relation\.v2\.[0-9a-f]{32}$/);
assert.equal(
  compositeRelationId,
  createSqlErdForeignKeyRelationId({
    fromTable: { schemaName: "sales", name: "line_items" },
    fromColumnNames: ["order_id", "tenant_id"],
    toTable: { schemaName: "sales", name: "orders" },
    toColumnNames: ["id", "tenant_id"]
  })
);

const postgresql = generateSqlErdSchema(createSchemaSpec());
assert.equal(postgresql.dialect, "postgresql");
assert.equal(postgresql.title, "주문 관리");
assert.equal(postgresql.tableCount, 2);
assert.equal(postgresql.relationCount, 1);
assert.match(postgresql.sourceText, /CREATE TABLE "users"/);
assert.match(postgresql.sourceText, /"id" BIGSERIAL NOT NULL/);
assert.match(postgresql.sourceText, /UNIQUE \("email"\)/);
assert.match(
  postgresql.sourceText,
  /CONSTRAINT "fk_orders_user" FOREIGN KEY \("user_id"\) REFERENCES "users" \("id"\)/
);
assert.equal(
  postgresql.sourceText,
  `CREATE TABLE "users" (
  "id" BIGSERIAL NOT NULL,
  "email" VARCHAR(255) NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("email")
);

CREATE TABLE "orders" (
  "id" BIGSERIAL NOT NULL,
  "user_id" BIGINT NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_orders_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id")
);`
);
assert.deepEqual(postgresql.modelJson.schema.tables.map((table) => table.id), [
  "table.users",
  "table.orders"
]);
assert.equal(
  postgresql.modelJson.schema.tables[1].columns[1].foreignKey,
  true
);
assert.deepEqual(postgresql.modelJson.schema.relations[0], {
  id: "relation.orders.user_id.users.id",
  kind: "foreign_key",
  fromTableId: "table.orders",
  fromColumnIds: ["column.orders.user_id"],
  toTableId: "table.users",
  toColumnIds: ["column.users.id"],
  constraintName: "fk_orders_user"
});
assert.equal(postgresql.layoutJson.version, 1);
assert.deepEqual(
  postgresql.layoutJson.tableLayouts.map((layout) => layout.tableId),
  ["table.users", "table.orders"]
);
assert.deepEqual(postgresql.layoutJson.tableLayouts, [
  { tableId: "table.users", x: 80, y: 80, width: 359 },
  { tableId: "table.orders", x: 583, y: 80, width: 323 }
]);
assert.ok(
  postgresql.layoutJson.tableLayouts.every(
    (layout) =>
      Number.isFinite(layout.x) &&
      Number.isFinite(layout.y) &&
      Number.isFinite(layout.width)
  )
);
assert.deepEqual(postgresql, generateSqlErdSchema(createSchemaSpec()));

const mysql = generateSqlErdSchema({
  ...createSchemaSpec(),
  requestedDialect: "mysql"
});
assert.match(mysql.sourceText, /CREATE TABLE `users`/);
assert.match(mysql.sourceText, /`id` BIGINT NOT NULL AUTO_INCREMENT/);
assert.match(mysql.sourceText, /PRIMARY KEY \(`id`\)/);
assert.equal(
  mysql.sourceText,
  `CREATE TABLE \`users\` (
  \`id\` BIGINT NOT NULL AUTO_INCREMENT,
  \`email\` VARCHAR(255) NOT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE (\`email\`)
);

CREATE TABLE \`orders\` (
  \`id\` BIGINT NOT NULL AUTO_INCREMENT,
  \`user_id\` BIGINT NOT NULL,
  PRIMARY KEY (\`id\`),
  CONSTRAINT \`fk_orders_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`)
);`
);

const sqlite = generateSqlErdSchema({
  ...createSchemaSpec(),
  requestedDialect: "sqlite"
});
assert.match(sqlite.sourceText, /CREATE TABLE "users"/);
assert.match(sqlite.sourceText, /"id" INTEGER PRIMARY KEY AUTOINCREMENT/);
assert.doesNotMatch(sqlite.sourceText, /PRIMARY KEY \("id"\)/);
assert.equal(
  sqlite.sourceText,
  `CREATE TABLE "users" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "email" VARCHAR(255) NOT NULL,
  UNIQUE ("email")
);

CREATE TABLE "orders" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "user_id" BIGINT NOT NULL,
  CONSTRAINT "fk_orders_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id")
);`
);

const portability = generateSqlErdSchema({
  ...createSchemaSpec(),
  requestedDialect: "mysql",
  unsupportedFeatures: ["views"],
  tables: [
    {
      ...createSchemaSpec().tables[0],
      columns: [
        ...createSchemaSpec().tables[0].columns,
        {
          key: "published_at",
          name: "published_at",
          dataType: {
            kind: "timestamp_tz",
            length: null,
            precision: null,
            scale: null
          },
          nullable: true,
          autoIncrement: false,
          defaultValue: { kind: "current_timestamp", value: null }
        }
      ]
    }
  ],
  relations: []
});
assert.match(portability.sourceText, /`published_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP/);
assert.deepEqual(
  portability.warnings.map((warning) => warning.code),
  ["UNSUPPORTED_FEATURE", "PORTABILITY_DOWNGRADE"]
);

const apiContract = await readFile(
  new URL("../../../../docs/api/sqltoerd-api.md", import.meta.url),
  "utf8"
);
assert.match(apiContract, /SqlErdSchemaSpecV1/);
assert.match(apiContract, /48 KiB/);
assert.match(apiContract, /sql_erd_agent_session_creations/);
assert.match(apiContract, /활성 source lock이 하나라도 있으면 교체를 거부/);
assert.match(apiContract, /server-side DDL·modelJson·layoutJson 생성/);

console.log("SQLtoERD schemaSpec validation and identity tests passed.");
