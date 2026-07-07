import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";

async function readSqlErdFile(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

async function compileSqlErdRuntimeModules() {
  const outputDir = await mkdtemp(join(tmpdir(), "pilo-sqltoerd-runtime-"));
  const modelOutputPath = join(outputDir, "model.mjs");
  const inspectorOutputPath = join(outputDir, "inspector.mjs");

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

    const [modelRuntime, inspectorRuntime] = await Promise.all([
      import(pathToFileHref(modelOutputPath)),
      import(pathToFileHref(inspectorOutputPath))
    ]);

    return { inspectorRuntime, modelRuntime };
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

const [
  apiSpec,
  types,
  commerceFixture,
  modelUtils,
  inspectorUtils,
  navigation,
  panel,
  canvasSurface,
  tableShape,
  relationShape
] =
  await Promise.all([
    readSqlErdFile("../../../../docs/api/sqltoerd-api.md"),
    readSqlErdFile("../../src/features/sql-erd/types/index.ts"),
    readSqlErdFile("../../src/features/sql-erd/fixtures/commerce.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/model.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/inspector.ts"),
    readSqlErdFile("../../src/features/sql-erd/navigation.ts"),
    readSqlErdFile("../../src/features/sql-erd/components/sql-erd-panel.tsx"),
    readSqlErdFile("../../src/features/sql-erd/components/sql-erd-canvas.tsx"),
    readSqlErdFile("../../src/features/sql-erd/shapes/sql-erd-table-shape.tsx"),
    readSqlErdFile("../../src/features/sql-erd/shapes/sql-erd-relation-shape.tsx")
  ]);

const { inspectorRuntime, modelRuntime } = await compileSqlErdRuntimeModules();
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
assert.match(modelUtils, /columnsByTableId/);
assert.match(modelUtils, /relation\.fromTableId === relation\.toTableId/);
assert.doesNotMatch(modelUtils, /columnsById: Map<string, SqltoerdColumnRef>/);

assert.match(navigation, /SQLtoERD/);
assert.match(navigation, /href: "\/sql-erd"/);

assert.match(panel, /SqlErdCanvas/);
assert.match(panel, /selectedSqlErdObject/);
assert.match(panel, /setSelectedSqlErdObject/);
assert.match(panel, /createSqlErdInspectorViewModel/);
assert.match(panel, /Column details/);
assert.match(panel, /Table details/);
assert.match(panel, /Relation details/);
assert.match(panel, /features\/sql-erd\/utils\/inspector/);
assert.doesNotMatch(panel, /PreviewTableCard/);

assert.match(inspectorUtils, /createSqlErdInspectorViewModel/);
assert.match(inspectorUtils, /isColumnConnectedToRelation/);
assert.match(inspectorUtils, /relation\.fromTableId === tableId/);
assert.match(inspectorUtils, /relation\.toTableId === tableId/);

assert.match(canvasSurface, /TldrawSurface/);
assert.match(canvasSurface, /commerceSqltoerdFixture/);
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
assert.match(canvasSurface, /onSelectionChange/);
assert.match(canvasSurface, /SQLTOERD_COLUMN_SELECT_EVENT/);
assert.match(canvasSurface, /editor\.getSelectedShapes/);
assert.match(canvasSurface, /SQLTOERD_TABLE_SHAPE_TYPE/);
assert.match(canvasSurface, /SQLTOERD_RELATION_SHAPE_TYPE/);
assert.match(canvasSurface, /SqlErdRelationShapeUtil/);
assert.match(canvasSurface, /getSqlErdTableShapeId/);
assert.match(canvasSurface, /hashSqlErdShapeSourceId/);
assert.match(canvasSurface, /zoomToFit/);
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
assert.match(relationShape, /fromTableId/);
assert.match(relationShape, /toTableId/);
assert.match(relationShape, /fromColumnIds/);
assert.match(relationShape, /toColumnIds/);
assert.match(relationShape, /fromTableShapeId/);
assert.match(relationShape, /toTableShapeId/);
assert.match(relationShape, /points: T\.arrayOf/);
assert.match(relationShape, /arrowPoints: T\.arrayOf/);
assert.match(relationShape, /shape\.props\.points\.map/);
assert.match(relationShape, /getRelationPathData\(shape\.props\.points\)/);
assert.doesNotMatch(relationShape, /useValue/);
assert.doesNotMatch(relationShape, /canCull\(\)/);
assert.match(relationShape, /hideSelectionBoundsBg/);
assert.match(relationShape, /hideSelectionBoundsFg/);
