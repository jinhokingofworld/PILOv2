import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

async function readSqlErdFile(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

async function compileSqlErdRuntimeModules() {
  const outputDir = await mkdtemp(
    fileURLToPath(new URL("../../.pilo-sqltoerd-runtime-", import.meta.url))
  );
  const modelOutputPath = join(outputDir, "model.mjs");
  const inspectorOutputPath = join(outputDir, "inspector.mjs");
  const ddlParserOutputPath = join(outputDir, "ddl-parser.mjs");
  const apiClientOutputPath = join(outputDir, "api-client.mjs");

  try {
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/model.ts",
      modelOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/inspector.ts",
      inspectorOutputPath,
      [[/from "\.\/model"/g, 'from "./model.mjs"']]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/ddl-parser.ts",
      ddlParserOutputPath,
      [[/from "@\/features\/sql-erd\/types"/g, 'from "./types-stub.mjs"']]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/api/client.ts",
      apiClientOutputPath
    );

    await writeFile(
      join(outputDir, "types-stub.mjs"),
      "export const SQLTOERD_MODEL_JSON_VERSION = 1;\n"
    );

    const [
      modelRuntime,
      inspectorRuntime,
      ddlParserRuntime,
      apiClientRuntime
    ] = await Promise.all([
      import(pathToFileHref(modelOutputPath)),
      import(pathToFileHref(inspectorOutputPath)),
      import(pathToFileHref(ddlParserOutputPath)),
      import(pathToFileHref(apiClientOutputPath))
    ]);

    return { apiClientRuntime, ddlParserRuntime, inspectorRuntime, modelRuntime };
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
}

async function compileTypeScriptModule(sourcePath, outputPath, replacements = []) {
  const sourceText = await readSqlErdFile(sourcePath);
  let { outputText } = ts.transpileModule(sourceText, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    },
    fileName: sourcePath
  });

  for (const [pattern, replacement] of replacements) {
    outputText = outputText.replace(pattern, replacement);
  }

  await writeFile(outputPath, outputText);
}

function pathToFileHref(path) {
  return new URL(`file:///${path.replaceAll("\\", "/")}`).href;
}

function createRuntimeTestColumn(id, name, options = {}) {
  return {
    id,
    name,
    dataType: options.dataType ?? "BIGINT",
    nullable: options.nullable ?? true,
    primaryKey: options.primaryKey ?? false,
    foreignKey: options.foreignKey ?? false,
    unique: options.unique ?? false,
    defaultValue: null,
    comment: null
  };
}

function createRuntimeTestModel() {
  const usersTable = {
    id: "table.users",
    name: "users",
    schemaName: null,
    columns: [
      createRuntimeTestColumn("id", "id", {
        nullable: false,
        primaryKey: true
      }),
      createRuntimeTestColumn("manager_id", "manager_id", {
        foreignKey: true
      })
    ],
    constraints: [
      {
        id: "constraint.users.pk",
        kind: "primary_key",
        columnIds: ["id"],
        name: null
      }
    ],
    comment: null
  };
  const ordersTable = {
    id: "table.orders",
    name: "orders",
    schemaName: null,
    columns: [
      createRuntimeTestColumn("id", "id", {
        nullable: false,
        primaryKey: true
      }),
      createRuntimeTestColumn("user_id", "user_id", {
        foreignKey: true
      })
    ],
    constraints: [
      {
        id: "constraint.orders.pk",
        kind: "primary_key",
        columnIds: ["id"],
        name: null
      }
    ],
    comment: null
  };

  return {
    version: 1,
    schema: {
      tables: [usersTable, ordersTable],
      relations: [
        {
          id: "relation.orders.user_id.users.id",
          kind: "foreign_key",
          fromTableId: "table.orders",
          fromColumnIds: ["user_id"],
          toTableId: "table.users",
          toColumnIds: ["id"],
          constraintName: null
        },
        {
          id: "relation.users.manager_id.users.id",
          kind: "foreign_key",
          fromTableId: "table.users",
          fromColumnIds: ["manager_id"],
          toTableId: "table.users",
          toColumnIds: ["id"],
          constraintName: null
        }
      ]
    }
  };
}

function createRuntimeTestSession(overrides = {}) {
  const modelJson = overrides.modelJson ?? createRuntimeTestModel();

  return {
    id: overrides.id ?? "session-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    title: overrides.title ?? "Runtime ERD",
    sourceFormat: overrides.sourceFormat ?? "sql",
    dialect: overrides.dialect ?? "postgresql",
    sourceText: overrides.sourceText ?? "CREATE TABLE users (id BIGINT);",
    modelJson,
    layoutJson:
      overrides.layoutJson ?? {
        version: 1,
        tableLayouts: [
          { tableId: "table.users", x: 10, y: 20, width: 240 },
          { tableId: "table.orders", x: 360, y: 20, width: 260 }
        ]
      },
    settingsJson: overrides.settingsJson ?? {},
    tableCount: overrides.tableCount ?? modelJson.schema.tables.length,
    relationCount:
      overrides.relationCount ?? modelJson.schema.relations.length,
    revision: overrides.revision ?? 3,
    createdBy:
      Object.hasOwn(overrides, "createdBy") ? overrides.createdBy : "user-1",
    updatedBy:
      Object.hasOwn(overrides, "updatedBy") ? overrides.updatedBy : "user-1",
    createdAt: overrides.createdAt ?? "2026-07-07T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-07T00:01:00.000Z",
    deletedAt: overrides.deletedAt ?? null
  };
}

const [
  apiSpec,
  types,
  commerceFixture,
  modelUtils,
  inspectorUtils,
  page,
  navigation,
  panel,
  canvasSurface,
  tableShape,
  relationShape,
  ddlParserUtils,
  apiClient,
  packageJson
] =
  await Promise.all([
    readSqlErdFile("../../../../docs/api/sqltoerd-api.md"),
    readSqlErdFile("../../src/features/sql-erd/types/index.ts"),
    readSqlErdFile("../../src/features/sql-erd/fixtures/commerce.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/model.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/inspector.ts"),
    readSqlErdFile("../../src/features/sql-erd/page.tsx"),
    readSqlErdFile("../../src/features/sql-erd/navigation.ts"),
    readSqlErdFile("../../src/features/sql-erd/components/sql-erd-panel.tsx"),
    readSqlErdFile("../../src/features/sql-erd/components/sql-erd-canvas.tsx"),
    readSqlErdFile("../../src/features/sql-erd/shapes/sql-erd-table-shape.tsx"),
    readSqlErdFile("../../src/features/sql-erd/shapes/sql-erd-relation-shape.tsx"),
    readSqlErdFile("../../src/features/sql-erd/utils/ddl-parser.ts"),
    readSqlErdFile("../../src/features/sql-erd/api/client.ts"),
    readSqlErdFile("../../package.json")
  ]);

const { apiClientRuntime, ddlParserRuntime, inspectorRuntime, modelRuntime } =
  await compileSqlErdRuntimeModules();
const runtimeModel = createRuntimeTestModel();
const runtimeModelIndex = modelRuntime.createSqltoerdModelIndex(runtimeModel);
const runtimeOrdersToUsersRelation =
  runtimeModel.schema.relations.find(
    (relation) => relation.id === "relation.orders.user_id.users.id"
  ) ?? null;
const runtimeUsersSelfRelation =
  runtimeModel.schema.relations.find(
    (relation) => relation.id === "relation.users.manager_id.users.id"
  ) ?? null;

assert.ok(runtimeOrdersToUsersRelation);
assert.ok(runtimeUsersSelfRelation);

const runtimeRelationEndpoints = modelRuntime.getRelationEndpoints(
  runtimeOrdersToUsersRelation,
  runtimeModelIndex
);

assert.equal(runtimeRelationEndpoints.from.table.id, "table.orders");
assert.deepEqual(
  runtimeRelationEndpoints.from.columns.map((column) => column.name),
  ["user_id"]
);
assert.equal(runtimeRelationEndpoints.to.table.id, "table.users");
assert.deepEqual(
  runtimeRelationEndpoints.to.columns.map((column) => column.name),
  ["id"]
);
assert.equal(
  runtimeModelIndex.relationsByTableId
    .get("table.users")
    .filter((relation) => relation.id === runtimeUsersSelfRelation.id).length,
  1
);

const ordersIdColumnView = inspectorRuntime.createSqlErdInspectorViewModel(
  { type: "column", tableId: "table.orders", columnId: "id" },
  runtimeModelIndex
);
const usersIdColumnView = inspectorRuntime.createSqlErdInspectorViewModel(
  { type: "column", tableId: "table.users", columnId: "id" },
  runtimeModelIndex
);
const usersTableView = inspectorRuntime.createSqlErdInspectorViewModel(
  { type: "table", tableId: "table.users" },
  runtimeModelIndex
);

assert.equal(ordersIdColumnView.type, "column");
assert.deepEqual(
  ordersIdColumnView.relations.map((relation) => relation.id),
  []
);
assert.equal(usersIdColumnView.type, "column");
assert.deepEqual(
  usersIdColumnView.relations.map((relation) => relation.id),
  [
    "relation.orders.user_id.users.id",
    "relation.users.manager_id.users.id"
  ]
);
assert.equal(usersTableView.type, "table");
assert.equal(
  usersTableView.relations.filter(
    (relation) => relation.id === runtimeUsersSelfRelation.id
  ).length,
  1
);

const sqlErdApiRequests = [];
const runtimeSession = createRuntimeTestSession({
  createdBy: null,
  updatedBy: null
});
const sqlErdApiClient = apiClientRuntime.createSqlErdApiClient({
  accessToken: "token-1",
  baseUrl: "https://api.example.test/api/v1/",
  fetcher: async (url, init) => {
    sqlErdApiRequests.push({ init, url });

    return new Response(
      JSON.stringify({
        success: true,
        data: runtimeSession
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200
      }
    );
  }
});

const restoredSession = await sqlErdApiClient.getActiveSession("workspace 1");

assert.deepEqual(restoredSession, runtimeSession);
assert.equal(restoredSession.createdBy, null);
assert.equal(restoredSession.updatedBy, null);
assert.equal(sqlErdApiRequests.length, 1);
assert.equal(
  sqlErdApiRequests[0].url,
  "https://api.example.test/api/v1/workspaces/workspace%201/sql-erd-session"
);
assert.equal(sqlErdApiRequests[0].init.method, "GET");
assert.equal(sqlErdApiRequests[0].init.credentials, "same-origin");
assert.equal(sqlErdApiRequests[0].init.headers.Authorization, "Bearer token-1");
assert.equal(sqlErdApiRequests[0].init.headers.Accept, "application/json");

const emptySqlErdApiClient = apiClientRuntime.createSqlErdApiClient({
  fetcher: async () =>
    new Response(JSON.stringify({ success: true, data: null }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    })
});

assert.equal(await emptySqlErdApiClient.getActiveSession("workspace-1"), null);

const createSqlErdSessionRequests = [];
const createSqlErdSessionClient = apiClientRuntime.createSqlErdApiClient({
  accessToken: "token-1",
  baseUrl: "https://api.example.test",
  fetcher: async (url, init) => {
    createSqlErdSessionRequests.push({ init, url });

    return new Response(
      JSON.stringify({
        success: true,
        data: createRuntimeTestSession({ revision: 1 })
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 201
      }
    );
  }
});
const createSessionPayload = {
  title: "Generated ERD",
  sourceFormat: "sql",
  dialect: "postgresql",
  sourceText: "CREATE TABLE users (id BIGINT PRIMARY KEY);",
  modelJson: createRuntimeTestModel(),
  layoutJson: {
    version: 1,
    tableLayouts: [{ tableId: "table.users", x: 80, y: 80, width: 240 }]
  },
  settingsJson: {}
};
const createdSqlErdSession = await createSqlErdSessionClient.createSession(
  "workspace 1",
  createSessionPayload
);

assert.equal(createdSqlErdSession.revision, 1);
assert.equal(createSqlErdSessionRequests.length, 1);
assert.equal(
  createSqlErdSessionRequests[0].url,
  "https://api.example.test/api/v1/workspaces/workspace%201/sql-erd-session"
);
assert.equal(createSqlErdSessionRequests[0].init.method, "POST");
assert.equal(
  createSqlErdSessionRequests[0].init.headers["Content-Type"],
  "application/json"
);
assert.deepEqual(
  JSON.parse(createSqlErdSessionRequests[0].init.body),
  createSessionPayload
);

const updateSqlErdSessionRequests = [];
const updateSqlErdSessionClient = apiClientRuntime.createSqlErdApiClient({
  fetcher: async (url, init) => {
    updateSqlErdSessionRequests.push({ init, url });

    return new Response(
      JSON.stringify({
        success: true,
        data: createRuntimeTestSession({ revision: 4 })
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200
      }
    );
  }
});
const updateSessionPayload = {
  baseRevision: 3,
  title: "Generated ERD",
  sourceFormat: "sql",
  dialect: "mysql",
  sourceText: "CREATE TABLE users (id BIGINT PRIMARY KEY);",
  modelJson: createRuntimeTestModel(),
  layoutJson: {
    version: 1,
    tableLayouts: [{ tableId: "table.users", x: 120, y: 160, width: 260 }]
  },
  settingsJson: {}
};
const updatedSqlErdSession = await updateSqlErdSessionClient.updateSession(
  "workspace 1",
  "session 1",
  updateSessionPayload
);

assert.equal(updatedSqlErdSession.revision, 4);
assert.equal(updateSqlErdSessionRequests.length, 1);
assert.equal(
  updateSqlErdSessionRequests[0].url,
  "http://localhost:4000/api/v1/workspaces/workspace%201/sql-erd-session/session%201"
);
assert.equal(updateSqlErdSessionRequests[0].init.method, "PATCH");
assert.deepEqual(
  JSON.parse(updateSqlErdSessionRequests[0].init.body),
  updateSessionPayload
);

const failingSqlErdApiClient = apiClientRuntime.createSqlErdApiClient({
  fetcher: async () =>
    new Response(
      JSON.stringify({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Unauthorized" }
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 401
      }
    )
});

await assert.rejects(
  () => failingSqlErdApiClient.getActiveSession("workspace-1"),
  /Unauthorized/
);

const postgresParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "postgresql",
  sourceText: `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE orders (
  id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  total_cents INTEGER NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE reviews (
  id BIGINT PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  rating SMALLINT NOT NULL,
  body TEXT
);`
});

assert.equal(postgresParseResult.ok, true);
assert.equal(postgresParseResult.modelJson.version, 1);
assert.deepEqual(
  postgresParseResult.modelJson.schema.tables.map((table) => table.id),
  ["table.users", "table.orders", "table.reviews"]
);

const postgresUsers = postgresParseResult.modelJson.schema.tables[0];
const postgresOrders = postgresParseResult.modelJson.schema.tables[1];
const postgresReviews = postgresParseResult.modelJson.schema.tables[2];

assert.equal(postgresUsers.columns[0].id, "column.users.id");
assert.equal(postgresUsers.columns[0].dataType, "BIGSERIAL");
assert.equal(postgresUsers.columns[0].primaryKey, true);
assert.equal(postgresUsers.columns[0].nullable, false);
assert.equal(postgresUsers.columns[1].dataType, "VARCHAR(255)");
assert.equal(postgresUsers.columns[1].unique, true);
assert.equal(postgresUsers.columns[1].nullable, false);
assert.equal(postgresUsers.columns[2].nullable, true);
assert.equal(postgresOrders.columns[3].dataType, "INTEGER");
assert.deepEqual(postgresOrders.constraints, [
  {
    id: "constraint.orders.pk",
    kind: "primary_key",
    columnIds: ["column.orders.id"],
    name: null
  }
]);
assert.equal(postgresOrders.columns[1].foreignKey, true);
assert.equal(postgresReviews.columns[1].foreignKey, true);
assert.deepEqual(
  postgresParseResult.modelJson.schema.relations.map((relation) => relation.id),
  [
    "relation.orders.user_id.users.id",
    "relation.reviews.user_id.users.id"
  ]
);
assert.equal(
  postgresParseResult.modelJson.schema.relations[0].constraintName,
  "fk_orders_user"
);

const postgresTypeParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "postgresql",
  sourceText: `CREATE TABLE metrics (
  amount NUMERIC(12,4) NOT NULL,
  ratio DECIMAL(10,2),
  placed_at TIMESTAMP WITH TIME ZONE NOT NULL
);`
});

assert.equal(postgresTypeParseResult.ok, true);
assert.equal(
  postgresTypeParseResult.modelJson.schema.tables[0].columns[0].dataType,
  "NUMERIC(12,4)"
);
assert.equal(
  postgresTypeParseResult.modelJson.schema.tables[0].columns[1].dataType,
  "DECIMAL(10,2)"
);
assert.equal(
  postgresTypeParseResult.modelJson.schema.tables[0].columns[2].dataType,
  "TIMESTAMP WITH TIME ZONE"
);

const mysqlParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "mysql",
  sourceText: `CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_orders_status (status),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);`
});

assert.equal(mysqlParseResult.ok, true);
assert.deepEqual(
  mysqlParseResult.modelJson.schema.tables.map((table) => table.id),
  ["table.users", "table.orders"]
);
assert.equal(mysqlParseResult.modelJson.schema.tables[0].columns[0].dataType, "BIGINT");
assert.equal(mysqlParseResult.modelJson.schema.tables[0].columns[0].primaryKey, true);
assert.equal(mysqlParseResult.modelJson.schema.tables[0].columns[1].unique, true);
assert.equal(mysqlParseResult.modelJson.schema.tables[1].columns[2].unique, true);
assert.deepEqual(mysqlParseResult.modelJson.schema.tables[1].constraints[1], {
  id: "constraint.orders.status.unique",
  kind: "unique",
  columnIds: ["column.orders.status"],
  name: "uq_orders_status"
});
assert.deepEqual(mysqlParseResult.modelJson.schema.relations, [
  {
    id: "relation.orders.user_id.users.id",
    kind: "foreign_key",
    fromTableId: "table.orders",
    fromColumnIds: ["column.orders.user_id"],
    toTableId: "table.users",
    toColumnIds: ["column.users.id"],
    constraintName: "fk_orders_user"
  }
]);

const mysqlTypeParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "mysql",
  sourceText: `CREATE TABLE metrics (
  amount DECIMAL(10,2) NOT NULL,
  id BIGINT UNSIGNED NOT NULL
);`
});

assert.equal(mysqlTypeParseResult.ok, true);
assert.equal(
  mysqlTypeParseResult.modelJson.schema.tables[0].columns[0].dataType,
  "DECIMAL(10,2)"
);
assert.equal(
  mysqlTypeParseResult.modelJson.schema.tables[0].columns[1].dataType,
  "BIGINT UNSIGNED"
);

const generatedLayout = modelRuntime.createSqltoerdLayoutForModel(
  mysqlParseResult.modelJson,
  {
    version: 1,
    tableLayouts: [{ tableId: "table.users", x: 44, y: 55, width: 288 }]
  }
);

assert.deepEqual(generatedLayout.tableLayouts[0], {
  tableId: "table.users",
  x: 44,
  y: 55,
  width: 288
});
assert.deepEqual(generatedLayout.tableLayouts[1], {
  tableId: "table.orders",
  x: 440,
  y: 80
});

const movedRuntimeLayout = modelRuntime.updateSqltoerdLayoutWithTablePositions(
  runtimeModel,
  {
    version: 1,
    tableLayouts: [
      { tableId: "table.users", x: 10, y: 20, width: 240 },
      { tableId: "table.orders", x: 360, y: 20, width: 260 }
    ]
  },
  [
    { tableId: "table.orders", x: 460, y: 180 },
    { tableId: "table.unknown", x: 999, y: 999 }
  ]
);

assert.deepEqual(movedRuntimeLayout.tableLayouts, [
  { tableId: "table.users", x: 10, y: 20, width: 240 },
  { tableId: "table.orders", x: 460, y: 180, width: 260 }
]);
assert.equal(
  modelRuntime.areSqltoerdLayoutsEqual(
    movedRuntimeLayout,
    movedRuntimeLayout
  ),
  true
);
assert.equal(
  modelRuntime.areSqltoerdLayoutsEqual(movedRuntimeLayout, {
    version: 1,
    tableLayouts: [
      { tableId: "table.users", x: 10, y: 20, width: 240 },
      { tableId: "table.orders", x: 461, y: 180, width: 260 }
    ]
  }),
  false
);

const autoDialectParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "auto",
  sourceText: `CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE
);`
});

assert.equal(autoDialectParseResult.ok, true);
assert.equal(autoDialectParseResult.modelJson.schema.tables[0].id, "table.users");
assert.equal(
  autoDialectParseResult.modelJson.schema.tables[0].columns[0].dataType,
  "BIGINT"
);

const invalidParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "postgresql",
  sourceText: "SELECT * FROM users"
});

assert.equal(invalidParseResult.ok, false);
assert.match(invalidParseResult.error.message, /CREATE TABLE/);

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
assert.match(types, /export type SqlErdSelection/);
assert.match(types, /type: "table"/);
assert.match(types, /type: "column"/);
assert.match(types, /type: "relation"/);
assert.match(types, /export type SqltoerdSessionPayload/);
assert.match(types, /createdBy: string \| null/);
assert.match(types, /updatedBy: string \| null/);

assert.match(commerceFixture, /commerceSqltoerdFixture/);
assert.match(commerceFixture, /title: "Commerce ERD"/);
assert.match(commerceFixture, /sourceFormat: "sql"/);
assert.match(commerceFixture, /dialect: "auto"/);
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
assert.match(modelUtils, /createSqltoerdLayoutForModel/);
assert.match(modelUtils, /updateSqltoerdLayoutWithTablePositions/);
assert.match(modelUtils, /areSqltoerdLayoutsEqual/);
assert.match(modelUtils, /relationsByTableId/);
assert.match(modelUtils, /columnsByTableId/);
assert.match(modelUtils, /relation\.fromTableId === relation\.toTableId/);
assert.doesNotMatch(modelUtils, /columnsById: Map<string, SqltoerdColumnRef>/);

assert.match(page, /sql-erd-full-bleed/);
assert.match(page, /-m-6/);
assert.match(page, /h-\[calc\(100vh-3\.5rem\)\]/);

assert.match(navigation, /SQLtoERD/);
assert.match(navigation, /href: "\/sql-erd"/);
assert.doesNotMatch(navigation, /Inspector/);
assert.doesNotMatch(navigation, /href: "\/sql-erd#inspector"/);

assert.match(panel, /SqlErdCanvas/);
assert.match(panel, /useAuthSession/);
assert.match(panel, /createSqlErdApiClient/);
assert.match(panel, /getActiveSession/);
assert.match(panel, /parseSqlDdlToErdModel/);
assert.match(panel, /handleGenerate/);
assert.match(panel, /createSession/);
assert.match(panel, /updateSession/);
assert.match(panel, /baseRevision: sqlErdViewSession\.revision/);
assert.match(panel, /AUTOSAVE_DEBOUNCE_MS = 2000/);
assert.match(panel, /pendingLayoutAutosaveJson/);
assert.match(panel, /layoutAutosaveRetryAttempt/);
assert.match(panel, /handleLayoutChange/);
assert.match(panel, /isLayoutAutosaveBlocked/);
assert.match(panel, /status === 409/);
assert.match(panel, /baseRevision: currentRevision/);
assert.match(panel, /layoutJson: requestLayoutJson/);
assert.match(panel, /getLayoutAutosaveDelayMs\(layoutAutosaveRetryAttempt\)/);
const layoutAutosaveNonConflictCatch =
  panel.match(
    /if \(isSqlErdApiConflictError\(error\)\) \{[\s\S]*?return;\n\s*\}\n\n([\s\S]*?)\n\s*\}\n\s*\}, getLayoutAutosaveDelayMs/
  )?.[1] ?? "";
assert.match(
  layoutAutosaveNonConflictCatch,
  /setLayoutAutosaveRetryAttempt\(\(currentAttempt\) => currentAttempt \+ 1\)/
);
assert.doesNotMatch(
  layoutAutosaveNonConflictCatch,
  /setPendingLayoutAutosaveJson/
);
assert.match(panel, /createSqltoerdLayoutForModel/);
assert.match(panel, /handleDialectChange/);
assert.match(panel, /onDialectChange=\{handleDialectChange\}/);
assert.match(panel, /DialectSelect/);
assert.match(panel, /value=\{dialect\}/);
assert.match(panel, /option value="auto"/);
assert.match(panel, /option value="postgresql"/);
assert.match(panel, /option value="mysql"/);
assert.match(panel, /disabled=\{isDialectSelectDisabled\}/);
assert.match(panel, /isDialectSelectDisabled/);
assert.match(panel, /onSourceTextChange/);
assert.match(panel, /isSourceTextReadOnly/);
assert.match(panel, /@codemirror\/lang-sql/);
assert.match(panel, /@codemirror\/state/);
assert.match(panel, /@codemirror\/view/);
assert.match(panel, /SqlSourceEditor/);
assert.match(panel, /sqlSourceEditorTheme/);
assert.match(panel, /EditorState\.readOnly\.of\(readOnly\)/);
assert.match(panel, /EditorView\.editable\.of\(!readOnly\)/);
assert.match(panel, /sql\(\)/);
assert.doesNotMatch(panel, /<textarea/);
assert.match(panel, /setSqlErdViewSession\(\(currentSession\) =>/);
assert.match(panel, /sessionLoadState/);
assert.match(panel, /setSqlErdViewSession/);
assert.match(panel, /selectedSqlErdObject/);
assert.match(panel, /setSelectedSqlErdObject/);
assert.match(panel, /createSqlErdInspectorViewModel/);
assert.match(panel, /SOURCE_PANEL_DEFAULT_WIDTH/);
assert.match(panel, /INSPECTOR_PANEL_DEFAULT_WIDTH/);
assert.match(panel, /MIN_CANVAS_WIDTH/);
assert.match(panel, /PANEL_RESIZE_HANDLE_WIDTH/);
assert.match(panel, /COLLAPSED_PANEL_BUTTON_WIDTH/);
assert.match(panel, /clampPanelWidth/);
assert.match(panel, /getResizablePanelMaxWidth/);
assert.match(panel, /panelContainerRef/);
assert.match(panel, /ResizeObserver/);
assert.match(panel, /sourcePanelMaxWidth/);
assert.match(panel, /inspectorPanelMaxWidth/);
assert.match(panel, /PanelResizeHandle/);
assert.match(panel, /Resize source panel/);
assert.match(panel, /Resize inspector panel/);
assert.match(panel, /role="separator"/);
assert.match(panel, /aria-orientation="vertical"/);
assert.match(panel, /aria-valuemin=\{minWidth\}/);
assert.match(panel, /aria-valuemax=\{maxWidth\}/);
assert.match(panel, /aria-valuenow=\{width\}/);
assert.match(panel, /onPointerDown/);
assert.match(panel, /sourcePanelWidth/);
assert.match(panel, /inspectorPanelWidth/);
assert.match(panel, /emptyState=\{\{/);
assert.match(panel, /title: sqlErdViewSession\.title/);
assert.match(panel, /const inspectorSubtitle = getInspectorSubtitle\(viewModel\)/);
assert.match(panel, /inspectorSubtitle \?/);
assert.doesNotMatch(panel, /viewModel\.title\}.*table/i);
assert.doesNotMatch(panel, /min-h-\[calc\(100vh-8\.5rem\)\]/);
assert.doesNotMatch(panel, /rounded-lg border bg-background shadow-sm/);
assert.doesNotMatch(panel, /bg-background\/95 px-4 backdrop-blur/);
assert.match(panel, /상세 정보/);
assert.match(panel, /선택 정보/);
assert.match(panel, /컬럼 정보/);
assert.match(panel, /테이블 정보/);
assert.match(panel, /관계 정보/);
assert.match(panel, /연결 관계/);
assert.match(panel, /text-xl font-semibold/);
assert.match(panel, /text-lg/);
assert.match(panel, /text-base/);
assert.doesNotMatch(panel, />Inspector</);
assert.match(panel, /features\/sql-erd\/utils\/inspector/);
assert.match(panel, /sourceText=\{sqlErdViewSession\.sourceText\}/);
assert.match(panel, /modelJson=\{sqlErdViewSession\.modelJson\}/);
assert.match(panel, /layoutJson=\{sqlErdViewSession\.layoutJson\}/);
assert.match(panel, /label=\{sessionLoadState\.label\}/);
assert.doesNotMatch(panel, /PreviewTableCard/);

assert.match(inspectorUtils, /createSqlErdInspectorViewModel/);
assert.match(inspectorUtils, /isColumnConnectedToRelation/);
assert.match(inspectorUtils, /relation\.fromTableId === tableId/);
assert.match(inspectorUtils, /relation\.toTableId === tableId/);

assert.match(canvasSurface, /TldrawSurface/);
assert.match(canvasSurface, /commerceSqltoerdFixture/);
assert.match(canvasSurface, /SqlErdCanvasShapeSync/);
assert.match(canvasSurface, /areSqlErdCanvasShapesApplied/);
assert.match(canvasSurface, /createSqltoerdTableShapes/);
assert.match(canvasSurface, /createSqltoerdRelationShapes/);
assert.match(canvasSurface, /createSqltoerdCanvasShapes/);
assert.match(canvasSurface, /SqlErdRelationLayoutSync/);
assert.match(canvasSurface, /syncSqlErdRelationShapes/);
assert.match(canvasSurface, /editor\.store\.listen/);
assert.match(canvasSurface, /editor\.run/);
assert.match(canvasSurface, /editor\.updateShapes/);
assert.match(canvasSurface, /history: "ignore"/);
assert.match(canvasSurface, /SqlErdSelectionSync/);
assert.match(canvasSurface, /SqlErdSelectedColumnSync/);
assert.match(canvasSurface, /SqlErdLayoutSync/);
assert.match(canvasSurface, /onLayoutChange/);
assert.match(canvasSurface, /updateSqltoerdLayoutWithTablePositions/);
assert.match(canvasSurface, /onSelectionChange/);
assert.match(canvasSurface, /SQLTOERD_COLUMN_SELECT_EVENT/);
assert.match(canvasSurface, /editor\.getSelectedShapes/);
assert.match(canvasSurface, /SQLTOERD_TABLE_SHAPE_TYPE/);
assert.match(canvasSurface, /SQLTOERD_RELATION_SHAPE_TYPE/);
assert.match(canvasSurface, /SqlErdRelationShapeUtil/);
assert.match(canvasSurface, /getSqlErdTableShapeId/);
assert.match(canvasSurface, /hashSqlErdShapeSourceId/);
assert.match(canvasSurface, /zoomToFit/);
assert.match(canvasSurface, /resetSqlErdCanvas\(editor, shapes\)/);
assert.match(canvasSurface, /selectedColumnId/);
assert.doesNotMatch(canvasSurface, /createShapeId\(`sqltoerd-table-\$\{shapeIdSuffix\(table\.id\)\}`\)/);

assert.match(tableShape, /SQLTOERD_TABLE_SHAPE_TYPE/);
assert.match(tableShape, /class SqlErdTableShapeUtil extends ShapeUtil/);
assert.match(tableShape, /HTMLContainer/);
assert.match(tableShape, /primaryKey/);
assert.match(tableShape, /foreignKey/);
assert.match(tableShape, /unique/);
assert.match(tableShape, /nullable/);
assert.match(tableShape, /getSqlErdTableBadgeColumnWidth/);
assert.match(tableShape, /badgeColumnWidth/);
assert.match(tableShape, /minWidth/);
assert.match(tableShape, /ROW_CONTENT_SAFETY_PADDING/);
assert.match(tableShape, /ROW_COLUMN_GAP \* 2/);
assert.match(tableShape, /SQLTOERD_COLUMN_SELECT_EVENT/);
assert.match(tableShape, /selectSqlErdColumn/);
assert.match(tableShape, /data-sqltoerd-column-id/);
assert.match(tableShape, /selectedColumnId/);
assert.match(tableShape, /aria-pressed=\{isSelected\}/);
assert.match(tableShape, /COLUMN_CLICK_DRAG_THRESHOLD/);
assert.match(tableShape, /columnPointerStartRef/);
assert.match(tableShape, /suppressNextColumnClickRef/);
assert.match(tableShape, /onPointerDown/);
assert.match(tableShape, /onPointerUp/);
assert.match(tableShape, /pointer-events-auto/);
assert.match(tableShape, /justify-self-end/);
assert.match(tableShape, /minmax\(max-content, 1fr\)/);
assert.doesNotMatch(tableShape, /const BADGE_COLUMN_WIDTH = 72/);
assert.doesNotMatch(tableShape, /gridTemplateColumns: `\$\{BADGE_COLUMN_WIDTH\}px max-content max-content`/);
assert.doesNotMatch(tableShape, /truncate/);
assert.doesNotMatch(tableShape, /text-overflow/);

assert.match(relationShape, /SQLTOERD_RELATION_SHAPE_TYPE/);
assert.match(relationShape, /class SqlErdRelationShapeUtil extends ShapeUtil/);
assert.match(relationShape, /SVGContainer/);
assert.match(relationShape, /getSqlErdRelationTableEdgeAnchors/);
assert.match(relationShape, /getSqlErdRelationShapeLayout/);
assert.match(relationShape, /getSqlErdRelationRoutePoints/);
assert.match(relationShape, /getSqlErdRelationColumnAnchors/);
assert.match(relationShape, /getSqlErdColumnAnchorY/);
assert.match(relationShape, /getRelationCurveControlPoints/);
assert.match(relationShape, /getRelationCurveBoundsPoints/);
assert.match(relationShape, /getRelationCurveGeometryPoints/);
assert.match(relationShape, /TABLE_HEADER_HEIGHT/);
assert.match(relationShape, /TABLE_ROW_HEIGHT/);
assert.match(relationShape, /fromTableId/);
assert.match(relationShape, /toTableId/);
assert.match(relationShape, /fromColumnIds/);
assert.match(relationShape, /toColumnIds/);
assert.match(relationShape, /fromTableShapeId/);
assert.match(relationShape, /toTableShapeId/);
assert.match(relationShape, /points: T\.arrayOf/);
assert.match(relationShape, /arrowPoints: T\.arrayOf/);
assert.match(relationShape, /fromColumnIds: string\[\]/);
assert.match(relationShape, /toColumnIds: string\[\]/);
assert.match(relationShape, /getRelationCurvePathData\(shape\.props\.points\)/);
assert.match(relationShape, /getRelationCurveGeometryPoints\(shape\.props\.points\)/);
assert.match(relationShape, /getRelationCurveGeometryPoints\(shape\.props\.points\)\.map/);
assert.match(relationShape, / C /);
assert.doesNotMatch(relationShape, /useValue/);
assert.doesNotMatch(relationShape, /canCull\(\)/);
assert.match(relationShape, /hideSelectionBoundsBg/);
assert.match(relationShape, /hideSelectionBoundsFg/);
assert.match(canvasSurface, /fromColumnIds: relation\.fromColumnIds/);
assert.match(canvasSurface, /toColumnIds: relation\.toColumnIds/);
assert.match(canvasSurface, /shape\.props\.fromColumnIds/);
assert.match(canvasSurface, /shape\.props\.toColumnIds/);

assert.match(packageJson, /"node-sql-parser"/);
assert.match(ddlParserUtils, /parseSqlDdlToErdModel/);
assert.match(ddlParserUtils, /node-sql-parser/);
assert.match(ddlParserUtils, /SQLTOERD_MODEL_JSON_VERSION/);
assert.match(ddlParserUtils, /NO_CREATE_TABLE/);
assert.match(ddlParserUtils, /resolveParserDatabases/);
assert.match(ddlParserUtils, /createTableState/);
assert.match(ddlParserUtils, /createRelationFromReference/);
assert.match(ddlParserUtils, /primary_key/);
assert.match(ddlParserUtils, /foreign_key/);
assert.match(ddlParserUtils, /unique/);

assert.match(apiClient, /createSqlErdApiClient/);
assert.match(apiClient, /getActiveSession/);
assert.match(apiClient, /createSession/);
assert.match(apiClient, /updateSession/);
assert.match(apiClient, /\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}\/sql-erd-session/);
assert.match(apiClient, /\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}\/sql-erd-session\/\$\{encodeURIComponent\(sessionId\)\}/);
assert.match(apiClient, /Authorization: `Bearer \$\{accessToken\}`/);
assert.match(apiClient, /credentials: "same-origin"/);
