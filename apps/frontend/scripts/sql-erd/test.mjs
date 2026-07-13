import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { history, undoDepth } from "@codemirror/commands";
import { MySQL, PostgreSQL } from "@codemirror/lang-sql";
import { Compartment, EditorState } from "@codemirror/state";
import ts from "typescript";

async function readSqlErdFile(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

async function compileSqlErdRuntimeModules() {
  const outputDir = await mkdtemp(
    fileURLToPath(new URL("../../.pilo-sqltoerd-runtime-", import.meta.url))
  );
  const modelOutputPath = join(outputDir, "model.mjs");
  const modelToSqlOutputPath = join(outputDir, "model-to-sql.mjs");
  const sqlDiffApplyOutputPath = join(outputDir, "sql-diff-apply.mjs");
  const inspectorOutputPath = join(outputDir, "inspector.mjs");
  const ddlParserOutputPath = join(outputDir, "ddl-parser.mjs");
  const sqlSourceMapOutputPath = join(outputDir, "sql-source-map.mjs");
  const sqlSourceDecorationOutputPath = join(
    outputDir,
    "sql-source-decoration.mjs"
  );
  const generateSessionOutputPath = join(outputDir, "generate-session.mjs");
  const parseWorkerProtocolOutputPath = join(
    outputDir,
    "parse-worker-protocol.mjs"
  );
  const layoutAutosaveOutputPath = join(outputDir, "layout-autosave.mjs");
  const apiClientOutputPath = join(outputDir, "api-client.mjs");
  const sessionNavigationOutputPath = join(
    outputDir,
    "session-navigation.mjs"
  );
  const sessionListStateOutputPath = join(
    outputDir,
    "session-list-state.mjs"
  );
  const sessionStateOutputPath = join(outputDir, "session-state.mjs");
  const sqlEditStateOutputPath = join(outputDir, "sql-edit-state.mjs");
  const statusCopyOutputPath = join(outputDir, "status-copy.mjs");
  const sqlEditorDialectOutputPath = join(outputDir, "sql-editor-dialect.mjs");
  const relationShapeOutputPath = join(outputDir, "relation-shape.mjs");
  const tableShapeOutputPath = join(outputDir, "table-shape.mjs");
  const canvasSelectionOutputPath = join(outputDir, "canvas-selection.mjs");
  const tablePinOutputPath = join(outputDir, "table-pin.mjs");
  const foreignKeyAddOutputPath = join(outputDir, "foreign-key-add.mjs");
  const relationIdOutputPath = join(outputDir, "relation-id.mjs");

  try {
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/model.ts",
      modelOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/model-to-sql.ts",
      modelToSqlOutputPath,
      [[/from "@\/features\/sql-erd\/types"/g, 'from "./types-stub.mjs"']]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/sql-diff-apply.ts",
      sqlDiffApplyOutputPath,
      [
        [/from "@\/features\/sql-erd\/types"/g, 'from "./types-stub.mjs"'],
        [
          /from "@\/features\/sql-erd\/utils\/ddl-parser"/g,
          'from "./ddl-parser.mjs"'
        ],
        [
          /from "@\/features\/sql-erd\/utils\/model"/g,
          'from "./model.mjs"'
        ],
        [
          /from "@\/features\/sql-erd\/utils\/model-to-sql"/g,
          'from "./model-to-sql.mjs"'
        ]
      ]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/inspector.ts",
      inspectorOutputPath,
      [[/from "\.\/model"/g, 'from "./model.mjs"']]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/sql-source-map.ts",
      sqlSourceMapOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/sql-source-decoration.ts",
      sqlSourceDecorationOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/relation-id.ts",
      relationIdOutputPath,
      [[/from "@\/features\/sql-erd\/types"/g, 'from "./types-stub.mjs"']]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/ddl-parser.ts",
      ddlParserOutputPath,
      [
        [/from "@\/features\/sql-erd\/types"/g, 'from "./types-stub.mjs"'],
        [
          /from "@\/features\/sql-erd\/utils\/sql-source-map"/g,
          'from "./sql-source-map.mjs"'
        ],
        [
          /from "@\/features\/sql-erd\/utils\/relation-id"/g,
          'from "./relation-id.mjs"'
        ]
      ]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/generate-session.ts",
      generateSessionOutputPath,
      [
        [
          /from "@\/features\/sql-erd\/utils\/ddl-parser"/g,
          'from "./ddl-parser.mjs"'
        ],
        [/from "@\/features\/sql-erd\/utils\/model"/g, 'from "./model.mjs"']
      ]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/parse-worker-protocol.ts",
      parseWorkerProtocolOutputPath,
      [
        [
          /from "@\/features\/sql-erd\/utils\/ddl-parser"/g,
          'from "./ddl-parser.mjs"'
        ],
        [/from "@\/features\/sql-erd\/utils\/model"/g, 'from "./model.mjs"']
      ]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/layout-autosave.ts",
      layoutAutosaveOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/api/client.ts",
      apiClientOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/session-navigation.ts",
      sessionNavigationOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/session-list-state.ts",
      sessionListStateOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/session-state.ts",
      sessionStateOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/sql-edit-state.ts",
      sqlEditStateOutputPath,
      [
        [
          /from "@\/features\/sql-erd\/utils\/model"/g,
          'from "./model.mjs"'
        ]
      ]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/status-copy.ts",
      statusCopyOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/sql-editor-dialect.ts",
      sqlEditorDialectOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/shapes/sql-erd-relation-shape.tsx",
      relationShapeOutputPath,
      [
        [/from "tldraw"/g, 'from "./tldraw-stub.mjs"'],
        [
          /from "@\/features\/sql-erd\/shapes\/sql-erd-table-shape"/g,
          'from "./table-shape-stub.mjs"'
        ]
      ]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/shapes/sql-erd-table-shape.tsx",
      tableShapeOutputPath,
      [
        [/from "tldraw"/g, 'from "./tldraw-stub.mjs"'],
        [
          /from "@\/features\/sql-erd\/utils\/model"/g,
          'from "./model-stub.mjs"'
        ]
      ]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/canvas-selection.ts",
      canvasSelectionOutputPath,
      [
        [
          /from "@\/features\/sql-erd\/shapes\/sql-erd-annotation-shape"/g,
          'from "./annotation-shape-stub.mjs"'
        ],
        [
          /from "@\/features\/sql-erd\/shapes\/sql-erd-relation-shape"/g,
          'from "./relation-shape-stub.mjs"'
        ],
        [
          /from "@\/features\/sql-erd\/shapes\/sql-erd-table-shape"/g,
          'from "./table-shape-stub.mjs"'
        ]
      ]
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/table-pin.ts",
      tablePinOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/foreign-key-add.ts",
      foreignKeyAddOutputPath,
      [
        [/from "@\/features\/sql-erd\/types"/g, 'from "./types-stub.mjs"'],
        [
          /from "@\/features\/sql-erd\/utils\/relation-id"/g,
          'from "./relation-id.mjs"'
        ]
      ]
    );

    await writeFile(
      join(outputDir, "types-stub.mjs"),
      "export const SQLTOERD_MODEL_JSON_VERSION = 1;\n"
    );
    await writeFile(
      join(outputDir, "tldraw-stub.mjs"),
      [
        "export function HTMLContainer(props) { return props.children ?? null; }",
        "export class Polyline2d { constructor(config) { this.config = config; } }",
        "export class Rectangle2d { constructor(config) { this.config = config; } }",
        "export class ShapeUtil { constructor(editor) { this.editor = editor; } }",
        "export function SVGContainer(props) { return props.children ?? null; }",
        "export const T = { arrayOf: (value) => value, boolean: {}, nullable: (value) => value, number: {}, object: (value) => value, string: {} };",
        "export function useEditor() { return null; }",
        "export function useValue(_name, getValue) { return getValue(); }",
        "export class Vec { constructor(x, y) { this.x = x; this.y = y; } }"
      ].join("\n")
    );
    await writeFile(
      join(outputDir, "annotation-shape-stub.mjs"),
      "export function isSqlErdAnnotationShape(shape) { return shape?.type === 'sqltoerd_annotation'; }\n"
    );
    await writeFile(
      join(outputDir, "table-shape-stub.mjs"),
      "export function isSqlErdTableShape(shape) { return shape?.type === 'sqltoerd_table'; }\n"
    );
    await writeFile(
      join(outputDir, "relation-shape-stub.mjs"),
      "export function isSqlErdRelationShape(shape) { return shape?.type === 'sqltoerd_relation'; }\n"
    );
    await writeFile(
      join(outputDir, "model-stub.mjs"),
      "export function getTableDisplayName(table) { return table.schemaName ? `${table.schemaName}.${table.name}` : table.name; }\n"
    );

    const [
      modelRuntime,
      modelToSqlRuntime,
      sqlDiffApplyRuntime,
      inspectorRuntime,
      ddlParserRuntime,
      sqlSourceMapRuntime,
      sqlSourceDecorationRuntime,
      generateSessionRuntime,
      parseWorkerProtocolRuntime,
      layoutAutosaveRuntime,
      apiClientRuntime,
      sessionNavigationRuntime,
      sessionListStateRuntime,
      sessionStateRuntime,
      sqlEditStateRuntime,
      sqlEditorDialectRuntime,
      statusCopyRuntime,
      relationShapeRuntime,
      tableShapeRuntime,
      canvasSelectionRuntime,
      tablePinRuntime,
      foreignKeyAddRuntime
    ] = await Promise.all([
      import(pathToFileHref(modelOutputPath)),
      import(pathToFileHref(modelToSqlOutputPath)),
      import(pathToFileHref(sqlDiffApplyOutputPath)),
      import(pathToFileHref(inspectorOutputPath)),
      import(pathToFileHref(ddlParserOutputPath)),
      import(pathToFileHref(sqlSourceMapOutputPath)),
      import(pathToFileHref(sqlSourceDecorationOutputPath)),
      import(pathToFileHref(generateSessionOutputPath)),
      import(pathToFileHref(parseWorkerProtocolOutputPath)),
      import(pathToFileHref(layoutAutosaveOutputPath)),
      import(pathToFileHref(apiClientOutputPath)),
      import(pathToFileHref(sessionNavigationOutputPath)),
      import(pathToFileHref(sessionListStateOutputPath)),
      import(pathToFileHref(sessionStateOutputPath)),
      import(pathToFileHref(sqlEditStateOutputPath)),
      import(pathToFileHref(sqlEditorDialectOutputPath)),
      import(pathToFileHref(statusCopyOutputPath)),
      import(pathToFileHref(relationShapeOutputPath)),
      import(pathToFileHref(tableShapeOutputPath)),
      import(pathToFileHref(canvasSelectionOutputPath)),
      import(pathToFileHref(tablePinOutputPath)),
      import(pathToFileHref(foreignKeyAddOutputPath))
    ]);

    return {
      apiClientRuntime,
      canvasSelectionRuntime,
      ddlParserRuntime,
      sqlSourceMapRuntime,
      sqlSourceDecorationRuntime,
      generateSessionRuntime,
      parseWorkerProtocolRuntime,
      layoutAutosaveRuntime,
      inspectorRuntime,
      modelRuntime,
      modelToSqlRuntime,
      sqlDiffApplyRuntime,
      relationShapeRuntime,
      sessionListStateRuntime,
      sessionNavigationRuntime,
      sessionStateRuntime,
      sqlEditStateRuntime,
      sqlEditorDialectRuntime,
      statusCopyRuntime,
      tableShapeRuntime,
      tablePinRuntime,
      foreignKeyAddRuntime
    };
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

function createRuntimeModelWithStableIdPrefix(modelJson, prefix) {
  const stableModelJson = structuredClone(modelJson);
  const tableIds = new Map();
  const columnIdsByTableId = new Map();

  for (const table of stableModelJson.schema.tables) {
    const originalTableId = table.id;
    const columnIds = new Map();

    table.id = `${prefix}${originalTableId}`;
    tableIds.set(originalTableId, table.id);

    for (const column of table.columns) {
      const originalColumnId = column.id;

      column.id = `${prefix}${originalColumnId}`;
      columnIds.set(originalColumnId, column.id);
    }

    for (const constraint of table.constraints) {
      constraint.id = `${prefix}${constraint.id}`;
      constraint.columnIds = constraint.columnIds.map(
        (columnId) => columnIds.get(columnId) ?? columnId
      );
    }

    columnIdsByTableId.set(originalTableId, columnIds);
  }

  for (const relation of stableModelJson.schema.relations) {
    const originalFromTableId = relation.fromTableId;
    const originalToTableId = relation.toTableId;
    const fromColumnIds = columnIdsByTableId.get(originalFromTableId);
    const toColumnIds = columnIdsByTableId.get(originalToTableId);

    relation.id = `${prefix}${relation.id}`;
    relation.fromTableId =
      tableIds.get(originalFromTableId) ?? originalFromTableId;
    relation.toTableId = tableIds.get(originalToTableId) ?? originalToTableId;
    relation.fromColumnIds = relation.fromColumnIds.map(
      (columnId) => fromColumnIds?.get(columnId) ?? columnId
    );
    relation.toColumnIds = relation.toColumnIds.map(
      (columnId) => toColumnIds?.get(columnId) ?? columnId
    );
  }

  return stableModelJson;
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

function createRuntimeTableShape(id, table, tableShapeRuntime, overrides = {}) {
  return {
    id,
    type: "sqltoerd_table",
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    props: {
      w: overrides.w ?? 320,
      h: overrides.h ?? 180,
      tableId: table.id,
      tableName: table.name,
      schemaName: table.schemaName,
      badgeColumnWidth: overrides.badgeColumnWidth ?? 72,
      selectedColumnId: overrides.selectedColumnId ?? null,
      selectedState: overrides.selectedState ?? "none",
      highlightedColumnIds: overrides.highlightedColumnIds ?? [],
      columns: tableShapeRuntime.toSqlErdTableShapeColumns(table.columns)
    }
  };
}

function createRuntimeTableSelectionEditor(shapes) {
  let currentPagePoint = { x: 0, y: 0 };
  let selectedShapeId = null;
  const runOptions = [];

  return {
    getCurrentPageShapes: () => shapes,
    getSelectedShapes: () =>
      selectedShapeId
        ? shapes.filter((shape) => shape.id === selectedShapeId)
        : [],
    getPointInShapeSpace: (_shape, point) => point,
    inputs: {
      getCurrentPagePoint: () => currentPagePoint
    },
    run: (callback, options) => {
      runOptions.push(options);
      callback();
    },
    runOptions,
    select: (shapeId) => {
      selectedShapeId = shapeId;
    },
    setCurrentPagePoint: (point) => {
      currentPagePoint = point;
    },
    updateShapes: (updates) => {
      for (const update of updates) {
        const targetShape = shapes.find((shape) => shape.id === update.id);

        if (!targetShape) {
          continue;
        }

        Object.assign(targetShape, update);

        if (update.props) {
          targetShape.props = {
            ...targetShape.props,
            ...update.props
          };
        }
      }
    }
  };
}

const [
  apiSpec,
  types,
  commerceFixture,
  homeDashboardData,
  modelUtils,
  inspectorUtils,
  page,
  sessionPage,
  sessionRouteBridge,
  navigation,
  panel,
  sessionList,
  sessionListStateUtils,
  sessionNavigationUtils,
  sessionStateUtils,
  generateSessionUtils,
  layoutAutosaveUtils,
  tablePinUtils,
  statusCopyUtils,
  sqlDiffApplyUtils,
  canvasSurface,
  mainShell,
  tableShape,
  relationShape,
  annotationShape,
  ddlParserUtils,
  sqlEditorDialectUtils,
  sqlSourceDecorationUtils,
  apiClient,
  packageJson
] =
  await Promise.all([
    readSqlErdFile("../../../../docs/api/sqltoerd-api.md"),
    readSqlErdFile("../../src/features/sql-erd/types/index.ts"),
    readSqlErdFile("../../src/features/sql-erd/fixtures/commerce.ts"),
    readSqlErdFile("../../src/features/home/hooks/use-home-dashboard-data.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/model.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/inspector.ts"),
    readSqlErdFile("../../src/features/sql-erd/page.tsx"),
    readSqlErdFile("../../src/features/sql-erd/session-page.tsx"),
    readSqlErdFile("../../src/app/(workspace)/sql-erd/session/page.tsx"),
    readSqlErdFile("../../src/features/sql-erd/navigation.ts"),
    readSqlErdFile("../../src/features/sql-erd/components/sql-erd-panel.tsx"),
    readSqlErdFile(
      "../../src/features/sql-erd/components/sql-erd-session-list.tsx"
    ),
    readSqlErdFile("../../src/features/sql-erd/utils/session-list-state.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/session-navigation.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/session-state.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/generate-session.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/layout-autosave.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/table-pin.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/status-copy.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/sql-diff-apply.ts"),
    readSqlErdFile("../../src/features/sql-erd/components/sql-erd-canvas.tsx"),
    readSqlErdFile("../../src/components/main-shell.tsx"),
    readSqlErdFile("../../src/features/sql-erd/shapes/sql-erd-table-shape.tsx"),
    readSqlErdFile("../../src/features/sql-erd/shapes/sql-erd-relation-shape.tsx"),
    readSqlErdFile("../../src/features/sql-erd/shapes/sql-erd-annotation-shape.tsx"),
    readSqlErdFile("../../src/features/sql-erd/utils/ddl-parser.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/sql-editor-dialect.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/sql-source-decoration.ts"),
    readSqlErdFile("../../src/features/sql-erd/api/client.ts"),
    readSqlErdFile("../../package.json")
  ]);

const {
  apiClientRuntime,
  sessionListStateRuntime,
  sessionNavigationRuntime,
  canvasSelectionRuntime,
  ddlParserRuntime,
  sqlSourceMapRuntime,
  sqlSourceDecorationRuntime,
  generateSessionRuntime,
  parseWorkerProtocolRuntime,
  layoutAutosaveRuntime,
  inspectorRuntime,
  modelRuntime,
  modelToSqlRuntime,
  sqlDiffApplyRuntime,
  relationShapeRuntime,
  sessionStateRuntime,
  sqlEditStateRuntime,
  sqlEditorDialectRuntime,
  statusCopyRuntime,
  tableShapeRuntime,
  tablePinRuntime,
  foreignKeyAddRuntime
} = await compileSqlErdRuntimeModules();

const initialTablePinState = tablePinRuntime.createSqlErdTablePinState();
const pinnedOrdersTable = tablePinRuntime.pinSqlErdTable(
  initialTablePinState,
  "table.orders"
);

assert.deepEqual(pinnedOrdersTable, {
  pinnedTableId: "table.orders",
  navigationRequestId: 0
});
assert.deepEqual(
  tablePinRuntime.pinSqlErdTable(pinnedOrdersTable, "table.orders"),
  {
    pinnedTableId: "table.orders",
    navigationRequestId: 1
  }
);
const navigatedOrdersTable = tablePinRuntime.pinSqlErdTable(
  pinnedOrdersTable,
  "table.orders"
);
assert.deepEqual(
  tablePinRuntime.pinSqlErdTable(navigatedOrdersTable, "table.users"),
  {
    pinnedTableId: "table.users",
    navigationRequestId: 0
  }
);
assert.deepEqual(
  tablePinRuntime.clearSqlErdTablePin(),
  initialTablePinState
);
assert.deepEqual(
  tablePinRuntime.getSqlErdPinnedTableCenter(
    [
      {
        x: 100,
        y: 200,
        props: { h: 80, tableId: "table.orders", w: 340 }
      },
      {
        x: 560,
        y: 100,
        props: { h: 120, tableId: "table.users", w: 280 }
      }
    ],
    "table.orders"
  ),
  { x: 270, y: 240 }
);
assert.equal(
  tablePinRuntime.getSqlErdPinnedTableCenter([], "table.orders"),
  null
);
const runtimeModel = createRuntimeTestModel();

const foreignKeyAddCandidate = foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
  fromColumnId: "id",
  fromTableId: "table.orders",
  modelJson: runtimeModel,
  toColumnId: "id",
  toTableId: "table.users"
});

assert.equal(foreignKeyAddCandidate.ok, true);
assert.equal(foreignKeyAddCandidate.relation.id, "relation.orders.id.users.id");
assert.equal(foreignKeyAddCandidate.relation.fromTableId, "table.orders");
assert.equal(foreignKeyAddCandidate.relation.toTableId, "table.users");
assert.equal(
  foreignKeyAddCandidate.modelJson.schema.tables
    .find((table) => table.id === "table.orders")
    .columns.find((column) => column.id === "id").foreignKey,
  true
);

const generatedForeignKeyCandidateSql =
  modelToSqlRuntime.generateSqlDdlFromErdModel({
    dialect: "postgresql",
    modelJson: foreignKeyAddCandidate.modelJson
  });
const reparsedForeignKeyCandidate = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "postgresql",
  sourceMapModelJson: foreignKeyAddCandidate.modelJson,
  sourceText: generatedForeignKeyCandidateSql.sql
});

assert.equal(reparsedForeignKeyCandidate.ok, true);
assert.equal(reparsedForeignKeyCandidate.modelJson.schema.relations.length, 3);
assert.ok(
  reparsedForeignKeyCandidate.modelJson.schema.relations.some(
    (relation) => relation.id === "relation.orders.id.users.id"
  )
);

assert.deepEqual(
  foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
    fromColumnId: "user_id",
    fromTableId: "table.orders",
    modelJson: runtimeModel,
    toColumnId: "id",
    toTableId: "table.users"
  }),
  { ok: false, reason: "duplicate_relation" }
);

assert.deepEqual(
  foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
    fromColumnId: "manager_id",
    fromTableId: "table.users",
    modelJson: runtimeModel,
    toColumnId: "id",
    toTableId: "table.orders"
  }),
  { ok: false, reason: "source_column_already_has_foreign_key" }
);

assert.deepEqual(
  foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
    fromColumnId: "id",
    fromTableId: "table.orders",
    modelJson: runtimeModel,
    toColumnId: "manager_id",
    toTableId: "table.users"
  }),
  { ok: false, reason: "target_column_not_key" }
);

const incompatibleForeignKeyModel = structuredClone(runtimeModel);
incompatibleForeignKeyModel.schema.tables
  .find((table) => table.id === "table.orders")
  .columns.find((column) => column.id === "id").dataType = "VARCHAR(36)";

assert.deepEqual(
  foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
    fromColumnId: "id",
    fromTableId: "table.orders",
    modelJson: incompatibleForeignKeyModel,
    toColumnId: "id",
    toTableId: "table.users"
  }),
  { ok: false, reason: "incompatible_column_type" }
);

const mysqlUnsignedForeignKeyModel = structuredClone(runtimeModel);
mysqlUnsignedForeignKeyModel.schema.tables
  .find((table) => table.id === "table.orders")
  .columns.find((column) => column.id === "id").dataType = "INT";
mysqlUnsignedForeignKeyModel.schema.tables
  .find((table) => table.id === "table.users")
  .columns.find((column) => column.id === "id").dataType = "INT UNSIGNED";

assert.deepEqual(
  foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
    dialect: "mysql",
    fromColumnId: "id",
    fromTableId: "table.orders",
    modelJson: mysqlUnsignedForeignKeyModel,
    toColumnId: "id",
    toTableId: "table.users"
  }),
  { ok: false, reason: "incompatible_column_type" }
);

const mysqlDecimalForeignKeyModel = structuredClone(runtimeModel);
mysqlDecimalForeignKeyModel.schema.tables
  .find((table) => table.id === "table.orders")
  .columns.find((column) => column.id === "id").dataType = "DECIMAL(10, 2) UNSIGNED";
mysqlDecimalForeignKeyModel.schema.tables
  .find((table) => table.id === "table.users")
  .columns.find((column) => column.id === "id").dataType = "DECIMAL(12, 2) UNSIGNED";

assert.deepEqual(
  foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
    dialect: "mysql",
    fromColumnId: "id",
    fromTableId: "table.orders",
    modelJson: mysqlDecimalForeignKeyModel,
    toColumnId: "id",
    toTableId: "table.users"
  }),
  { ok: false, reason: "incompatible_column_type" }
);

const mysqlDecimalUnsignedForeignKeyModel = structuredClone(runtimeModel);
mysqlDecimalUnsignedForeignKeyModel.schema.tables
  .find((table) => table.id === "table.orders")
  .columns.find((column) => column.id === "id").dataType = "DECIMAL(10, 2)";
mysqlDecimalUnsignedForeignKeyModel.schema.tables
  .find((table) => table.id === "table.users")
  .columns.find((column) => column.id === "id").dataType = "DECIMAL(10, 2) UNSIGNED";

assert.deepEqual(
  foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
    dialect: "mysql",
    fromColumnId: "id",
    fromTableId: "table.orders",
    modelJson: mysqlDecimalUnsignedForeignKeyModel,
    toColumnId: "id",
    toTableId: "table.users"
  }),
  { ok: false, reason: "incompatible_column_type" }
);

const relationIdCollisionModel = structuredClone(runtimeModel);
const collisionOrdersTable = relationIdCollisionModel.schema.tables.find(
  (table) => table.id === "table.orders"
);
const collisionUsersTable = relationIdCollisionModel.schema.tables.find(
  (table) => table.id === "table.users"
);
collisionOrdersTable.columns.push(
  createRuntimeTestColumn("a", "a"),
  createRuntimeTestColumn("b", "b"),
  createRuntimeTestColumn("a_b", "a_b")
);
collisionUsersTable.columns.push(
  createRuntimeTestColumn("c", "c"),
  createRuntimeTestColumn("d", "d"),
  createRuntimeTestColumn("c_d", "c_d", { unique: true })
);
collisionUsersTable.constraints.push({
  columnIds: ["c_d"],
  id: "constraint.users.c_d.unique",
  kind: "unique",
  name: null
});
relationIdCollisionModel.schema.relations.push({
  constraintName: null,
  fromColumnIds: ["a", "b"],
  fromTableId: "table.orders",
  id: "relation.orders.a_b.users.c_d",
  kind: "foreign_key",
  toColumnIds: ["c", "d"],
  toTableId: "table.users"
});

const relationIdCollisionCandidate =
  foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
    dialect: "postgresql",
    fromColumnId: "a_b",
    fromTableId: "table.orders",
    modelJson: relationIdCollisionModel,
    toColumnId: "c_d",
    toTableId: "table.users"
  });

assert.equal(relationIdCollisionCandidate.ok, true);
assert.notEqual(
  relationIdCollisionCandidate.relation.id,
  "relation.orders.a_b.users.c_d"
);
assert.equal(
  new Set(
    relationIdCollisionCandidate.modelJson.schema.relations.map((relation) => relation.id)
  ).size,
  relationIdCollisionCandidate.modelJson.schema.relations.length
);

const reparsedRelationIdCollision = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "postgresql",
  sourceText: modelToSqlRuntime.generateSqlDdlFromErdModel({
    dialect: "postgresql",
    modelJson: relationIdCollisionCandidate.modelJson
  }).sql
});

assert.equal(reparsedRelationIdCollision.ok, true);
assert.equal(reparsedRelationIdCollision.modelJson.schema.relations.length, 4);
assert.equal(
  new Set(reparsedRelationIdCollision.modelJson.schema.relations.map((relation) => relation.id))
    .size,
  4
);

const longRelationIdentifierModel = structuredClone(runtimeModel);
const longTableName = "t".repeat(62);
const longColumnName = "c".repeat(62);
longRelationIdentifierModel.schema.tables
  .find((table) => table.id === "table.orders").name = longTableName;
longRelationIdentifierModel.schema.tables
  .find((table) => table.id === "table.users").name = `${longTableName}_target`;
longRelationIdentifierModel.schema.tables
  .find((table) => table.id === "table.orders")
  .columns.find((column) => column.id === "id").name = longColumnName;
longRelationIdentifierModel.schema.tables
  .find((table) => table.id === "table.users")
  .columns.find((column) => column.id === "id").name = `${longColumnName}_target`;

const longRelationIdentifierCandidate =
  foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
    dialect: "postgresql",
    fromColumnId: "id",
    fromTableId: "table.orders",
    modelJson: longRelationIdentifierModel,
    toColumnId: "id",
    toTableId: "table.users"
  });

assert.equal(longRelationIdentifierCandidate.ok, true);
assert.ok(longRelationIdentifierCandidate.relation.id.length <= 256);
const reparsedLongRelationIdentifier = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "postgresql",
  sourceText: modelToSqlRuntime.generateSqlDdlFromErdModel({
    dialect: "postgresql",
    modelJson: longRelationIdentifierCandidate.modelJson
  }).sql
});

assert.equal(reparsedLongRelationIdentifier.ok, true);
assert.ok(
  reparsedLongRelationIdentifier.modelJson.schema.relations.every(
    (relation) => relation.id.length <= 256
  )
);

assert.deepEqual(
  foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
    fromColumnId: "id",
    fromTableId: "table.users",
    modelJson: runtimeModel,
    toColumnId: "id",
    toTableId: "table.users"
  }),
  { ok: false, reason: "same_endpoint" }
);

const selfReferencingForeignKeyModel = structuredClone(runtimeModel);
selfReferencingForeignKeyModel.schema.tables
  .find((table) => table.id === "table.users")
  .columns.push(createRuntimeTestColumn("mentor_id", "mentor_id"));
const selfReferencingForeignKeyCandidate =
  foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
    fromColumnId: "mentor_id",
    fromTableId: "table.users",
    modelJson: selfReferencingForeignKeyModel,
    toColumnId: "id",
    toTableId: "table.users"
  });

assert.equal(selfReferencingForeignKeyCandidate.ok, true);
assert.equal(
  selfReferencingForeignKeyCandidate.relation.id,
  "relation.users.mentor_id.users.id"
);

const compositeTargetKeyModel = structuredClone(runtimeModel);
const compositeTargetUsersTable = compositeTargetKeyModel.schema.tables.find(
  (table) => table.id === "table.users"
);
compositeTargetUsersTable.constraints = [
  {
    columnIds: ["id", "manager_id"],
    id: "constraint.users.pk.composite",
    kind: "primary_key",
    name: null
  }
];

assert.deepEqual(
  foreignKeyAddRuntime
    .getSqltoerdForeignKeyTargetColumns(compositeTargetUsersTable)
    .map((column) => column.id),
  []
);

assert.deepEqual(
  foreignKeyAddRuntime.createSqlErdForeignKeyAddCandidate({
    fromColumnId: "id",
    fromTableId: "table.orders",
    modelJson: compositeTargetKeyModel,
    toColumnId: "id",
    toTableId: "table.users"
  }),
  { ok: false, reason: "target_column_not_key" }
);

assert.equal(
  sqlEditorDialectRuntime.resolveSqlSourceEditorDialect("postgresql", "mysql"),
  "postgresql"
);
assert.equal(
  sqlEditorDialectRuntime.resolveSqlSourceEditorDialect("mysql", "postgresql"),
  "mysql"
);
assert.equal(
  sqlEditorDialectRuntime.resolveSqlSourceEditorDialect("auto", null),
  "postgresql"
);
assert.equal(
  sqlEditorDialectRuntime.resolveSqlSourceEditorDialect("auto", "mysql"),
  "mysql"
);
assert.equal(
  sqlEditorDialectRuntime.getSqlSourceEditorCodeMirrorDialect("postgresql"),
  PostgreSQL
);
assert.equal(
  sqlEditorDialectRuntime.getSqlSourceEditorCodeMirrorDialect("mysql"),
  MySQL
);
const runtimeDialectCompartment = new Compartment();
let runtimeDialectEditorState = EditorState.create({
  doc: "CREATE TABLE users (id BIGINT);",
  selection: { anchor: 13 },
  extensions: [
    history(),
    runtimeDialectCompartment.of(
      sqlEditorDialectRuntime.getSqlSourceEditorLanguageExtension("postgresql")
    )
  ]
});
runtimeDialectEditorState = runtimeDialectEditorState.update({
  changes: { from: runtimeDialectEditorState.doc.length, insert: "\n" },
  selection: { anchor: 6 },
  userEvent: "input"
}).state;
const runtimeDialectDocument = runtimeDialectEditorState.doc.toString();
const runtimeDialectSelection = runtimeDialectEditorState.selection.main;
const runtimeDialectUndoDepth = undoDepth(runtimeDialectEditorState);

runtimeDialectEditorState = runtimeDialectEditorState.update({
  effects:
    sqlEditorDialectRuntime.createSqlSourceEditorDialectReconfigureEffect(
      runtimeDialectCompartment,
      "mysql"
    )
}).state;

assert.equal(runtimeDialectEditorState.doc.toString(), runtimeDialectDocument);
assert.deepEqual(runtimeDialectEditorState.selection.main, runtimeDialectSelection);
assert.equal(undoDepth(runtimeDialectEditorState), runtimeDialectUndoDepth);
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

function getRuntimeRelationCardinality({ nullable, unique }) {
  const modelJson = structuredClone(runtimeModel);
  const ordersTable = modelJson.schema.tables.find(
    (table) => table.id === "table.orders"
  );
  const userIdColumn = ordersTable?.columns.find(
    (column) => column.id === "user_id"
  );
  const relation = modelJson.schema.relations.find(
    (candidate) => candidate.id === "relation.orders.user_id.users.id"
  );

  assert.ok(userIdColumn);
  assert.ok(relation);

  userIdColumn.nullable = nullable;
  userIdColumn.unique = unique;

  return modelRuntime.inferSqlErdRelationCardinality(
    relation,
    modelRuntime.createSqltoerdModelIndex(modelJson)
  );
}

assert.deepEqual(
  getRuntimeRelationCardinality({ nullable: true, unique: false }),
  {
    from: "zero_or_many",
    to: "zero_or_one"
  }
);
assert.deepEqual(
  getRuntimeRelationCardinality({ nullable: false, unique: false }),
  {
    from: "zero_or_many",
    to: "one"
  }
);
assert.deepEqual(
  getRuntimeRelationCardinality({ nullable: true, unique: true }),
  {
    from: "zero_or_one",
    to: "zero_or_one"
  }
);
assert.deepEqual(
  getRuntimeRelationCardinality({ nullable: false, unique: true }),
  {
    from: "zero_or_one",
    to: "one"
  }
);

const compositePrimaryKeyModel = structuredClone(runtimeModel);
const compositePrimaryKeyOrdersTable =
  compositePrimaryKeyModel.schema.tables.find(
    (table) => table.id === "table.orders"
  );
const compositePrimaryKeyUserIdColumn =
  compositePrimaryKeyOrdersTable?.columns.find(
    (column) => column.id === "user_id"
  );
const compositePrimaryKeyRelation =
  compositePrimaryKeyModel.schema.relations.find(
    (relation) => relation.id === "relation.orders.user_id.users.id"
  );

assert.ok(compositePrimaryKeyOrdersTable);
assert.ok(compositePrimaryKeyUserIdColumn);
assert.ok(compositePrimaryKeyRelation);

compositePrimaryKeyUserIdColumn.primaryKey = true;
compositePrimaryKeyUserIdColumn.unique = false;
compositePrimaryKeyOrdersTable.constraints = [
  {
    id: "constraint.orders.pk",
    kind: "primary_key",
    columnIds: ["id", "user_id"],
    name: null
  }
];

assert.deepEqual(
  modelRuntime.inferSqlErdRelationCardinality(
    compositePrimaryKeyRelation,
    modelRuntime.createSqltoerdModelIndex(compositePrimaryKeyModel)
  ),
  {
    from: "zero_or_many",
    to: "zero_or_one"
  }
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

const runtimeUsersTable =
  runtimeModel.schema.tables.find((table) => table.id === "table.users") ??
  null;
const runtimeOrdersTable =
  runtimeModel.schema.tables.find((table) => table.id === "table.orders") ??
  null;

assert.ok(runtimeUsersTable);
assert.ok(runtimeOrdersTable);

const runtimeUsersShape = createRuntimeTableShape(
  "shape:users",
  runtimeUsersTable,
  tableShapeRuntime,
  { selectedColumnId: "id", selectedState: "column" }
);
const runtimeOrdersShape = createRuntimeTableShape(
  "shape:orders",
  runtimeOrdersTable,
  tableShapeRuntime
);

assert.deepEqual(
  tableShapeRuntime.getSqlErdTableSelectionAtLocalPoint(runtimeOrdersShape, {
    x: 20,
    y: 20
  }),
  { type: "table" }
);
assert.deepEqual(
  tableShapeRuntime.getSqlErdTableSelectionAtLocalPoint(runtimeOrdersShape, {
    x: 20,
    y: 117
  }),
  { type: "column", columnId: "user_id" }
);
assert.equal(
  tableShapeRuntime.getSqlErdTableSelectionAtLocalPoint(runtimeOrdersShape, {
    x: 20,
    y: runtimeOrdersShape.props.h + 1
  }),
  null
);

const runtimeClickOrdersShape = createRuntimeTableShape(
  "shape:click-orders",
  runtimeOrdersTable,
  tableShapeRuntime
);
const runtimeClickUsersShape = createRuntimeTableShape(
  "shape:click-users",
  runtimeUsersTable,
  tableShapeRuntime
);
const runtimeClickEditor = createRuntimeTableSelectionEditor([
  runtimeClickUsersShape,
  runtimeClickOrdersShape
]);
const runtimeClickEvents = [];
const previousRuntimeWindow = globalThis.window;

globalThis.window = {
  dispatchEvent(event) {
    runtimeClickEvents.push(event);
    return true;
  }
};

try {
  const runtimeClickShapeUtil = new tableShapeRuntime.SqlErdTableShapeUtil(
    runtimeClickEditor
  );

  runtimeClickEditor.setCurrentPagePoint({ x: 20, y: 117 });
  runtimeClickShapeUtil.onClick(runtimeClickOrdersShape);

  assert.equal(runtimeClickOrdersShape.props.selectedState, "column");
  assert.equal(runtimeClickOrdersShape.props.selectedColumnId, "user_id");
  assert.equal(runtimeClickEvents.at(-1).type, "sqltoerd:column-select");
  assert.deepEqual(runtimeClickEvents.at(-1).detail, {
    columnId: "user_id",
    tableId: "table.orders"
  });

  runtimeClickEditor.setCurrentPagePoint({ x: 20, y: 20 });
  runtimeClickShapeUtil.onClick(runtimeClickOrdersShape);

  assert.equal(runtimeClickOrdersShape.props.selectedState, "table");
  assert.equal(runtimeClickOrdersShape.props.selectedColumnId, null);
  assert.equal(runtimeClickEvents.at(-1).type, "sqltoerd:table-select");
  assert.deepEqual(runtimeClickEvents.at(-1).detail, {
    tableId: "table.orders"
  });
  assert.equal(
    runtimeClickShapeUtil.hideSelectionBoundsBg(runtimeClickOrdersShape),
    true
  );
  assert.equal(
    runtimeClickShapeUtil.hideSelectionBoundsFg(runtimeClickOrdersShape),
    false
  );
} finally {
  if (previousRuntimeWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = previousRuntimeWindow;
  }
}

const runtimeSelectionEditor = createRuntimeTableSelectionEditor([
  runtimeUsersShape,
  runtimeOrdersShape
]);

tableShapeRuntime.selectSqlErdTableShapeColumn(
  runtimeSelectionEditor,
  runtimeOrdersShape,
  "user_id"
);

assert.deepEqual(runtimeSelectionEditor.runOptions.at(-1), {
  history: "ignore"
});
assert.equal(runtimeOrdersShape.props.selectedState, "column");
assert.equal(runtimeOrdersShape.props.selectedColumnId, "user_id");
assert.equal(runtimeUsersShape.props.selectedState, "none");
assert.equal(runtimeUsersShape.props.selectedColumnId, null);

const runtimeTableShapeUtil = new tableShapeRuntime.SqlErdTableShapeUtil();

assert.equal(
  runtimeTableShapeUtil.hideSelectionBoundsBg(runtimeOrdersShape),
  true
);
assert.equal(
  runtimeTableShapeUtil.hideSelectionBoundsFg(runtimeOrdersShape),
  true
);
assert.deepEqual(
  tableShapeRuntime.getSqlErdColumnRowVisualStyle({
    isAlternateRow: false,
    isHighlighted: false,
    isSelected: true
  }),
  {
    backgroundColor: "#dbeafe",
    boxShadow:
      "inset 4px 0 0 #2563eb, inset 0 0 0 1px rgba(37, 99, 235, 0.32)"
  }
);
assert.equal(
  tableShapeRuntime.isSqlErdColumnPointerDrag(
    { x: 10, y: 10 },
    { x: 13, y: 12 }
  ),
  false
);
assert.equal(
  tableShapeRuntime.isSqlErdColumnPointerDrag(
    { x: 10, y: 10 },
    { x: 15, y: 10 }
  ),
  true
);
const selectedColumnFromCanvas =
  canvasSelectionRuntime.getSqlErdSelectionFromSelectedShapes(
    runtimeSelectionEditor.getSelectedShapes()
  );

assert.deepEqual(selectedColumnFromCanvas, {
  type: "column",
  tableId: "table.orders",
  columnId: "user_id"
});

const selectedColumnInspectorView =
  inspectorRuntime.createSqlErdInspectorViewModel(
    selectedColumnFromCanvas,
    runtimeModelIndex
  );

assert.equal(selectedColumnInspectorView.type, "column");
assert.equal(selectedColumnInspectorView.table.id, "table.orders");
assert.equal(selectedColumnInspectorView.column.id, "user_id");
assert.deepEqual(
  selectedColumnInspectorView.relations.map((relation) => relation.id),
  ["relation.orders.user_id.users.id"]
);

tableShapeRuntime.selectSqlErdTableShape(
  runtimeSelectionEditor,
  runtimeUsersShape
);

const selectedTableFromCanvas =
  canvasSelectionRuntime.getSqlErdSelectionFromSelectedShapes(
    runtimeSelectionEditor.getSelectedShapes()
  );

assert.deepEqual(selectedTableFromCanvas, {
  type: "table",
  tableId: "table.users"
});
assert.equal(runtimeUsersShape.props.selectedState, "table");
assert.equal(runtimeUsersShape.props.selectedColumnId, null);
assert.equal(runtimeOrdersShape.props.selectedState, "none");
assert.equal(runtimeOrdersShape.props.selectedColumnId, null);

const selectedRelationFromCanvas =
  canvasSelectionRuntime.getSqlErdSelectionFromSelectedShapes([
    {
      type: "sqltoerd_relation",
      props: {
        relationId: "relation.orders.user_id.users.id"
      }
    }
  ]);

assert.deepEqual(selectedRelationFromCanvas, {
  type: "relation",
  relationId: "relation.orders.user_id.users.id"
});
assert.deepEqual(
  canvasSelectionRuntime.getSqlErdSelectionFromSelectedShapes([
    {
      type: "sqltoerd_annotation",
      props: { annotationId: "annotation.users.orders" }
    }
  ]),
  { type: "annotation", annotationId: "annotation.users.orders" }
);
assert.equal(
  canvasSelectionRuntime.areSqlErdSelectionsEqual(
    { type: "annotation", annotationId: "annotation.users.orders" },
    { type: "annotation", annotationId: "annotation.orders.products" }
  ),
  false
);
assert.equal(
  canvasSelectionRuntime.areSqlErdSelectionsEqual(
    { type: "annotation", annotationId: "annotation.users.orders" },
    { type: "annotation", annotationId: "annotation.users.orders" }
  ),
  true
);
const selectedRelationInspectorView =
  inspectorRuntime.createSqlErdInspectorViewModel(
    selectedRelationFromCanvas,
    runtimeModelIndex
  );

assert.equal(selectedRelationInspectorView.type, "relation");
assert.deepEqual(selectedRelationInspectorView.cardinality, {
  from: "zero_or_many",
  to: "zero_or_one"
});
assert.deepEqual(
  canvasSelectionRuntime.getSqlErdSelectionFromSelectedShapes([
    {
      type: "sqltoerd_relation",
      props: {
        relationId: "relation.orders.user_id.users.id"
      }
    },
    runtimeOrdersShape
  ]),
  { type: "none" }
);

const manualReloadFailureAction =
  sessionStateRuntime.getSqlErdSessionReloadFailureAction({
    fallbackToSampleOnFailure: false
  });

assert.equal(manualReloadFailureAction.kind, "preserve_current");
assert.equal(
  manualReloadFailureAction.sessionLoadState.label,
  "Reload failed"
);
assert.equal(
  manualReloadFailureAction.sessionLoadState.message,
  "Workspace session could not be reloaded. Keep editing the current ERD or try reloading again."
);

const initialReloadFailureAction =
  sessionStateRuntime.getSqlErdSessionReloadFailureAction({
    fallbackToSampleOnFailure: true
  });

assert.equal(initialReloadFailureAction.kind, "fallback_to_sample");
assert.deepEqual(initialReloadFailureAction.selectedSqlErdObject, {
  type: "none"
});
assert.deepEqual(initialReloadFailureAction.sessionLoadState, {
  label: "Sample",
  message: "Workspace session could not be loaded. Showing the built-in sample instead.",
  tone: "neutral"
});
assert.deepEqual(
  sessionStateRuntime.getSqlErdSessionLoadFailureState({
    hasLoadedSession: false
  }),
  {
    label: "Load failed",
    message:
      "Workspace session could not be loaded. Try again or return to the session list.",
    tone: "error"
  }
);
assert.deepEqual(
  sessionStateRuntime.getSqlErdSessionLoadFailureState({
    hasLoadedSession: true
  }),
  manualReloadFailureAction.sessionLoadState
);
assert.equal(
  sessionStateRuntime.shouldApplySqlErdSessionLoadResult(7, 7),
  true
);
assert.equal(
  sessionStateRuntime.shouldApplySqlErdSessionLoadResult(7, 8),
  false
);
assert.equal(
  sessionStateRuntime.isSqlErdAutosaveRequestCurrent({
    currentGeneration: 4,
    currentSessionId: "session-1",
    currentSnapshotSessionId: "session-1",
    requestGeneration: 4,
    requestSessionId: "session-1"
  }),
  true
);
assert.equal(
  sessionStateRuntime.isSqlErdAutosaveRequestCurrent({
    currentGeneration: 5,
    currentSessionId: "session-1",
    currentSnapshotSessionId: "session-1",
    requestGeneration: 4,
    requestSessionId: "session-1"
  }),
  false
);
assert.equal(
  sessionStateRuntime.isSqlErdAutosaveRequestCurrent({
    currentGeneration: 4,
    currentSessionId: "session-2",
    currentSnapshotSessionId: "session-1",
    requestGeneration: 4,
    requestSessionId: "session-1"
  }),
  false
);
let autosaveGateState = {
  activeGeneration: null,
  completionEpoch: 0
};
let autosaveGateTransition = sessionStateRuntime.tryBeginSqlErdAutosave({
  requestGeneration: 1,
  state: autosaveGateState
});
assert.equal(autosaveGateTransition.accepted, true);
autosaveGateState = autosaveGateTransition.state;

autosaveGateTransition = sessionStateRuntime.tryBeginSqlErdAutosave({
  requestGeneration: 1,
  state: autosaveGateState
});
assert.equal(autosaveGateTransition.accepted, false);
autosaveGateState = autosaveGateTransition.state;

autosaveGateTransition = sessionStateRuntime.tryBeginSqlErdAutosave({
  requestGeneration: 2,
  state: autosaveGateState
});
assert.equal(autosaveGateTransition.accepted, true);
autosaveGateState = autosaveGateTransition.state;

let autosaveCompletionTransition =
  sessionStateRuntime.completeSqlErdAutosave({
    requestGeneration: 1,
    state: autosaveGateState
  });
assert.equal(autosaveCompletionTransition.completed, false);
assert.deepEqual(autosaveCompletionTransition.state, {
  activeGeneration: 2,
  completionEpoch: 0
});
autosaveGateState = autosaveCompletionTransition.state;

autosaveCompletionTransition = sessionStateRuntime.completeSqlErdAutosave({
  requestGeneration: 2,
  state: autosaveGateState
});
assert.equal(autosaveCompletionTransition.completed, true);
assert.deepEqual(autosaveCompletionTransition.state, {
  activeGeneration: null,
  completionEpoch: 1
});
assert.equal(
  sessionStateRuntime.getLayoutAutosaveBlockReasonForStatus(409),
  "conflict"
);
assert.equal(
  sessionStateRuntime.getLayoutAutosaveBlockReasonForStatus(401),
  "unauthorized"
);
assert.equal(
  sessionStateRuntime.getLayoutAutosaveBlockReasonForStatus(403),
  "forbidden"
);
assert.equal(
  sessionStateRuntime.getLayoutAutosaveBlockReasonForStatus(404),
  "not_found"
);
assert.equal(
  sessionStateRuntime.getLayoutAutosaveBlockReasonForStatus(400),
  "invalid_payload"
);
assert.equal(
  sessionStateRuntime.getLayoutAutosaveBlockReasonForStatus(413),
  "invalid_payload"
);
assert.equal(
  sessionStateRuntime.getLayoutAutosaveBlockReasonForStatus(418),
  "unknown_non_transient"
);
assert.equal(
  sessionStateRuntime.getLayoutAutosaveBlockReasonForStatus(408),
  null
);
assert.equal(
  sessionStateRuntime.getLayoutAutosaveBlockReasonForStatus(429),
  null
);
assert.equal(
  sessionStateRuntime.getLayoutAutosaveBlockReasonForStatus(500),
  null
);
assert.equal(
  sessionStateRuntime.getLayoutAutosaveBlockReasonForStatus(undefined),
  null
);
assert.equal(sessionStateRuntime.isLayoutAutosaveTransientStatus(500), true);
assert.equal(sessionStateRuntime.isLayoutAutosaveTransientStatus(400), false);
assert.equal(sessionStateRuntime.getLayoutAutosaveDelayMs(0), 2000);
assert.equal(sessionStateRuntime.getLayoutAutosaveDelayMs(1), 4000);
assert.equal(sessionStateRuntime.getLayoutAutosaveDelayMs(4), 30000);
assert.deepEqual(sessionStateRuntime.getLayoutAutosavePausedBanner("conflict"), {
  canRetry: false,
  message: "Workspace session changed. Reload the latest session before saving this layout.",
  reason: "conflict"
});
assert.deepEqual(
  sessionStateRuntime.getLayoutAutosavePausedBanner("unauthorized"),
  {
    canRetry: false,
    message: "Sign in again, then reload this SQLtoERD session.",
    reason: "unauthorized"
  }
);
assert.deepEqual(sessionStateRuntime.getLayoutAutosavePausedBanner("forbidden"), {
  canRetry: false,
  message: "You do not have permission to save this SQLtoERD session.",
  reason: "forbidden"
});
assert.deepEqual(sessionStateRuntime.getLayoutAutosavePausedBanner("not_found"), {
  canRetry: false,
  message: "This SQLtoERD session was deleted or cannot be found. Reload the session.",
  reason: "not_found"
});
assert.deepEqual(
  sessionStateRuntime.getLayoutAutosavePausedBanner("invalid_payload"),
  {
    canRetry: true,
    message: "Current layout payload cannot be autosaved. Try moving a table again or reload the session.",
    reason: "invalid_payload"
  }
);
assert.deepEqual(
  sessionStateRuntime.getLayoutAutosavePausedBanner("unknown_non_transient"),
  {
    canRetry: true,
    message: "Autosave stopped after a non-retryable API error. Retry once or reload the session.",
    reason: "unknown_non_transient"
  }
);

assert.equal(
  statusCopyRuntime.getSqlErdGenerateErrorMessage("EMPTY_SOURCE"),
  "Enter at least one CREATE TABLE statement to generate an ERD."
);
assert.equal(
  statusCopyRuntime.getSqlErdGenerateErrorMessage("UNSUPPORTED_DIALECT"),
  "This SQL dialect is not supported yet. Choose PostgreSQL or MySQL."
);
assert.equal(
  statusCopyRuntime.getSqlErdGenerateErrorMessage("NO_CREATE_TABLE"),
  "SQLtoERD MVP supports CREATE TABLE DDL. Add at least one CREATE TABLE statement."
);
assert.equal(
  statusCopyRuntime.getSqlErdGenerateErrorMessage("PARSE_FAILED"),
  "SQL DDL could not be parsed. Check the CREATE TABLE syntax and try again."
);
assert.deepEqual(statusCopyRuntime.getSqlErdSignInRequiredState(), {
  label: "Sign in",
  message: "Sign in to save this SQLtoERD session in the Workspace.",
  tone: "error"
});
assert.deepEqual(statusCopyRuntime.getSqlErdWorkspaceSaveErrorState(), {
  label: "Save error",
  message:
    "Workspace session could not be autosaved. Check your connection; SQL changes will retry automatically.",
  tone: "error"
});
const fallbackSourceStatus = {
  label: "Workspace",
  message: "Workspace session revision 7",
  tone: "success"
};
assert.deepEqual(
  statusCopyRuntime.getSqlErdSourceStatus({
    fallbackState: fallbackSourceStatus,
    isDraftDirty: false,
    parse: {
      error: null,
      requestSequence: 0,
      status: "idle"
    },
    sourceAutosaveState: "idle"
  }),
  fallbackSourceStatus
);
assert.deepEqual(
  statusCopyRuntime.getSqlErdSourceStatus({
    fallbackState: fallbackSourceStatus,
    isDraftDirty: true,
    parse: {
      error: null,
      requestSequence: 1,
      status: "idle"
    },
    sourceAutosaveState: "saving"
  }),
  {
    label: "Waiting",
    message: "Waiting to parse SQL changes",
    tone: "neutral"
  }
);
const pausedSourceStatus = {
  label: "Autosave paused",
  message: "Reload before saving pending changes.",
  tone: "error"
};
assert.deepEqual(
  statusCopyRuntime.getSqlErdSourceStatus({
    autosaveBlockReason: "invalid_payload",
    fallbackState: pausedSourceStatus,
    isDraftDirty: false,
    parse: {
      error: null,
      requestSequence: 6,
      status: "idle"
    },
    sourceAutosaveState: "pending"
  }),
  pausedSourceStatus
);
const conflictSourceStatus = {
  label: "Save conflict",
  message: "Reload the latest Workspace session.",
  tone: "error"
};
assert.deepEqual(
  statusCopyRuntime.getSqlErdSourceStatus({
    autosaveBlockReason: "conflict",
    fallbackState: conflictSourceStatus,
    isDraftDirty: false,
    parse: {
      error: null,
      requestSequence: 7,
      status: "idle"
    },
    sourceAutosaveState: "pending"
  }),
  conflictSourceStatus
);
assert.deepEqual(
  statusCopyRuntime.getSqlErdSourceStatus({
    autosaveBlockReason: "conflict",
    fallbackState: conflictSourceStatus,
    isDraftDirty: false,
    parse: {
      error: {
        code: "PARSE_FAILED",
        message: "parser detail"
      },
      requestSequence: 8,
      status: "error"
    },
    sourceAutosaveState: "pending"
  }),
  {
    label: "Parse error",
    message:
      "SQL DDL could not be parsed. Check the CREATE TABLE syntax and try again.",
    tone: "error"
  }
);
assert.deepEqual(
  statusCopyRuntime.getSqlErdSourceStatus({
    fallbackState: fallbackSourceStatus,
    isDraftDirty: false,
    parse: {
      error: null,
      requestSequence: 11,
      status: "idle"
    },
    sourceAutosaveState: "retrying"
  }),
  {
    label: "Save error",
    message:
      "Workspace session could not be autosaved. Retrying parsed SQL changes automatically.",
    tone: "error"
  }
);
assert.deepEqual(
  statusCopyRuntime.getSqlErdSourceStatus({
    autosaveBlockReason: "conflict",
    fallbackState: conflictSourceStatus,
    isDraftDirty: false,
    parse: {
      error: null,
      requestSequence: 9,
      status: "parsing"
    },
    sourceAutosaveState: "pending"
  }),
  {
    label: "Parsing",
    message: "Parsing SQL DDL",
    tone: "neutral"
  }
);

const parseWorkerRequest = {
  dialect: "postgresql",
  previousLayoutJson: {
    annotations: {
      links: [],
      version: 1
    },
    tableLayouts: [
      {
        tableId: "table.users",
        width: 320,
        x: 912,
        y: 416
      }
    ],
    version: 1
  },
  sourceMapModelJson: createRuntimeTestModel(),
  requestSequence: 12,
  sessionId: "session-worker-12",
  sourceText: "CREATE TABLE users (id BIGINT PRIMARY KEY);"
};
const parseWorkerResponse =
  parseWorkerProtocolRuntime.executeSqlErdParseWorkerRequest(
    parseWorkerRequest
  );
assert.equal(parseWorkerResponse.ok, true);
assert.equal(parseWorkerResponse.sessionId, parseWorkerRequest.sessionId);
assert.equal(
  parseWorkerResponse.requestSequence,
  parseWorkerRequest.requestSequence
);
assert.equal(parseWorkerResponse.layoutJson.tableLayouts[0].x, 912);
assert.equal(parseWorkerResponse.layoutJson.tableLayouts[0].y, 416);
assert.equal(parseWorkerResponse.sourceMap.dialect, "postgresql");
assert.equal(parseWorkerResponse.sourceMap.columnRangesByTableId["table.users"] !== undefined, true);
assert.deepEqual(
  parseWorkerProtocolRuntime.createSqlErdParseWorkerCancellation(
    parseWorkerRequest
  ),
  {
    cancelled: true,
    ok: false,
    requestSequence: parseWorkerRequest.requestSequence,
    sessionId: parseWorkerRequest.sessionId
  }
);
assert.deepEqual(
  statusCopyRuntime.getSqlErdSourceStatus({
    autosaveBlockReason: "conflict",
    fallbackState: conflictSourceStatus,
    isDraftDirty: true,
    parse: {
      error: null,
      requestSequence: 10,
      status: "idle"
    },
    sourceAutosaveState: "pending"
  }),
  {
    label: "Waiting",
    message: "Waiting to parse SQL changes",
    tone: "neutral"
  }
);
assert.deepEqual(
  statusCopyRuntime.getSqlErdSourceStatus({
    fallbackState: fallbackSourceStatus,
    isDraftDirty: false,
    parse: {
      error: null,
      requestSequence: 2,
      status: "parsing"
    },
    sourceAutosaveState: "pending"
  }),
  {
    label: "Parsing",
    message: "Parsing SQL DDL",
    tone: "neutral"
  }
);
assert.deepEqual(
  statusCopyRuntime.getSqlErdSourceStatus({
    fallbackState: fallbackSourceStatus,
    isDraftDirty: false,
    parse: {
      error: {
        code: "PARSE_FAILED",
        message: "parser detail"
      },
      requestSequence: 3,
      status: "error"
    },
    sourceAutosaveState: "saving"
  }),
  {
    label: "Parse error",
    message:
      "SQL DDL could not be parsed. Check the CREATE TABLE syntax and try again.",
    tone: "error"
  }
);
assert.deepEqual(
  statusCopyRuntime.getSqlErdSourceStatus({
    fallbackState: fallbackSourceStatus,
    isDraftDirty: false,
    parse: {
      error: null,
      requestSequence: 4,
      status: "idle"
    },
    sourceAutosaveState: "pending"
  }),
  {
    label: "Unsaved",
    message: "Parsed SQL changes will autosave",
    tone: "neutral"
  }
);
assert.deepEqual(
  statusCopyRuntime.getSqlErdSourceStatus({
    fallbackState: fallbackSourceStatus,
    isDraftDirty: false,
    parse: {
      error: null,
      requestSequence: 5,
      status: "idle"
    },
    sourceAutosaveState: "saving"
  }),
  {
    label: "Saving",
    message: "Autosaving parsed SQL changes",
    tone: "neutral"
  }
);

const generateSmokeSource = `
CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE posts (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title VARCHAR(120) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`;
const generateSmokeBaseSession = {
  id: null,
  revision: null,
  title: "Generated ERD",
  sourceFormat: "sql",
  dialect: "postgresql",
  sourceText: generateSmokeSource,
  modelJson: createRuntimeTestModel(),
  layoutJson: {
    version: 1,
    tableLayouts: [{ tableId: "table.users", x: 512, y: 256, width: 320 }],
    annotations: {
      version: 1,
      links: [
        {
          id: "annotation.generate.valid",
          kind: "column_link",
          fromTableId: "table.users",
          fromColumnId: "column.users.email",
          toTableId: "table.posts",
          toColumnId: "column.posts.title",
          label: "owns"
        },
        {
          id: "annotation.generate.fk-conflict",
          kind: "column_link",
          fromTableId: "table.posts",
          fromColumnId: "column.posts.user_id",
          toTableId: "table.users",
          toColumnId: "column.users.id",
          label: "same endpoint as FK"
        },
        {
          id: "annotation.generate.removed",
          kind: "table_link",
          fromTableId: "table.users",
          toTableId: "table.removed",
          label: "removed"
        }
      ]
    }
  },
  settingsJson: { sourcePanelOpen: true }
};
const initialSqlEditState =
  sqlEditStateRuntime.createSqlErdEditState(generateSmokeBaseSession);

assert.equal(initialSqlEditState.draftSourceText, generateSmokeSource);
assert.equal(initialSqlEditState.draftDialect, "postgresql");
assert.deepEqual(
  initialSqlEditState.lastSuccessfulSnapshot,
  generateSmokeBaseSession
);
assert.deepEqual(initialSqlEditState.parse, {
  error: null,
  requestSequence: 0,
  status: "idle"
});
assert.equal(sqlEditStateRuntime.SQL_ERD_AUTO_PARSE_DEBOUNCE_MS, 500);
assert.equal(
  sqlEditStateRuntime.isSqlErdDraftDirty(initialSqlEditState),
  false
);
assert.equal(
  sqlEditStateRuntime.shouldScheduleSqlErdAutoParse(initialSqlEditState),
  false
);

const dirtySqlEditState = sqlEditStateRuntime.reduceSqlErdEditState(
  initialSqlEditState,
  {
    type: "draft_source_changed",
    sourceText: "SELECT 1;"
  }
);

assert.equal(dirtySqlEditState.draftSourceText, "SELECT 1;");
assert.equal(
  dirtySqlEditState.lastSuccessfulSnapshot.sourceText,
  generateSmokeSource
);
assert.deepEqual(
  dirtySqlEditState.lastSuccessfulSnapshot.modelJson,
  generateSmokeBaseSession.modelJson
);
assert.equal(dirtySqlEditState.parse.requestSequence, 1);
assert.equal(dirtySqlEditState.parse.status, "idle");
assert.equal(sqlEditStateRuntime.isSqlErdDraftDirty(dirtySqlEditState), true);
assert.equal(
  sqlEditStateRuntime.shouldScheduleSqlErdAutoParse(dirtySqlEditState),
  true
);

const mysqlDraftState = sqlEditStateRuntime.reduceSqlErdEditState(
  dirtySqlEditState,
  {
    type: "draft_dialect_changed",
    dialect: "mysql"
  }
);

assert.equal(mysqlDraftState.draftDialect, "mysql");
assert.equal(mysqlDraftState.lastSuccessfulSnapshot.dialect, "postgresql");

const staleParseStart =
  sqlEditStateRuntime.beginSqlErdParse(mysqlDraftState);

assert.equal(staleParseStart.requestSequence, 3);
assert.equal(staleParseStart.state.parse.status, "parsing");
assert.equal(
  sqlEditStateRuntime.shouldScheduleSqlErdAutoParse(staleParseStart.state),
  false
);
assert.equal(staleParseStart.session.sourceText, "SELECT 1;");
assert.equal(staleParseStart.session.dialect, "mysql");
assert.equal(
  sqlEditStateRuntime.isSqlErdParseRequestCurrent(
    staleParseStart.state,
    staleParseStart.requestSequence
  ),
  true
);

const cancelledParseState = sqlEditStateRuntime.reduceSqlErdEditState(
  staleParseStart.state,
  {
    type: "parse_cancelled"
  }
);

assert.equal(cancelledParseState.parse.status, "cancelled");
assert.equal(cancelledParseState.parse.error, null);
assert.equal(
  cancelledParseState.parse.requestSequence,
  staleParseStart.requestSequence + 1
);
assert.equal(
  sqlEditStateRuntime.shouldScheduleSqlErdAutoParse(cancelledParseState),
  false
);
const resumedParseState = sqlEditStateRuntime.reduceSqlErdEditState(
  cancelledParseState,
  {
    type: "parse_resume_after_cancel"
  }
);

assert.equal(resumedParseState.parse.status, "idle");
assert.equal(resumedParseState.parse.error, null);
assert.equal(
  resumedParseState.parse.requestSequence,
  cancelledParseState.parse.requestSequence + 1
);
assert.equal(
  sqlEditStateRuntime.shouldScheduleSqlErdAutoParse(resumedParseState),
  true
);

const latestDraftState = sqlEditStateRuntime.reduceSqlErdEditState(
  staleParseStart.state,
  {
    type: "draft_source_changed",
    sourceText: "CREATE TABLE latest (id BIGINT PRIMARY KEY);"
  }
);
const staleSuccessSnapshot = {
  ...generateSmokeBaseSession,
  dialect: "mysql",
  sourceText: "CREATE TABLE stale (id BIGINT PRIMARY KEY);"
};
const staleSuccessState = sqlEditStateRuntime.reduceSqlErdEditState(
  latestDraftState,
  {
    type: "parse_succeeded",
    requestLayoutJson: staleParseStart.session.layoutJson,
    requestSequence: staleParseStart.requestSequence,
    snapshot: staleSuccessSnapshot
  }
);
const parseError = {
  code: "NO_CREATE_TABLE",
  message: "No CREATE TABLE statement found"
};
const staleFailureState = sqlEditStateRuntime.reduceSqlErdEditState(
  latestDraftState,
  {
    type: "parse_failed",
    error: parseError,
    requestSequence: staleParseStart.requestSequence
  }
);

assert.strictEqual(staleSuccessState, latestDraftState);
assert.strictEqual(staleFailureState, latestDraftState);
assert.equal(
  sqlEditStateRuntime.isSqlErdParseRequestCurrent(
    latestDraftState,
    staleParseStart.requestSequence
  ),
  false
);

const latestParseStart =
  sqlEditStateRuntime.beginSqlErdParse(latestDraftState);
const latestParseFailureState = sqlEditStateRuntime.reduceSqlErdEditState(
  latestParseStart.state,
  {
    type: "parse_failed",
    error: parseError,
    requestSequence: latestParseStart.requestSequence
  }
);

assert.equal(latestParseFailureState.parse.status, "error");
assert.deepEqual(latestParseFailureState.parse.error, parseError);
assert.equal(
  latestParseFailureState.draftSourceText,
  "CREATE TABLE latest (id BIGINT PRIMARY KEY);"
);
assert.equal(
  latestParseFailureState.lastSuccessfulSnapshot.sourceText,
  generateSmokeSource
);
assert.equal(
  sqlEditStateRuntime.shouldScheduleSqlErdAutoParse(
    latestParseFailureState
  ),
  false
);

const layoutChangedAfterParseError = sqlEditStateRuntime.reduceSqlErdEditState(
  latestParseFailureState,
  {
    type: "layout_changed",
    layoutJson: {
      version: 1,
      tableLayouts: [{ tableId: "table.users", x: 640, y: 320 }]
    }
  }
);

assert.equal(layoutChangedAfterParseError.parse.status, "error");
assert.equal(
  sqlEditStateRuntime.shouldScheduleSqlErdAutoParse(
    layoutChangedAfterParseError
  ),
  false
);

const dialectChangedAfterParseError =
  sqlEditStateRuntime.reduceSqlErdEditState(layoutChangedAfterParseError, {
    type: "draft_dialect_changed",
    dialect: "postgresql"
  });

assert.equal(dialectChangedAfterParseError.parse.status, "idle");
assert.equal(
  sqlEditStateRuntime.shouldScheduleSqlErdAutoParse(
    dialectChangedAfterParseError
  ),
  true
);

const successfulParseStart =
  sqlEditStateRuntime.beginSqlErdParse(latestParseFailureState);
const successfulSnapshot = {
  ...successfulParseStart.session,
  id: "session-success",
  revision: 8
};
const successfulSqlEditState = sqlEditStateRuntime.reduceSqlErdEditState(
  successfulParseStart.state,
  {
    type: "parse_succeeded",
    requestLayoutJson: successfulParseStart.session.layoutJson,
    requestSequence: successfulParseStart.requestSequence,
    snapshot: successfulSnapshot
  }
);

assert.equal(successfulSqlEditState.parse.status, "idle");
assert.equal(successfulSqlEditState.parse.error, null);
assert.equal(
  successfulSqlEditState.draftSourceText,
  successfulSnapshot.sourceText
);
assert.equal(successfulSqlEditState.draftDialect, successfulSnapshot.dialect);
assert.deepEqual(
  successfulSqlEditState.lastSuccessfulSnapshot,
  successfulSnapshot
);
const normalizedSqlSnapshot = {
  ...successfulSnapshot,
  modelJson: structuredClone(successfulSnapshot.modelJson),
  sourceText: "CREATE TABLE normalized_users (id BIGINT PRIMARY KEY);"
};
const normalizedSqlAppliedState = sqlEditStateRuntime.reduceSqlErdEditState(
  successfulSqlEditState,
  {
    baseSnapshot: successfulSnapshot,
    snapshot: normalizedSqlSnapshot,
    type: "normalized_sql_applied"
  }
);
assert.equal(
  normalizedSqlAppliedState.lastSuccessfulSnapshot.sourceText,
  normalizedSqlSnapshot.sourceText
);
assert.equal(
  normalizedSqlAppliedState.draftSourceText,
  normalizedSqlSnapshot.sourceText
);
assert.equal(normalizedSqlAppliedState.parse.status, "idle");
assert.strictEqual(
  sqlEditStateRuntime.reduceSqlErdEditState(successfulSqlEditState, {
    baseSnapshot: { ...successfulSnapshot, revision: 7 },
    snapshot: normalizedSqlSnapshot,
    type: "normalized_sql_applied"
  }),
  successfulSqlEditState
);

const locallyChangedLayout = {
  version: 1,
  tableLayouts: [{ tableId: "table.users", x: 800, y: 400 }]
};
const layoutDuringGenerateParseStart =
  sqlEditStateRuntime.beginSqlErdParse(successfulSqlEditState);
const layoutChangedDuringGenerateState =
  sqlEditStateRuntime.reduceSqlErdEditState(
    layoutDuringGenerateParseStart.state,
    {
      type: "layout_changed",
      layoutJson: locallyChangedLayout
    }
  );
const layoutGenerateSavedSnapshot = {
  ...layoutDuringGenerateParseStart.session,
  revision: 9
};
const layoutPreservedAfterGenerateState =
  sqlEditStateRuntime.reduceSqlErdEditState(
    layoutChangedDuringGenerateState,
    {
      type: "parse_succeeded",
      requestLayoutJson: layoutDuringGenerateParseStart.session.layoutJson,
      requestSequence: layoutDuringGenerateParseStart.requestSequence,
      snapshot: layoutGenerateSavedSnapshot
    }
  );

assert.equal(
  layoutPreservedAfterGenerateState.lastSuccessfulSnapshot.revision,
  9
);
assert.deepEqual(
  layoutPreservedAfterGenerateState.lastSuccessfulSnapshot.layoutJson,
  locallyChangedLayout
);

const layoutChangedSqlEditState = sqlEditStateRuntime.reduceSqlErdEditState(
  latestParseFailureState,
  {
    type: "layout_changed",
    layoutJson: locallyChangedLayout
  }
);

assert.equal(
  layoutChangedSqlEditState.draftSourceText,
  latestParseFailureState.draftSourceText
);
assert.equal(
  layoutChangedSqlEditState.lastSuccessfulSnapshot.sourceText,
  generateSmokeSource
);
assert.deepEqual(
  layoutChangedSqlEditState.lastSuccessfulSnapshot.layoutJson,
  locallyChangedLayout
);

const loadedSnapshot = {
  ...generateSmokeBaseSession,
  id: "session-loaded",
  revision: 13,
  sourceText: "CREATE TABLE loaded (id BIGINT PRIMARY KEY);"
};
const loadedSqlEditState = sqlEditStateRuntime.reduceSqlErdEditState(
  latestParseFailureState,
  {
    type: "session_loaded",
    snapshot: loadedSnapshot
  }
);

assert.equal(loadedSqlEditState.draftSourceText, loadedSnapshot.sourceText);
assert.equal(loadedSqlEditState.draftDialect, loadedSnapshot.dialect);
assert.deepEqual(loadedSqlEditState.lastSuccessfulSnapshot, loadedSnapshot);
assert.equal(
  loadedSqlEditState.parse.requestSequence,
  latestParseFailureState.parse.requestSequence + 1
);
assert.equal(loadedSqlEditState.parse.status, "idle");

const invalidReloadDraftState = sqlEditStateRuntime.reduceSqlErdEditState(
  loadedSqlEditState,
  {
    type: "draft_source_changed",
    sourceText: "CREATE TABLE broken ("
  }
);
const invalidReloadParseStart =
  sqlEditStateRuntime.beginSqlErdParse(invalidReloadDraftState);
const invalidReloadParseFailureState =
  sqlEditStateRuntime.reduceSqlErdEditState(invalidReloadParseStart.state, {
    type: "parse_failed",
    requestSequence: invalidReloadParseStart.requestSequence,
    error: {
      code: "PARSE_FAILED",
      message: "Expected a column definition."
    }
  });
const refreshedAfterParseErrorSnapshot = {
  ...loadedSnapshot,
  revision: 14,
  sourceText: "CREATE TABLE server_refresh (id BIGINT PRIMARY KEY);"
};
const refreshedAfterParseErrorState =
  sqlEditStateRuntime.reduceSqlErdEditState(
    invalidReloadParseFailureState,
    {
      type: "session_loaded",
      snapshot: refreshedAfterParseErrorSnapshot
    }
  );

assert.equal(
  refreshedAfterParseErrorState.draftSourceText,
  invalidReloadParseFailureState.draftSourceText
);
assert.deepEqual(
  refreshedAfterParseErrorState.lastSuccessfulSnapshot,
  refreshedAfterParseErrorSnapshot
);
assert.deepEqual(
  refreshedAfterParseErrorState.parse,
  invalidReloadParseFailureState.parse
);
assert.equal(
  sqlEditStateRuntime.shouldScheduleSqlErdAutoParse(
    refreshedAfterParseErrorState
  ),
  false
);

const refreshedCleanSameSessionState =
  sqlEditStateRuntime.reduceSqlErdEditState(loadedSqlEditState, {
    type: "session_loaded",
    snapshot: refreshedAfterParseErrorSnapshot
  });

assert.equal(refreshedCleanSameSessionState.parse.status, "idle");
assert.equal(
  refreshedCleanSameSessionState.draftSourceText,
  refreshedAfterParseErrorSnapshot.sourceText
);

const dirtyLoadedSqlEditState = sqlEditStateRuntime.reduceSqlErdEditState(
  sqlEditStateRuntime.reduceSqlErdEditState(loadedSqlEditState, {
    type: "draft_source_changed",
    sourceText: "CREATE TABLE local_draft (id BIGINT PRIMARY KEY);"
  }),
  {
    type: "draft_dialect_changed",
    dialect: "mysql"
  }
);
const refreshedSameSessionSnapshot = {
  ...loadedSnapshot,
  revision: 14,
  sourceText: "CREATE TABLE server_refresh (id BIGINT PRIMARY KEY);"
};
const refreshedDirtySqlEditState = sqlEditStateRuntime.reduceSqlErdEditState(
  dirtyLoadedSqlEditState,
  {
    type: "session_loaded",
    snapshot: refreshedSameSessionSnapshot
  }
);

assert.equal(
  refreshedDirtySqlEditState.draftSourceText,
  dirtyLoadedSqlEditState.draftSourceText
);
assert.equal(
  refreshedDirtySqlEditState.draftDialect,
  dirtyLoadedSqlEditState.draftDialect
);
assert.deepEqual(
  refreshedDirtySqlEditState.lastSuccessfulSnapshot,
  refreshedSameSessionSnapshot
);

const pendingLayoutSnapshot = {
  ...loadedSnapshot,
  layoutJson: locallyChangedLayout
};
const pendingLayoutState = {
  ...loadedSqlEditState,
  draftSourceText: "SELECT broken draft;",
  lastSuccessfulSnapshot: pendingLayoutSnapshot
};
const savedLayoutSnapshot = {
  ...pendingLayoutSnapshot,
  revision: 14,
  layoutJson: {
    ...locallyChangedLayout,
    viewport: { x: 10, y: 20, zoom: 1.5 }
  }
};
const savedLayoutState = sqlEditStateRuntime.reduceSqlErdEditState(
  pendingLayoutState,
  {
    type: "layout_saved",
    requestLayoutJson: locallyChangedLayout,
    snapshot: savedLayoutSnapshot
  }
);

assert.equal(savedLayoutState.draftSourceText, "SELECT broken draft;");
assert.equal(savedLayoutState.lastSuccessfulSnapshot.revision, 14);
assert.deepEqual(
  savedLayoutState.lastSuccessfulSnapshot.layoutJson,
  savedLayoutSnapshot.layoutJson
);

const newerLayout = {
  version: 1,
  tableLayouts: [{ tableId: "table.users", x: 900, y: 450 }]
};
const newerLayoutState = {
  ...pendingLayoutState,
  lastSuccessfulSnapshot: {
    ...pendingLayoutSnapshot,
    layoutJson: newerLayout
  }
};
const preservedNewerLayoutState = sqlEditStateRuntime.reduceSqlErdEditState(
  newerLayoutState,
  {
    type: "layout_saved",
    requestLayoutJson: locallyChangedLayout,
    snapshot: savedLayoutSnapshot
  }
);

assert.equal(preservedNewerLayoutState.lastSuccessfulSnapshot.revision, 14);
assert.deepEqual(
  preservedNewerLayoutState.lastSuccessfulSnapshot.layoutJson,
  newerLayout
);

const monotonicLayoutState = {
  ...newerLayoutState,
  lastSuccessfulSnapshot: {
    ...newerLayoutState.lastSuccessfulSnapshot,
    revision: 20
  }
};
for (const staleRevision of [null, 19, 20]) {
  const ignoredStaleLayoutState =
    sqlEditStateRuntime.reduceSqlErdEditState(monotonicLayoutState, {
      requestLayoutJson: newerLayout,
      snapshot: {
        ...monotonicLayoutState.lastSuccessfulSnapshot,
        layoutJson: locallyChangedLayout,
        revision: staleRevision
      },
      type: "layout_saved"
    });

  assert.strictEqual(ignoredStaleLayoutState, monotonicLayoutState);
  assert.equal(
    ignoredStaleLayoutState.lastSuccessfulSnapshot.revision,
    20
  );
  assert.deepEqual(
    ignoredStaleLayoutState.lastSuccessfulSnapshot.layoutJson,
    newerLayout
  );
}

const newestParsedModel = createRuntimeTestModel();
const staleSourceSaveCurrentState = {
  ...newerLayoutState,
  draftDialect: "postgresql",
  draftSourceText: "CREATE TABLE newest_draft (id BIGINT PRIMARY KEY);",
  lastSuccessfulSnapshot: {
    ...newerLayoutState.lastSuccessfulSnapshot,
    dialect: "postgresql",
    modelJson: newestParsedModel,
    revision: 14,
    sourceText: "CREATE TABLE newest_parsed (id BIGINT PRIMARY KEY);"
  }
};
const staleSourceSavedSnapshot = {
  ...savedLayoutSnapshot,
  dialect: "mysql",
  modelJson: generateSmokeBaseSession.modelJson,
  revision: 15,
  sourceText: "CREATE TABLE stale_saved (id BIGINT PRIMARY KEY);"
};
const revisionAdvancedAfterStaleSourceSave =
  sqlEditStateRuntime.reduceSqlErdEditState(staleSourceSaveCurrentState, {
    type: "source_autosave_saved",
    snapshot: staleSourceSavedSnapshot
  });

assert.deepEqual(revisionAdvancedAfterStaleSourceSave, {
  ...staleSourceSaveCurrentState,
  lastSuccessfulSnapshot: {
    ...staleSourceSaveCurrentState.lastSuccessfulSnapshot,
    revision: 15
  }
});

const mismatchedSourceSaveState = sqlEditStateRuntime.reduceSqlErdEditState(
  staleSourceSaveCurrentState,
  {
    type: "source_autosave_saved",
    snapshot: {
      ...staleSourceSavedSnapshot,
      id: "another-session"
    }
  }
);

assert.strictEqual(mismatchedSourceSaveState, staleSourceSaveCurrentState);

const nonAdvancingSourceSaveState = sqlEditStateRuntime.reduceSqlErdEditState(
  staleSourceSaveCurrentState,
  {
    type: "source_autosave_saved",
    snapshot: {
      ...staleSourceSavedSnapshot,
      revision: 14
    }
  }
);

assert.strictEqual(nonAdvancingSourceSaveState, staleSourceSaveCurrentState);
const createGenerateRequest =
  generateSessionRuntime.createSqlErdGenerateWorkspaceRequest(
    generateSmokeBaseSession
  );

assert.equal(createGenerateRequest.ok, true);
assert.equal(createGenerateRequest.kind, "create");
assert.equal(createGenerateRequest.resolvedDialect, "postgresql");
assert.equal(createGenerateRequest.payload.title, "Generated ERD");
assert.equal(createGenerateRequest.payload.sourceText, generateSmokeSource);
assert.equal(createGenerateRequest.payload.dialect, "postgresql");
assert.equal(createGenerateRequest.payload.modelJson.schema.tables.length, 2);
assert.equal(createGenerateRequest.payload.modelJson.schema.relations.length, 1);
assert.deepEqual(createGenerateRequest.payload.layoutJson.tableLayouts[0], {
  tableId: "table.users",
  x: 512,
  y: 256,
  width: 320
});
assert.equal(
  createGenerateRequest.payload.layoutJson.tableLayouts[1].tableId,
  "table.posts"
);
assert.deepEqual(createGenerateRequest.payload.layoutJson.annotations, {
  version: 1,
  links: generateSmokeBaseSession.layoutJson.annotations.links.slice(0, 2)
});
assert.deepEqual(createGenerateRequest.payload.settingsJson, {
  sourcePanelOpen: true
});
assert.equal(createGenerateRequest.sourceMap.sourceText, generateSmokeSource);
assert.equal(createGenerateRequest.sourceMap.dialect, "postgresql");
assert.equal("sourceMap" in createGenerateRequest.payload, false);

const updateGenerateRequest =
  generateSessionRuntime.createSqlErdGenerateWorkspaceRequest({
    ...generateSmokeBaseSession,
    id: "session-1",
    revision: 7
  });

assert.equal(updateGenerateRequest.ok, true);
assert.equal(updateGenerateRequest.kind, "update");
assert.equal(updateGenerateRequest.sessionId, "session-1");
assert.equal(updateGenerateRequest.payload.baseRevision, 7);
assert.equal(updateGenerateRequest.payload.modelJson.schema.tables.length, 2);

const invalidGenerateRequest =
  generateSessionRuntime.createSqlErdGenerateWorkspaceRequest({
    ...generateSmokeBaseSession,
    sourceText: "SELECT 1;"
  });

assert.equal(invalidGenerateRequest.ok, false);
assert.equal(invalidGenerateRequest.error.code, "NO_CREATE_TABLE");

const autosaveLayoutJson = {
  version: 1,
  tableLayouts: [
    { tableId: "table.users", x: 720, y: 360, width: 320 },
    { tableId: "table.posts", x: 1080, y: 360 }
  ]
};
const layoutAutosaveRequest =
  layoutAutosaveRuntime.createSqlErdLayoutAutosaveRequest(
    {
      ...generateSmokeBaseSession,
      id: "session-2",
      revision: 12
    },
    autosaveLayoutJson
  );

assert.equal(layoutAutosaveRequest.ok, true);
assert.equal(layoutAutosaveRequest.sessionId, "session-2");
assert.deepEqual(layoutAutosaveRequest.payload, {
  baseRevision: 12,
  layoutJson: autosaveLayoutJson
});
assert.equal(Object.hasOwn(layoutAutosaveRequest.payload, "sourceText"), false);
assert.equal(Object.hasOwn(layoutAutosaveRequest.payload, "modelJson"), false);
assert.equal(Object.hasOwn(layoutAutosaveRequest.payload, "settingsJson"), false);

const sampleLayoutAutosaveRequest =
  layoutAutosaveRuntime.createSqlErdLayoutAutosaveRequest(
    generateSmokeBaseSession,
    autosaveLayoutJson
  );

assert.equal(sampleLayoutAutosaveRequest.ok, false);
assert.equal(
  sampleLayoutAutosaveRequest.reason,
  "missing_workspace_session"
);

const missingRevisionLayoutAutosaveRequest =
  layoutAutosaveRuntime.createSqlErdLayoutAutosaveRequest(
    {
      ...generateSmokeBaseSession,
      id: "session-3",
      revision: null
    },
    autosaveLayoutJson
  );

assert.equal(missingRevisionLayoutAutosaveRequest.ok, false);
assert.equal(
  missingRevisionLayoutAutosaveRequest.reason,
  "missing_workspace_session"
);

const parsedSourceSnapshot = {
  ...generateSmokeBaseSession,
  dialect: "mysql",
  id: "session-source-autosave",
  layoutJson: {
    version: 1,
    tableLayouts: [{ tableId: "table.users", x: 120, y: 60 }]
  },
  modelJson: createRuntimeTestModel(),
  revision: 20,
  sourceText: "CREATE TABLE parsed_source (id BIGINT PRIMARY KEY);"
};
const currentSourceAutosaveSession = {
  ...parsedSourceSnapshot,
  layoutJson: autosaveLayoutJson,
  revision: 21
};
const sourceAutosaveRequest =
  layoutAutosaveRuntime.createSqlErdSourceAutosaveRequest(
    parsedSourceSnapshot,
    currentSourceAutosaveSession
  );

assert.equal(sourceAutosaveRequest.ok, true);
assert.equal(sourceAutosaveRequest.sessionId, "session-source-autosave");
assert.deepEqual(sourceAutosaveRequest.payload, {
  baseRevision: 21,
  dialect: "mysql",
  layoutJson: autosaveLayoutJson,
  modelJson: parsedSourceSnapshot.modelJson,
  sourceText: parsedSourceSnapshot.sourceText
});
assert.equal(Object.hasOwn(sourceAutosaveRequest.payload, "title"), false);
assert.equal(
  Object.hasOwn(sourceAutosaveRequest.payload, "settingsJson"),
  false
);

const mismatchedSourceAutosaveRequest =
  layoutAutosaveRuntime.createSqlErdSourceAutosaveRequest(
    parsedSourceSnapshot,
    {
      ...currentSourceAutosaveSession,
      id: "another-session"
    }
  );

assert.equal(mismatchedSourceAutosaveRequest.ok, false);
assert.equal(mismatchedSourceAutosaveRequest.reason, "session_mismatch");

const sampleSourceAutosaveRequest =
  layoutAutosaveRuntime.createSqlErdSourceAutosaveRequest(
    parsedSourceSnapshot,
    {
      ...currentSourceAutosaveSession,
      id: null,
      revision: null
    }
  );

assert.equal(sampleSourceAutosaveRequest.ok, false);
assert.equal(
  sampleSourceAutosaveRequest.reason,
  "missing_workspace_session"
);

const runtimeSession = createRuntimeTestSession({
  createdBy: null,
  updatedBy: null
});
const runtimeSessionSummary = {
  id: runtimeSession.id,
  workspaceId: runtimeSession.workspaceId,
  title: runtimeSession.title,
  sourceFormat: runtimeSession.sourceFormat,
  dialect: runtimeSession.dialect,
  tableCount: runtimeSession.tableCount,
  relationCount: runtimeSession.relationCount,
  revision: runtimeSession.revision,
  createdBy: runtimeSession.createdBy,
  updatedBy: runtimeSession.updatedBy,
  createdAt: runtimeSession.createdAt,
  updatedAt: runtimeSession.updatedAt
};

assert.equal(
  sessionNavigationRuntime.buildSqlErdSessionHref("session 1"),
  "/sql-erd/session?sessionId=session+1"
);
assert.equal(
  sessionNavigationRuntime.readSqlErdSessionId("?sessionId=session%201"),
  "session 1"
);
assert.equal(sessionNavigationRuntime.readSqlErdSessionId("?sessionId=%20"), null);
assert.equal(
  sessionListStateRuntime.getSqlErdSessionListViewState({
    errorMessage: "Session 목록을 불러오지 못했습니다.",
    hasLoadedSessions: false,
    isLoading: false,
    sessionCount: 0
  }),
  "error"
);
assert.equal(
  sessionListStateRuntime.getSqlErdSessionListViewState({
    errorMessage: null,
    hasLoadedSessions: true,
    isLoading: false,
    sessionCount: 0
  }),
  "empty"
);
assert.equal(
  sessionListStateRuntime.getSqlErdSessionListViewState({
    errorMessage: null,
    hasLoadedSessions: true,
    isLoading: true,
    sessionCount: 0
  }),
  "loading"
);
assert.deepEqual(
  sessionListStateRuntime.removeSqlErdSession(
    [{ id: "session-1" }, { id: "session-2" }],
    "session-1"
  ),
  [{ id: "session-2" }]
);

const listSqlErdSessionRequests = [];
const listSqlErdSessionClient = apiClientRuntime.createSqlErdApiClient({
  accessToken: "token-1",
  baseUrl: "https://api.example.test/api/v1/",
  fetcher: async (url, init) => {
    listSqlErdSessionRequests.push({ init, url });

    return new Response(
      JSON.stringify({
        success: true,
        data: { items: [runtimeSessionSummary], nextCursor: "cursor-2" }
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200
      }
    );
  }
});

const listedSessions = await listSqlErdSessionClient.listSessions(
  "workspace 1",
  { cursor: "cursor value", limit: 20 }
);

assert.deepEqual(listedSessions.items, [runtimeSessionSummary]);
assert.equal(listedSessions.nextCursor, "cursor-2");
assert.equal(listSqlErdSessionRequests.length, 1);
assert.equal(
  listSqlErdSessionRequests[0].url,
  "https://api.example.test/api/v1/workspaces/workspace%201/sql-erd-sessions?limit=20&cursor=cursor+value"
);
assert.equal(listSqlErdSessionRequests[0].init.method, "GET");
assert.equal(listSqlErdSessionRequests[0].init.credentials, "same-origin");
assert.equal(
  listSqlErdSessionRequests[0].init.headers.Authorization,
  "Bearer token-1"
);

const detailSqlErdSessionRequests = [];
const detailSqlErdSessionClient = apiClientRuntime.createSqlErdApiClient({
  fetcher: async (url, init) => {
    detailSqlErdSessionRequests.push({ init, url });

    return new Response(
      JSON.stringify({ success: true, data: runtimeSession }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  }
});

assert.deepEqual(
  await detailSqlErdSessionClient.getSession("workspace 1", "session 1"),
  runtimeSession
);
assert.equal(
  detailSqlErdSessionRequests[0].url,
  "http://localhost:4000/api/v1/workspaces/workspace%201/sql-erd-sessions/session%201"
);

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
  "https://api.example.test/api/v1/workspaces/workspace%201/sql-erd-sessions"
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
  "http://localhost:4000/api/v1/workspaces/workspace%201/sql-erd-sessions/session%201"
);
assert.equal(updateSqlErdSessionRequests[0].init.method, "PATCH");
assert.deepEqual(
  JSON.parse(updateSqlErdSessionRequests[0].init.body),
  updateSessionPayload
);

const deleteSqlErdSessionRequests = [];
const deleteSqlErdSessionClient = apiClientRuntime.createSqlErdApiClient({
  fetcher: async (url, init) => {
    deleteSqlErdSessionRequests.push({ init, url });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          id: "session 1",
          deletedAt: "2026-07-10T15:00:00.000Z",
          revision: 4
        }
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  }
});

const deletedSqlErdSession = await deleteSqlErdSessionClient.deleteSession(
  "workspace 1",
  "session 1",
  3
);

assert.equal(deletedSqlErdSession.revision, 4);
assert.equal(
  deleteSqlErdSessionRequests[0].url,
  "http://localhost:4000/api/v1/workspaces/workspace%201/sql-erd-sessions/session%201?baseRevision=3"
);
assert.equal(deleteSqlErdSessionRequests[0].init.method, "DELETE");

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
  () => failingSqlErdApiClient.getSession("workspace-1", "session-1"),
  /Unauthorized/
);

const postgresSourceText = `CREATE TABLE users (
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
);`;
const postgresParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "postgresql",
  sourceText: postgresSourceText
});

assert.equal(postgresParseResult.ok, true);
assert.equal(postgresParseResult.resolvedDialect, "postgresql");
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
assert.equal(postgresParseResult.sourceMap.sourceText, postgresSourceText);
assert.equal(postgresParseResult.sourceMap.dialect, "postgresql");
assert.equal(
  postgresSourceText.slice(
    postgresParseResult.sourceMap.columnRangesByTableId["table.users"][
      "column.users.id"
    ].from,
    postgresParseResult.sourceMap.columnRangesByTableId["table.users"][
      "column.users.id"
    ].to
  ),
  "id"
);
assert.equal(
  postgresSourceText.slice(
    postgresParseResult.sourceMap.columnRangesByTableId["table.orders"][
      "column.orders.id"
    ].from,
    postgresParseResult.sourceMap.columnRangesByTableId["table.orders"][
      "column.orders.id"
    ].to
  ),
  "id"
);
assert.notEqual(
  postgresParseResult.sourceMap.columnRangesByTableId["table.users"][
    "column.users.id"
  ].from,
  postgresParseResult.sourceMap.columnRangesByTableId["table.orders"][
    "column.orders.id"
  ].from
);
const postgresTableRelationRange =
  postgresParseResult.sourceMap.relationsById[
    "relation.orders.user_id.users.id"
  ];
assert.equal(
  postgresSourceText.slice(
    postgresTableRelationRange.constraintRange.from,
    postgresTableRelationRange.constraintRange.to
  ),
  "CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)"
);
assert.deepEqual(
  postgresTableRelationRange.fromColumnRanges.map((range) =>
    postgresSourceText.slice(range.from, range.to)
  ),
  ["user_id"]
);
assert.deepEqual(
  postgresTableRelationRange.toColumnRanges.map((range) =>
    postgresSourceText.slice(range.from, range.to)
  ),
  ["id"]
);
const postgresInlineRelationRange =
  postgresParseResult.sourceMap.relationsById[
    "relation.reviews.user_id.users.id"
  ];
assert.equal(
  postgresSourceText.slice(
    postgresInlineRelationRange.constraintRange.from,
    postgresInlineRelationRange.constraintRange.to
  ),
  "REFERENCES users(id)"
);
const selectedPostgresRelationRanges =
  sqlSourceMapRuntime.getSelectedSqlErdRelationSourceRanges({
    selection: {
      type: "relation",
      relationId: "relation.orders.user_id.users.id"
    },
    sourceMap: postgresParseResult.sourceMap,
    sourceText: postgresSourceText
  });
assert.deepEqual(
  selectedPostgresRelationRanges.map((range) =>
    postgresSourceText.slice(range.from, range.to)
  ),
  [
    "user_id",
    "id",
    "CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)"
  ]
);
const storedStableIdModel = createRuntimeModelWithStableIdPrefix(
  postgresParseResult.modelJson,
  "stored."
);
const storedStableIdParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "postgresql",
  sourceMapModelJson: storedStableIdModel,
  sourceText: postgresSourceText
});

assert.equal(storedStableIdParseResult.ok, true);
assert.deepEqual(
  Object.keys(storedStableIdParseResult.sourceMap.relationsById),
  [
    "stored.relation.orders.user_id.users.id",
    "stored.relation.reviews.user_id.users.id"
  ]
);
const storedStableIdSelectedRanges =
  sqlSourceMapRuntime.getSelectedSqlErdRelationSourceRanges({
    selection: {
      type: "relation",
      relationId: "stored.relation.orders.user_id.users.id"
    },
    sourceMap: storedStableIdParseResult.sourceMap,
    sourceText: postgresSourceText
  });
assert.deepEqual(
  storedStableIdSelectedRanges.map((range) =>
    postgresSourceText.slice(range.from, range.to)
  ),
  [
    "user_id",
    "id",
    "CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)"
  ]
);
const tableScopedColumnIdSourceText = `CREATE TABLE parents (
  id BIGINT PRIMARY KEY
);

CREATE TABLE children (
  id BIGINT PRIMARY KEY,
  parent_id BIGINT NOT NULL,
  CONSTRAINT fk_children_parent FOREIGN KEY (parent_id) REFERENCES parents(id)
);`;
const tableScopedColumnIdParseResult =
  ddlParserRuntime.parseSqlDdlToErdModel({
    dialect: "postgresql",
    sourceText: tableScopedColumnIdSourceText
  });

assert.equal(tableScopedColumnIdParseResult.ok, true);
const tableScopedColumnIdModel = createRuntimeModelWithStableIdPrefix(
  tableScopedColumnIdParseResult.modelJson,
  "stored."
);
const tableScopedParents = tableScopedColumnIdModel.schema.tables.find(
  (table) => table.name === "parents"
);
const tableScopedChildren = tableScopedColumnIdModel.schema.tables.find(
  (table) => table.name === "children"
);
const tableScopedRelation = tableScopedColumnIdModel.schema.relations[0];
const originalParentColumnId = tableScopedParents.columns[0].id;
const originalChildColumnId = tableScopedChildren.columns[1].id;

tableScopedParents.columns[0].id = "shared-column-id";
tableScopedParents.constraints[0].columnIds = ["shared-column-id"];
tableScopedChildren.columns[1].id = "shared-column-id";
tableScopedRelation.fromColumnIds = ["shared-column-id"];
tableScopedRelation.toColumnIds = ["shared-column-id"];

assert.notEqual(originalParentColumnId, originalChildColumnId);
const tableScopedColumnIdSourceMap =
  sqlSourceMapRuntime.createSqltoerdSourceMap({
    dialect: "postgresql",
    modelJson: tableScopedColumnIdModel,
    sourceText: tableScopedColumnIdSourceText
  });
const tableScopedColumnIdRelationRange =
  tableScopedColumnIdSourceMap.relationsById[
    "stored.relation.children.parent_id.parents.id"
  ];

assert.deepEqual(
  tableScopedColumnIdRelationRange.fromColumnRanges.map((range) =>
    tableScopedColumnIdSourceText.slice(range.from, range.to)
  ),
  ["parent_id"]
);
assert.deepEqual(
  tableScopedColumnIdRelationRange.toColumnRanges.map((range) =>
    tableScopedColumnIdSourceText.slice(range.from, range.to)
  ),
  ["id"]
);
const runtimeRelationDecorations =
  sqlSourceDecorationRuntime.createSqlErdRelationSourceDecorations(
    [
      ...selectedPostgresRelationRanges,
      selectedPostgresRelationRanges[0],
      { from: -1, to: 3 },
      { from: 0, to: postgresSourceText.length + 1 }
    ],
    postgresSourceText.length
  );
const runtimeRelationDecorationRanges = [];
runtimeRelationDecorations.between(
  0,
  postgresSourceText.length,
  (from, to, decoration) => {
    runtimeRelationDecorationRanges.push({
      className: decoration.spec.class,
      from,
      to
    });
  }
);
assert.deepEqual(
  runtimeRelationDecorationRanges.map(({ from, to }) => ({ from, to })),
  [...selectedPostgresRelationRanges].sort(
    (left, right) => left.from - right.from || left.to - right.to
  )
);
assert.equal(
  runtimeRelationDecorationRanges.every(
    ({ className }) => className === "cm-sqltoerd-relation-source"
  ),
  true
);
const runtimeRelationCompartment = new Compartment();
let runtimeRelationEditorState = EditorState.create({
  doc: postgresSourceText,
  selection: { anchor: postgresSourceText.indexOf("user_id") },
  extensions: [
    history(),
    runtimeRelationCompartment.of(
      sqlSourceDecorationRuntime.createSqlErdRelationSourceDecorationExtension(
        [],
        postgresSourceText.length
      )
    )
  ]
});
runtimeRelationEditorState = runtimeRelationEditorState.update({
  changes: { from: postgresSourceText.length, insert: "\n" },
  selection: { anchor: postgresSourceText.indexOf("orders") },
  userEvent: "input"
}).state;
const runtimeRelationDocument = runtimeRelationEditorState.doc.toString();
const runtimeRelationSelection = runtimeRelationEditorState.selection.main;
const runtimeRelationUndoDepth = undoDepth(runtimeRelationEditorState);

runtimeRelationEditorState = runtimeRelationEditorState.update({
  effects: runtimeRelationCompartment.reconfigure(
    sqlSourceDecorationRuntime.createSqlErdRelationSourceDecorationExtension(
      selectedPostgresRelationRanges,
      runtimeRelationEditorState.doc.length
    )
  )
}).state;

assert.equal(runtimeRelationEditorState.doc.toString(), runtimeRelationDocument);
assert.deepEqual(runtimeRelationEditorState.selection.main, runtimeRelationSelection);
assert.equal(undoDepth(runtimeRelationEditorState), runtimeRelationUndoDepth);
assert.deepEqual(
  sqlSourceMapRuntime.getSelectedSqlErdRelationSourceRanges({
    selection: { type: "none" },
    sourceMap: postgresParseResult.sourceMap,
    sourceText: postgresSourceText
  }),
  []
);
assert.deepEqual(
  sqlSourceMapRuntime.getSelectedSqlErdRelationSourceRanges({
    selection: { type: "relation", relationId: "relation.missing" },
    sourceMap: postgresParseResult.sourceMap,
    sourceText: postgresSourceText
  }),
  []
);
assert.deepEqual(
  sqlSourceMapRuntime.getSelectedSqlErdRelationSourceRanges({
    selection: {
      type: "relation",
      relationId: "relation.orders.user_id.users.id"
    },
    sourceMap: postgresParseResult.sourceMap,
    sourceText: `${postgresSourceText}\n-- stale`
  }),
  []
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

const mysqlSourceText = `CREATE TABLE users (
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
);`;
const mysqlParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "mysql",
  sourceText: mysqlSourceText
});

assert.equal(mysqlParseResult.ok, true);
assert.equal(mysqlParseResult.resolvedDialect, "mysql");
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
assert.equal(mysqlParseResult.sourceMap.dialect, "mysql");
assert.equal(
  mysqlSourceText.slice(
    mysqlParseResult.sourceMap.relationsById[
      "relation.orders.user_id.users.id"
    ].constraintRange.from,
    mysqlParseResult.sourceMap.relationsById[
      "relation.orders.user_id.users.id"
    ].constraintRange.to
  ),
  "CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)"
);

const generatedMySql = modelToSqlRuntime.generateSqlDdlFromErdModel({
  dialect: "mysql",
  modelJson: mysqlParseResult.modelJson
});
assert.match(generatedMySql.sql, /CREATE TABLE `users`/);
assert.match(generatedMySql.sql, /`email` VARCHAR\(255\) NOT NULL/);
assert.match(generatedMySql.sql, /UNIQUE \(`email`\)/);
assert.match(
  generatedMySql.sql,
  /CONSTRAINT `fk_orders_user` FOREIGN KEY \(`user_id`\) REFERENCES `users` \(`id`\)/
);
const generatedMySqlParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "mysql",
  sourceText: generatedMySql.sql
});
assert.equal(generatedMySqlParseResult.ok, true);
assert.equal(generatedMySqlParseResult.modelJson.schema.relations.length, 1);
const modelSqlPreviewSession = {
  id: "session.model-sql-preview",
  revision: 7,
  title: "Model SQL preview",
  sourceFormat: "sql",
  dialect: "mysql",
  sourceText: mysqlSourceText,
  modelJson: mysqlParseResult.modelJson,
  layoutJson: {
    version: 1,
    tableLayouts: [
      { tableId: "table.users", x: 120, y: 80 },
      { tableId: "table.orders", x: 520, y: 80 }
    ]
  },
  settingsJson: {}
};
const modelSqlPreview = sqlDiffApplyRuntime.createSqlErdNormalizedSqlPreview({
  modelJson: modelSqlPreviewSession.modelJson,
  resolvedDialect: "mysql",
  session: modelSqlPreviewSession
});
assert.equal(modelSqlPreview.baseSnapshot, modelSqlPreviewSession);
assert.match(modelSqlPreview.generatedSourceText, /CREATE TABLE `users`/);
assert.equal(modelSqlPreview.hasChanges, true);
assert.ok(modelSqlPreview.warnings.length > 0);
assert.deepEqual(
  sqlDiffApplyRuntime.createSqlErdSqlLineDiff(
    "CREATE TABLE users (\n  id BIGINT\n);",
    "CREATE TABLE users (\n  id BIGINT NOT NULL\n);"
  ),
  [
    { kind: "unchanged", value: "CREATE TABLE users (" },
    { kind: "removed", value: "  id BIGINT" },
    { kind: "added", value: "  id BIGINT NOT NULL" },
    { kind: "unchanged", value: ");" }
  ]
);
const appliedModelSqlPreview = sqlDiffApplyRuntime.applySqlErdNormalizedSqlPreview(
  modelSqlPreview
);
assert.equal(appliedModelSqlPreview.ok, true);
assert.equal(appliedModelSqlPreview.snapshot.sourceText, modelSqlPreview.generatedSourceText);
assert.deepEqual(
  appliedModelSqlPreview.snapshot.layoutJson.tableLayouts,
  modelSqlPreviewSession.layoutJson.tableLayouts
);
assert.equal(
  sqlDiffApplyRuntime.isSqlErdNormalizedSqlPreviewCurrent(
    modelSqlPreview,
    modelSqlPreviewSession
  ),
  true
);
assert.equal(
  sqlDiffApplyRuntime.isSqlErdNormalizedSqlPreviewCurrent(modelSqlPreview, {
    ...modelSqlPreviewSession,
    revision: 8
  }),
  false
);
const failedModelSqlPreview = sqlDiffApplyRuntime.applySqlErdNormalizedSqlPreview({
  ...modelSqlPreview,
  generatedSourceText: "CREATE TABLE users ("
});
assert.equal(failedModelSqlPreview.ok, false);
assert.equal(modelSqlPreviewSession.sourceText, mysqlSourceText);
let modelSqlHistory = sqlDiffApplyRuntime.createSqlErdModelSqlHistory();
modelSqlHistory = sqlDiffApplyRuntime.recordSqlErdModelSqlHistory(
  modelSqlHistory,
  modelSqlPreviewSession
);
const undoneModelSqlPreview = sqlDiffApplyRuntime.undoSqlErdModelSqlHistory(
  modelSqlHistory,
  appliedModelSqlPreview.snapshot
);
assert.equal(undoneModelSqlPreview.snapshot, modelSqlPreviewSession);
const redoneModelSqlPreview = sqlDiffApplyRuntime.redoSqlErdModelSqlHistory(
  undoneModelSqlPreview.history,
  modelSqlPreviewSession
);
assert.equal(redoneModelSqlPreview.snapshot, appliedModelSqlPreview.snapshot);
const childFirstMySql = modelToSqlRuntime.generateSqlDdlFromErdModel({
  dialect: "mysql",
  modelJson: {
    ...mysqlParseResult.modelJson,
    schema: {
      ...mysqlParseResult.modelJson.schema,
      tables: [...mysqlParseResult.modelJson.schema.tables].reverse()
    }
  }
});
assert.match(
  childFirstMySql.sql,
  /CREATE TABLE `orders`[\s\S]*?\);\n\nCREATE TABLE `users`[\s\S]*?\);\n\nALTER TABLE `orders` ADD CONSTRAINT `fk_orders_user`/
);
assert.equal(
  ddlParserRuntime.parseSqlDdlToErdModel({
    dialect: "mysql",
    sourceText: childFirstMySql.sql
  }).modelJson.schema.relations.length,
  1
);
const generatedPostgreSql = modelToSqlRuntime.generateSqlDdlFromErdModel({
  dialect: "postgresql",
  modelJson: mysqlParseResult.modelJson
});
assert.match(generatedPostgreSql.sql, /CREATE TABLE "users"/);
assert.match(
  generatedPostgreSql.sql,
  /CONSTRAINT "fk_orders_user" FOREIGN KEY \("user_id"\) REFERENCES "users" \("id"\)/
);
assert.equal(
  ddlParserRuntime.parseSqlDdlToErdModel({
    dialect: "postgresql",
    sourceText: generatedPostgreSql.sql
  }).ok,
  true
);
const semanticRoundTripModel = structuredClone(mysqlParseResult.modelJson);
semanticRoundTripModel.schema.tables[1].columns[2].defaultValue = "'new'";
semanticRoundTripModel.schema.tables[1].constraints.push({
  id: "constraint.orders.id_status.unique",
  kind: "unique",
  columnIds: ["column.orders.id", "column.orders.status"],
  name: "uq_orders_id_status"
});
const semanticRoundTripSql = modelToSqlRuntime.generateSqlDdlFromErdModel({
  dialect: "postgresql",
  modelJson: semanticRoundTripModel
}).sql;
const semanticRoundTripParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "postgresql",
  sourceText: semanticRoundTripSql
});
assert.equal(semanticRoundTripParseResult.ok, true);
assert.deepEqual(
  semanticRoundTripParseResult.modelJson.schema.tables.map((table) => ({
    name: table.name,
    columns: table.columns.map((column) => ({
      name: column.name,
      nullable: column.nullable,
      primaryKey: column.primaryKey,
      unique: column.unique,
      defaultValue: column.defaultValue
    })),
    constraints: table.constraints.map((constraint) => ({
      kind: constraint.kind,
      columnIds: constraint.columnIds.map(
        (columnId) => table.columns.find((column) => column.id === columnId)?.name
      )
    }))
  })),
  semanticRoundTripModel.schema.tables.map((table) => ({
    name: table.name,
    columns: table.columns.map((column) => ({
      name: column.name,
      nullable: column.nullable,
      primaryKey: column.primaryKey,
      unique: column.unique,
      defaultValue: column.defaultValue
    })),
    constraints: table.constraints.map((constraint) => ({
      kind: constraint.kind,
      columnIds: constraint.columnIds.map(
        (columnId) => table.columns.find((column) => column.id === columnId)?.name
      )
    }))
  }))
);

const cyclicModel = {
  version: 1,
  schema: {
    tables: [
      {
        id: "table.a",
        name: "a",
        schemaName: null,
        columns: [
          { id: "column.a.id", name: "id", dataType: "BIGINT", nullable: false, primaryKey: true, foreignKey: false, unique: false, defaultValue: null, comment: null },
          { id: "column.a.b_id", name: "b_id", dataType: "BIGINT", nullable: true, primaryKey: false, foreignKey: true, unique: false, defaultValue: null, comment: null }
        ],
        constraints: [{ id: "constraint.a.pk", kind: "primary_key", columnIds: ["column.a.id"], name: null }],
        comment: null
      },
      {
        id: "table.b",
        name: "b",
        schemaName: null,
        columns: [
          { id: "column.b.id", name: "id", dataType: "BIGINT", nullable: false, primaryKey: true, foreignKey: false, unique: false, defaultValue: null, comment: null },
          { id: "column.b.a_id", name: "a_id", dataType: "BIGINT", nullable: true, primaryKey: false, foreignKey: true, unique: false, defaultValue: null, comment: null }
        ],
        constraints: [{ id: "constraint.b.pk", kind: "primary_key", columnIds: ["column.b.id"], name: null }],
        comment: null
      }
    ],
    relations: [
      { id: "relation.a.b_id.b.id", kind: "foreign_key", fromTableId: "table.a", fromColumnIds: ["column.a.b_id"], toTableId: "table.b", toColumnIds: ["column.b.id"], constraintName: "fk_a_b" },
      { id: "relation.b.a_id.a.id", kind: "foreign_key", fromTableId: "table.b", fromColumnIds: ["column.b.a_id"], toTableId: "table.a", toColumnIds: ["column.a.id"], constraintName: "fk_b_a" }
    ]
  }
};
const generatedCyclicMySql = modelToSqlRuntime.generateSqlDdlFromErdModel({
  dialect: "mysql",
  modelJson: cyclicModel
});
assert.match(generatedCyclicMySql.sql, /ALTER TABLE `a` ADD CONSTRAINT `fk_a_b`/);
assert.match(generatedCyclicMySql.sql, /ALTER TABLE `b` ADD CONSTRAINT `fk_b_a`/);
const generatedCyclicMySqlParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "mysql",
  sourceText: generatedCyclicMySql.sql
});
assert.equal(generatedCyclicMySqlParseResult.ok, true);
assert.equal(generatedCyclicMySqlParseResult.modelJson.schema.relations.length, 2);
const generatedCyclicPostgreSql = modelToSqlRuntime.generateSqlDdlFromErdModel({
  dialect: "postgresql",
  modelJson: cyclicModel
});
assert.match(generatedCyclicPostgreSql.sql, /ALTER TABLE "a" ADD CONSTRAINT "fk_a_b"/);
assert.equal(
  ddlParserRuntime.parseSqlDdlToErdModel({
    dialect: "postgresql",
    sourceText: generatedCyclicPostgreSql.sql
  }).modelJson.schema.relations.length,
  2
);

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

const mysqlModelIndex = modelRuntime.createSqltoerdModelIndex(
  mysqlParseResult.modelJson
);
assert.equal(
  mysqlModelIndex.columnsByTableId
    .get("table.users")
    ?.has("column.users.email"),
  true
);
assert.equal(
  mysqlModelIndex.columnsByTableId
    .get("table.orders")
    ?.has("column.orders.id"),
  true
);

const generatedLayout = modelRuntime.createSqltoerdLayoutForModel(
  mysqlParseResult.modelJson,
  {
    version: 1,
    tableLayouts: [{ tableId: "table.users", x: 44, y: 55, width: 288 }],
    annotations: {
      version: 1,
      links: [
        {
          id: "annotation.valid.table",
          kind: "table_link",
          fromTableId: "table.users",
          toTableId: "table.orders",
          label: "places"
        },
        {
          id: "annotation.valid.column",
          kind: "column_link",
          fromTableId: "table.users",
          fromColumnId: "column.users.email",
          toTableId: "table.orders",
          toColumnId: "column.orders.id",
          label: "business owner"
        },
        {
          id: "annotation.invalid.table",
          kind: "table_link",
          fromTableId: "table.users",
          toTableId: "table.removed",
          label: "removed"
        },
        {
          id: "annotation.invalid.column",
          kind: "column_link",
          fromTableId: "table.users",
          fromColumnId: "column.users.removed",
          toTableId: "table.orders",
          toColumnId: "column.orders.id",
          label: "removed"
        }
      ]
    }
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
assert.deepEqual(
  generatedLayout.annotations.links.map((annotation) => annotation.id),
  ["annotation.valid.table", "annotation.valid.column"]
);

const movedRuntimeLayout = modelRuntime.updateSqltoerdLayoutWithTablePositions(
  runtimeModel,
  {
    version: 1,
    tableLayouts: [
      { tableId: "table.users", x: 10, y: 20, width: 240 },
      { tableId: "table.orders", x: 360, y: 20, width: 260 }
    ],
    annotations: generatedLayout.annotations
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
assert.deepEqual(movedRuntimeLayout.annotations, generatedLayout.annotations);
assert.equal(
  modelRuntime.areSqltoerdLayoutsEqual(
    movedRuntimeLayout,
    movedRuntimeLayout
  ),
  true
);
assert.equal(
  modelRuntime.areSqltoerdLayoutsEqual(movedRuntimeLayout, {
    ...movedRuntimeLayout,
    annotations: {
      version: 1,
      links: movedRuntimeLayout.annotations.links.map((annotation, index) =>
        index === 0 ? { ...annotation, label: "changed" } : annotation
      )
    }
  }),
  false
);
assert.equal(
  modelRuntime.areSqltoerdLayoutsEqual(
    { version: 1, tableLayouts: [] },
    { version: 1, tableLayouts: [], annotations: { version: 1, links: [] } }
  ),
  true
);

assert.equal(typeof modelRuntime.addSqltoerdColumnAnnotation, "function");
assert.equal(typeof modelRuntime.addSqltoerdTableAnnotation, "function");
assert.equal(
  typeof modelRuntime.getSqltoerdRenderableAnnotations,
  "function"
);

const annotationBaseLayout = {
  version: 1,
  tableLayouts: movedRuntimeLayout.tableLayouts,
  annotations: { version: 1, links: [] }
};
const validColumnAnnotation = {
  id: "annotation.users.id.orders.id",
  kind: "column_link",
  fromTableId: "table.users",
  fromColumnId: "id",
  toTableId: "table.orders",
  toColumnId: "id",
  label: "same business key"
};
const validColumnAnnotationResult = modelRuntime.addSqltoerdColumnAnnotation(
  runtimeModel,
  annotationBaseLayout,
  validColumnAnnotation
);

assert.equal(validColumnAnnotationResult.ok, true);
assert.deepEqual(
  validColumnAnnotationResult.layoutJson.annotations.links,
  [validColumnAnnotation]
);
assert.deepEqual(annotationBaseLayout.annotations.links, []);

const validTableAnnotation = {
  id: "annotation.users.orders",
  kind: "table_link",
  fromTableId: "table.users",
  toTableId: "table.orders",
  label: "owns"
};
const validTableAnnotationResult = modelRuntime.addSqltoerdTableAnnotation(
  runtimeModel,
  annotationBaseLayout,
  validTableAnnotation
);

assert.equal(validTableAnnotationResult.ok, true);
assert.deepEqual(
  validTableAnnotationResult.layoutJson.annotations.links,
  [validTableAnnotation]
);
const tableAnnotationInspectorView =
  inspectorRuntime.createSqlErdInspectorViewModel(
    { type: "annotation", annotationId: validTableAnnotation.id },
    runtimeModelIndex,
    validTableAnnotationResult.layoutJson.annotations
  );
assert.equal(tableAnnotationInspectorView.type, "annotation");
assert.equal(tableAnnotationInspectorView.fromLabel, "users");
assert.equal(tableAnnotationInspectorView.toLabel, "orders");
assert.equal(
  modelRuntime.addSqltoerdTableAnnotation(
    runtimeModel,
    validTableAnnotationResult.layoutJson,
    { ...validTableAnnotation, id: "annotation.users.orders.duplicate" }
  ).reason,
  "annotation_exists"
);
assert.equal(
  modelRuntime.addSqltoerdTableAnnotation(
    runtimeModel,
    validTableAnnotationResult.layoutJson,
    {
      ...validTableAnnotation,
      id: "annotation.orders.users.reverse",
      fromTableId: validTableAnnotation.toTableId,
      toTableId: validTableAnnotation.fromTableId
    }
  ).reason,
  "annotation_exists"
);
assert.equal(
  modelRuntime.addSqltoerdTableAnnotation(runtimeModel, annotationBaseLayout, {
    ...validTableAnnotation,
    id: "annotation.same-table",
    toTableId: "table.users"
  }).reason,
  "same_endpoint"
);
assert.equal(
  modelRuntime.addSqltoerdTableAnnotation(runtimeModel, annotationBaseLayout, {
    ...validTableAnnotation,
    id: "annotation.invalid-table",
    toTableId: "table.missing"
  }).reason,
  "invalid_endpoint"
);

assert.equal(
  modelRuntime.addSqltoerdColumnAnnotation(
    runtimeModel,
    validColumnAnnotationResult.layoutJson,
    { ...validColumnAnnotation, id: "annotation.duplicate" }
  ).reason,
  "annotation_exists"
);
assert.equal(
  modelRuntime.addSqltoerdColumnAnnotation(
    runtimeModel,
    validColumnAnnotationResult.layoutJson,
    {
      ...validColumnAnnotation,
      id: "annotation.reverse",
      fromTableId: validColumnAnnotation.toTableId,
      fromColumnId: validColumnAnnotation.toColumnId,
      toTableId: validColumnAnnotation.fromTableId,
      toColumnId: validColumnAnnotation.fromColumnId
    }
  ).reason,
  "annotation_exists"
);
assert.equal(
  modelRuntime.addSqltoerdColumnAnnotation(runtimeModel, annotationBaseLayout, {
    ...validColumnAnnotation,
    id: "annotation.fk-collision",
    fromTableId: "table.users",
    fromColumnId: "id",
    toTableId: "table.orders",
    toColumnId: "user_id"
  }).reason,
  "foreign_key_exists"
);

const fkConflictAnnotation = {
  ...validColumnAnnotation,
  id: "annotation.saved-fk-collision",
  fromTableId: "table.orders",
  fromColumnId: "user_id",
  toTableId: "table.users",
  toColumnId: "id"
};
const renderableAnnotations = modelRuntime.getSqltoerdRenderableAnnotations(
  runtimeModel,
  {
    version: 1,
    links: [
      validColumnAnnotation,
      fkConflictAnnotation,
      validTableAnnotation
    ]
  }
);

assert.deepEqual(renderableAnnotations.links, [
  validColumnAnnotation,
  validTableAnnotation
]);
assert.equal(
  modelRuntime.getSqltoerdRenderableAnnotations(runtimeModel, {
    version: 1,
    links: [
      {
        ...fkConflictAnnotation,
        id: "annotation.saved-reverse-fk-collision",
        fromTableId: fkConflictAnnotation.toTableId,
        fromColumnId: fkConflictAnnotation.toColumnId,
        toTableId: fkConflictAnnotation.fromTableId,
        toColumnId: fkConflictAnnotation.fromColumnId
      }
    ]
  }).links.length,
  0
);
assert.equal(
  modelRuntime.addSqltoerdColumnAnnotation(runtimeModel, annotationBaseLayout, {
    ...validColumnAnnotation,
    id: "annotation.same-endpoint",
    toTableId: "table.users",
    toColumnId: "id"
  }).reason,
  "same_endpoint"
);
assert.equal(
  modelRuntime.addSqltoerdColumnAnnotation(runtimeModel, annotationBaseLayout, {
    ...validColumnAnnotation,
    id: "annotation.invalid-endpoint",
    toColumnId: "missing"
  }).reason,
  "invalid_endpoint"
);
assert.equal(
  modelRuntime.addSqltoerdColumnAnnotation(
    runtimeModel,
    {
      ...annotationBaseLayout,
      annotations: {
        version: 1,
        links: Array.from({ length: 300 }, (_, index) => ({
          id: `annotation.limit.${index}`,
          kind: "table_link",
          fromTableId: "table.users",
          toTableId: "table.orders",
          label: ""
        }))
      }
    },
    validColumnAnnotation
  ).reason,
  "annotation_limit"
);

const renamedColumnAnnotationLayout = modelRuntime.updateSqltoerdAnnotationLabel(
  validColumnAnnotationResult.layoutJson,
  validColumnAnnotation.id,
  "renamed label"
);
assert.equal(
  renamedColumnAnnotationLayout.annotations.links[0].label,
  "renamed label"
);
assert.equal(
  validColumnAnnotationResult.layoutJson.annotations.links[0].label,
  "same business key"
);
assert.deepEqual(
  modelRuntime.removeSqltoerdAnnotation(
    renamedColumnAnnotationLayout,
    validColumnAnnotation.id
  ).annotations.links,
  []
);

const stackedRelationLayout = relationShapeRuntime.getSqlErdRelationShapeLayout(
  {
    columns: [
      { id: "column.posts.id" },
      { id: "column.posts.user_id" },
      { id: "column.posts.title" },
      { id: "column.posts.body" },
      { id: "column.posts.created_at" }
    ],
    h: 266,
    w: 300,
    x: 100,
    y: 40
  },
  {
    columns: [
      { id: "column.users.id" },
      { id: "column.users.email" },
      { id: "column.users.created_at" }
    ],
    h: 182,
    w: 300,
    x: 100,
    y: 360
  },
  {
    fromColumnIds: ["column.posts.user_id"],
    toColumnIds: ["column.users.id"]
  }
);

assert.deepEqual(
  relationShapeRuntime.getSqlErdRelationCurveMidpoint(
    [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 100, y: 100 }
    ],
    "right",
    "right"
  ),
  { x: 110, y: 50 }
);
const stackedRelationStartPoint = {
  x: stackedRelationLayout.x + stackedRelationLayout.points[0].x,
  y: stackedRelationLayout.y + stackedRelationLayout.points[0].y
};
const stackedRelationEndPoint = {
  x:
    stackedRelationLayout.x +
    stackedRelationLayout.points[stackedRelationLayout.points.length - 1].x,
  y:
    stackedRelationLayout.y +
    stackedRelationLayout.points[stackedRelationLayout.points.length - 1].y
};

assert.deepEqual(stackedRelationStartPoint, { x: 400, y: 158 });
assert.deepEqual(stackedRelationEndPoint, { x: 400, y: 436 });
assert.equal(stackedRelationLayout.startSide, "right");
assert.equal(stackedRelationLayout.endSide, "right");
assert.equal(
  relationShapeRuntime.SQLTOERD_RELATION_HIT_STROKE_WIDTH,
  16
);
assert.deepEqual(
  relationShapeRuntime.getSqlErdCardinalityMarkerGeometry(
    { x: 10, y: 20 },
    "right",
    "one"
  ),
  {
    circles: [],
    segments: [
      { x1: 15, y1: 14, x2: 15, y2: 26 },
      { x1: 22, y1: 14, x2: 22, y2: 26 }
    ]
  }
);
assert.deepEqual(
  relationShapeRuntime.getSqlErdCardinalityMarkerGeometry(
    { x: 10, y: 20 },
    "left",
    "zero_or_one"
  ),
  {
    circles: [{ cx: -4, cy: 20, r: 3.5 }],
    segments: [{ x1: 5, y1: 14, x2: 5, y2: 26 }]
  }
);
assert.deepEqual(
  relationShapeRuntime.getSqlErdCardinalityMarkerGeometry(
    { x: 10, y: 20 },
    "right",
    "zero_or_many"
  ),
  {
    circles: [{ cx: 31, cy: 20, r: 3.5 }],
    segments: [
      { x1: 24, y1: 20, x2: 15, y2: 14 },
      { x1: 24, y1: 20, x2: 15, y2: 20 },
      { x1: 24, y1: 20, x2: 15, y2: 26 }
    ]
  }
);
assert.deepEqual(
  relationShapeRuntime.getSqlErdRelationVisualStyle({
    isHovered: false,
    isSelected: false
  }),
  {
    stroke: "rgba(37, 99, 235, 0.58)",
    strokeWidth: 2.5
  }
);
assert.deepEqual(
  relationShapeRuntime.getSqlErdRelationVisualStyle({
    isHovered: true,
    isSelected: false
  }),
  {
    stroke: "rgba(37, 99, 235, 0.82)",
    strokeWidth: 3.25
  }
);
assert.deepEqual(
  relationShapeRuntime.getSqlErdRelationVisualStyle({
    isHovered: true,
    isSelected: true
  }),
  {
    stroke: "rgba(37, 99, 235, 0.98)",
    strokeWidth: 4
  }
);
const selectedRelationHighlight = {
  relationId: "relation.orders.user_id.users.id",
  fromTableId: "table.orders",
  fromColumnIds: ["user_id"],
  toTableId: "table.users",
  toColumnIds: ["id"]
};

assert.deepEqual(
  relationShapeRuntime.getSqlErdHighlightedColumnIdsForTable(
    selectedRelationHighlight,
    "table.orders"
  ),
  ["user_id"]
);
assert.deepEqual(
  relationShapeRuntime.getSqlErdHighlightedColumnIdsForTable(
    {
      relationId: "relation.users.manager_id.users.id",
      fromTableId: "table.users",
      fromColumnIds: ["manager_id"],
      toTableId: "table.users",
      toColumnIds: ["id", "manager_id"]
    },
    "table.users"
  ),
  ["manager_id", "id"]
);
assert.deepEqual(
  relationShapeRuntime.getSqlErdRelationHighlightDetail(
    [
      {
        id: "relation.orders.customer_id.customers.id",
        kind: "foreign_key",
        fromTableId: "table.orders",
        fromColumnIds: ["customer_id"],
        toTableId: "table.customers",
        toColumnIds: ["id"],
        constraintName: "orders_customer_id_fkey"
      }
    ],
    "relation.orders.customer_id.customers.id"
  ),
  {
    relationId: "relation.orders.customer_id.customers.id",
    fromTableId: "table.orders",
    fromColumnIds: ["customer_id"],
    toTableId: "table.customers",
    toColumnIds: ["id"]
  }
);
assert.equal(
  relationShapeRuntime.getSqlErdRelationHighlightDetail(
    [],
    "relation.orders.customer_id.customers.id"
  ),
  null
);
const currentInteractionRelations = [
  {
    id: "relation.orders.customer_id.customers.id",
    kind: "foreign_key",
    fromTableId: "table.orders",
    fromColumnIds: ["customer_id_v2"],
    toTableId: "table.customers",
    toColumnIds: ["customer_pk_v2"],
    constraintName: "orders_customer_id_fkey"
  },
  {
    id: "relation.orders.store_id.stores.id",
    kind: "foreign_key",
    fromTableId: "table.orders",
    fromColumnIds: ["store_id"],
    toTableId: "table.stores",
    toColumnIds: ["id"],
    constraintName: "orders_store_id_fkey"
  }
];

assert.deepEqual(
  relationShapeRuntime.resolveSqlErdRelationHighlightFromIds(
    currentInteractionRelations,
    null,
    "relation.orders.customer_id.customers.id"
  ),
  {
    relationId: "relation.orders.customer_id.customers.id",
    fromTableId: "table.orders",
    fromColumnIds: ["customer_id_v2"],
    toTableId: "table.customers",
    toColumnIds: ["customer_pk_v2"]
  }
);
assert.equal(
  relationShapeRuntime.resolveSqlErdRelationHighlightFromIds(
    currentInteractionRelations,
    "relation.missing",
    "relation.orders.customer_id.customers.id"
  ),
  null
);
assert.equal(
  relationShapeRuntime.resolveSqlErdRelationHighlightFromIds(
    currentInteractionRelations,
    "relation.orders.store_id.stores.id",
    "relation.orders.customer_id.customers.id"
  )?.relationId,
  "relation.orders.store_id.stores.id"
);
const runtimeRelationSelectionEditor = {
  selectedShapeIds: [],
  select(shapeId) {
    this.selectedShapeIds = [shapeId];
  }
};

const runtimeRelationCurveGeometryPoints =
  relationShapeRuntime.getSqlErdRelationCurveGeometryPoints(
    [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 100 },
      { x: 160, y: 100 }
    ],
    "right",
    "left"
  );

assert.equal(runtimeRelationCurveGeometryPoints.length, 17);
assert.deepEqual(runtimeRelationCurveGeometryPoints[0], { x: 0, y: 0 });
assert.deepEqual(runtimeRelationCurveGeometryPoints.at(-1), {
  x: 160,
  y: 100
});

relationShapeRuntime.selectSqlErdRelationShape(
  runtimeRelationSelectionEditor,
  {
    id: "shape:relation.orders.customer_id.customers.id"
  }
);

assert.deepEqual(runtimeRelationSelectionEditor.selectedShapeIds, [
  "shape:relation.orders.customer_id.customers.id"
]);
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
assert.equal(autoDialectParseResult.resolvedDialect, "mysql");
assert.equal(autoDialectParseResult.modelJson.schema.tables[0].id, "table.users");
assert.equal(
  autoDialectParseResult.modelJson.schema.tables[0].columns[0].dataType,
  "BIGINT"
);

const customPostgreSqlTypeParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "postgresql",
  sourceText: `CREATE TYPE order_status AS ENUM ('pending', 'paid');
CREATE DOMAIN currency_amount AS NUMERIC(12, 2);

CREATE TABLE payments (
  id BIGSERIAL PRIMARY KEY,
  status order_status NOT NULL,
  amount currency_amount
);`
});

assert.equal(customPostgreSqlTypeParseResult.ok, true);
assert.equal(customPostgreSqlTypeParseResult.resolvedDialect, "postgresql");
assert.deepEqual(
  customPostgreSqlTypeParseResult.modelJson.schema.tables[0].columns.map(
    (column) => column.dataType
  ),
  ["BIGSERIAL", "ORDER_STATUS", "CURRENCY_AMOUNT"]
);

const caseSensitivePostgreSqlDomainParseResult =
  ddlParserRuntime.parseSqlDdlToErdModel({
    dialect: "postgresql",
    sourceText: `CREATE DOMAIN "CaseType570" AS TEXT;
CREATE DOMAIN "casetype570" AS TEXT;

CREATE TABLE case_sensitive_values (
  upper_value "CaseType570" NOT NULL,
  lower_value "casetype570" NOT NULL
);`
  });

assert.equal(caseSensitivePostgreSqlDomainParseResult.ok, true);

const commentOnlyPostgreSqlTypeParseResult =
  ddlParserRuntime.parseSqlDdlToErdModel({
    dialect: "postgresql",
    sourceText: `-- CREATE TYPE comment_only_type_570 AS ENUM ('ignored');
CREATE TABLE comment_only_values (
  value comment_only_type_570 NOT NULL
);`
  });

assert.equal(commentOnlyPostgreSqlTypeParseResult.ok, false);

const stringOnlyPostgreSqlTypeParseResult =
  ddlParserRuntime.parseSqlDdlToErdModel({
    dialect: "postgresql",
    sourceText: `CREATE TABLE string_only_values (
  note TEXT DEFAULT 'CREATE DOMAIN string_only_type_570',
  value string_only_type_570 NOT NULL
);`
  });

assert.equal(stringOnlyPostgreSqlTypeParseResult.ok, false);

assert.deepEqual(
  ddlParserRuntime.collectPostgreSqlUserDefinedTypeDeclarations(`-- CREATE TYPE comment_type AS ENUM ('ignored');
/* CREATE DOMAIN block_comment_type AS TEXT; */
SELECT 'CREATE DOMAIN string_type AS TEXT';
DO $body$ BEGIN RAISE NOTICE 'CREATE TYPE dollar_string_type'; END $body$;
CREATE /* real declaration */ DOMAIN "CaseType570" AS TEXT;
CREATE DOMAIN "casetype570" AS TEXT;
CREATE TYPE public.order_status AS ENUM ('pending');`),
  ["\"CaseType570\"", "\"casetype570\"", "public.order_status"]
);

const invalidParseResult = ddlParserRuntime.parseSqlDdlToErdModel({
  dialect: "postgresql",
  sourceText: "SELECT * FROM users"
});

assert.equal(invalidParseResult.ok, false);
assert.match(invalidParseResult.error.message, /CREATE TABLE/);

assert.equal(
  ddlParserRuntime.SQL_ERD_SOURCE_TEXT_MAX_BYTES,
  1024 * 1024
);
const oversizedUtf8Source = "한".repeat(
  Math.floor(ddlParserRuntime.SQL_ERD_SOURCE_TEXT_MAX_BYTES / 3) + 1
);

assert.equal(
  oversizedUtf8Source.length <
    ddlParserRuntime.SQL_ERD_SOURCE_TEXT_MAX_BYTES,
  true
);
assert.equal(
  new TextEncoder().encode(oversizedUtf8Source).byteLength >
    ddlParserRuntime.SQL_ERD_SOURCE_TEXT_MAX_BYTES,
  true
);

const oversizedSourceParseResult =
  ddlParserRuntime.parseSqlDdlToErdModel({
    dialect: "postgresql",
    sourceText: oversizedUtf8Source
  });

assert.deepEqual(oversizedSourceParseResult, {
  ok: false,
  error: {
    code: "SOURCE_TOO_LARGE",
    message: "SQL DDL source exceeds the 1 MiB UTF-8 limit."
  }
});
assert.equal(
  statusCopyRuntime.getSqlErdGenerateErrorMessage("SOURCE_TOO_LARGE"),
  "SQL source is too large. Keep it at or below 1 MiB and try again."
);

const exactLimitSourceParseResult =
  ddlParserRuntime.parseSqlDdlToErdModel({
    dialect: "postgresql",
    sourceText: " ".repeat(
      ddlParserRuntime.SQL_ERD_SOURCE_TEXT_MAX_BYTES
    )
  });

assert.equal(exactLimitSourceParseResult.ok, false);
assert.equal(exactLimitSourceParseResult.error.code, "EMPTY_SOURCE");

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

assert.doesNotMatch(apiSpec, /SQL 직접 편집과 Generate로/);
assert.doesNotMatch(apiSpec, /Generate 성공 결과를 기준으로 보낸다/);
assert.doesNotMatch(apiSpec, /Generate 성공, table 위치 변경/);
assert.match(
  apiSpec,
  /sourceText.*,.*modelJson.*,.*layoutJson.*자동 parsing에 성공한 동일 snapshot/
);
assert.match(
  apiSpec,
  /자동 parsing 성공, table 위치 변경, 저장 대상 설정 변경 시 client가 이 API로 자동/
);

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

assert.match(page, /SqlErdSessionList/);
assert.doesNotMatch(page, /SqlErdPanel/);
assert.match(sessionPage, /SqlErdPanel/);
assert.match(sessionPage, /readSqlErdSessionId/);
assert.match(sessionPage, /window\.location\.search/);
assert.match(sessionPage, /sql-erd-full-bleed/);
assert.match(sessionPage, /h-screen/);
assert.match(sessionRouteBridge, /SqlErdSessionPage as default/);
assert.doesNotMatch(page, /-m-6/);
assert.doesNotMatch(page, /h-\[calc\(100vh-3\.5rem\)\]/);

assert.match(mainShell, /isSqlErdImmersiveRoute/);
assert.match(mainShell, /pathname\.startsWith\("\/sql-erd\/session"\)/);
assert.doesNotMatch(mainShell, /pathname\.startsWith\("\/sql-erd"\);/);

assert.match(navigation, /SQLtoERD/);
assert.match(navigation, /href: "\/sql-erd"/);
assert.doesNotMatch(navigation, /Inspector/);
assert.doesNotMatch(navigation, /href: "\/sql-erd#inspector"/);
assert.match(homeDashboardData, /listSessions\(normalizedWorkspaceId/);
assert.match(homeDashboardData, /limit: 1/);
assert.doesNotMatch(homeDashboardData, /getActiveSession/);

assert.match(sessionList, /listSessions/);
assert.match(sessionList, /buildSqlErdSessionHref/);
assert.match(sessionList, /createSession/);
assert.match(sessionList, /deleteSession/);
assert.match(sessionList, /nextCursor/);
assert.match(sessionList, /더 보기/);
assert.match(sessionList, /session\.revision/);
assert.match(sessionList, /세션이 없습니다/);
assert.match(sessionList, /getSqlErdSessionListViewState/);
assert.match(sessionList, /removeSqlErdSession/);
assert.match(
  sessionList,
  /await apiClient\.deleteSession[\s\S]*?setSessions\(\(currentSessions\) =>[\s\S]*?removeSqlErdSession[\s\S]*?await loadSessions/
);
assert.match(sessionListStateUtils, /getSqlErdSessionListViewState/);
assert.match(sessionListStateUtils, /removeSqlErdSession/);
assert.match(sessionNavigationUtils, /buildSqlErdSessionHref/);
assert.match(sessionNavigationUtils, /readSqlErdSessionId/);

assert.match(sessionStateUtils, /getSqlErdSessionReloadFailureAction/);
assert.match(sessionStateUtils, /getSqlErdSessionLoadFailureState/);
assert.match(sessionStateUtils, /kind: "preserve_current"/);
assert.match(sessionStateUtils, /kind: "fallback_to_sample"/);
assert.match(sessionStateUtils, /shouldApplySqlErdSessionLoadResult/);
assert.match(sessionStateUtils, /isSqlErdAutosaveRequestCurrent/);
assert.match(sessionStateUtils, /tryBeginSqlErdAutosave/);
assert.match(sessionStateUtils, /completeSqlErdAutosave/);
assert.match(sessionStateUtils, /SQL_ERD_LAYOUT_AUTOSAVE_DEBOUNCE_MS = 2000/);
assert.match(sqlDiffApplyUtils, /createSqlErdNormalizedSqlPreview/);
assert.match(sqlDiffApplyUtils, /createSqlErdSqlLineDiff/);
assert.match(sqlDiffApplyUtils, /applySqlErdNormalizedSqlPreview/);
assert.match(sqlDiffApplyUtils, /recordSqlErdModelSqlHistory/);
assert.match(sqlDiffApplyUtils, /undoSqlErdModelSqlHistory/);
assert.match(sqlDiffApplyUtils, /redoSqlErdModelSqlHistory/);
assert.match(panel, /NormalizedSqlPreviewDialog/);
assert.match(panel, /normalized_sql_applied/);
assert.match(panel, /Regenerate SQL/);
assert.match(
  sessionStateUtils,
  /SQL_ERD_LAYOUT_AUTOSAVE_MAX_RETRY_DELAY_MS = 30000/
);
assert.match(sessionStateUtils, /getLayoutAutosaveBlockReasonForStatus/);
assert.match(sessionStateUtils, /isLayoutAutosaveTransientStatus/);
assert.match(sessionStateUtils, /getLayoutAutosaveDelayMs/);
assert.match(sessionStateUtils, /getLayoutAutosavePausedBanner/);
assert.match(sessionStateUtils, /status === 409/);
assert.match(sessionStateUtils, /status === 408 \|\| status === 429 \|\| status >= 500/);
assert.match(sessionStateUtils, /status === 401/);
assert.match(sessionStateUtils, /status === 403/);
assert.match(sessionStateUtils, /status === 404/);
assert.match(sessionStateUtils, /status === 400 \|\| status === 413/);

assert.match(generateSessionUtils, /createSqlErdGenerateWorkspaceRequest/);
assert.match(generateSessionUtils, /parseSqlDdlToErdModel/);
assert.match(generateSessionUtils, /createSqltoerdLayoutForModel/);
assert.match(generateSessionUtils, /kind: "create"/);
assert.match(generateSessionUtils, /kind: "update"/);
assert.match(generateSessionUtils, /baseRevision: session\.revision/);
assert.match(generateSessionUtils, /sourceMap: parseResult\.sourceMap/);

assert.match(sqlSourceDecorationUtils, /Decoration\.mark/);
assert.match(sqlSourceDecorationUtils, /EditorView\.decorations\.of/);
assert.match(sqlSourceDecorationUtils, /range\.to > documentLength/);
assert.doesNotMatch(sqlSourceDecorationUtils, /\bcolor\b/);

assert.match(layoutAutosaveUtils, /createSqlErdLayoutAutosaveRequest/);
assert.match(layoutAutosaveUtils, /baseRevision: session\.revision/);
assert.match(layoutAutosaveUtils, /layoutJson/);
assert.match(layoutAutosaveUtils, /missing_workspace_session/);

assert.match(statusCopyUtils, /getSqlErdGenerateErrorMessage/);
assert.match(statusCopyUtils, /getSqlErdSignInRequiredState/);
assert.match(statusCopyUtils, /getSqlErdWorkspaceSaveErrorState/);
assert.match(statusCopyUtils, /getSqlErdSourceStatus/);
assert.match(statusCopyUtils, /CREATE TABLE statement/);
assert.doesNotMatch(statusCopyUtils, /try Generate again/);
assert.match(statusCopyUtils, /retry automatically/);
assert.match(statusCopyUtils, /"retrying"/);
assert.match(statusCopyUtils, /Retrying parsed SQL changes automatically/);

assert.match(panel, /SqlErdCanvas/);
assert.match(panel, /useAuthSession/);
assert.match(panel, /createSqlErdApiClient/);
assert.match(panel, /getSession/);
assert.match(panel, /sessionId: string/);
assert.match(panel, /createSqlErdEditState/);
assert.match(panel, /beginSqlErdParse/);
assert.match(panel, /isSqlErdParseRequestCurrent/);
assert.match(panel, /shouldScheduleSqlErdAutoParse/);
assert.match(panel, /SQL_ERD_AUTO_PARSE_DEBOUNCE_MS/);
assert.match(panel, /SQL_ERD_PARSE_TIMEOUT_MS = 5000/);
assert.match(panel, /new Worker\(/);
assert.match(panel, /worker\.terminate\(\)/);
assert.match(panel, /ParseWorkerRequest/);
assert.match(panel, /autoParseDraftSourceText/);
assert.match(panel, /autoParseDraftDialect/);
assert.match(panel, /reduceSqlErdEditState/);
assert.match(panel, /sqlErdEditStateRef/);
assert.match(
  panel,
  /const \[sqlErdEditState, setSqlErdEditState\] = useState/
);
assert.match(
  panel,
  /const sqlErdViewSession =\s*sqlErdEditState\.lastSuccessfulSnapshot/
);
assert.match(panel, /type: "draft_source_changed"/);
assert.match(panel, /type: "draft_dialect_changed"/);
assert.match(panel, /type: "session_loaded"/);
assert.match(panel, /type: "layout_changed"/);
assert.match(panel, /type: "layout_saved"/);
assert.match(panel, /type: "parse_failed"/);
assert.match(panel, /type: "parse_cancelled"/);
assert.match(panel, /type: "parse_resume_after_cancel"/);
assert.match(panel, /type: "parse_succeeded"/);
assert.match(panel, /runSqlErdParseWorker/);
assert.match(panel, /createSqlErdSourceAutosaveRequest/);
assert.match(panel, /getSqlErdWorkspaceSaveErrorState/);
assert.match(panel, /updateSession/);
assert.doesNotMatch(panel, /\bPlay\b/);
assert.doesNotMatch(panel, /handleGenerate/);
assert.doesNotMatch(panel, /isGenerating/);
assert.doesNotMatch(panel, /isGenerateDisabled/);
assert.doesNotMatch(panel, /onGenerate/);
assert.doesNotMatch(panel, />Generate</);
assert.match(
  panel,
  /window\.setTimeout\([\s\S]*?SQL_ERD_AUTO_PARSE_DEBOUNCE_MS/
);
assert.match(panel, /runSqlErdParseWorker\(\{/);
assert.doesNotMatch(panel, /parseExecutionTimeoutId/);
assert.match(
  panel,
  /const activeParseResult = await runSqlErdParseWorker\([\s\S]*?activeParseResult\.requestSequence !== requestId[\s\S]*?activeParseResult\.sessionId !== activeSession\.id[\s\S]*?type: "session_loaded"/
);
assert.match(panel, /parseResult\.requestSequence !== parseStart\.requestSequence/);
assert.match(panel, /parseResult\.sessionId !== parseStart\.session\.id/);
assert.match(
  panel,
  /shouldScheduleSqlErdAutoParse\(sqlErdEditStateRef\.current\)/
);
const autoParseEffectSource = panel.slice(
  panel.indexOf("shouldScheduleSqlErdAutoParse(sqlErdEditStateRef.current)"),
  panel.indexOf(
    "useEffect(() => {",
    panel.indexOf("shouldScheduleSqlErdAutoParse(sqlErdEditStateRef.current)")
  )
);
assert.match(autoParseEffectSource, /autoParseDraftSourceText/);
assert.match(autoParseEffectSource, /autoParseDraftDialect/);
assert.match(autoParseEffectSource, /autoParseRequestSequence/);
assert.match(autoParseEffectSource, /activeWorkspaceId/);
assert.match(autoParseEffectSource, /sessionId/);
assert.doesNotMatch(autoParseEffectSource, /sqlErdViewSession\.layoutJson/);
assert.doesNotMatch(autoParseEffectSource, /sqlErdViewSession\.revision/);
assert.match(panel, /setPendingSourceAutosaveSnapshot/);
assert.match(panel, /type: "source_autosave_saved"/);
assert.match(panel, /sourceAutosaveRetryAttempt/);
assert.match(panel, /autosaveGateRef/);
assert.match(panel, /autosaveCompletionEpoch/);
assert.match(panel, /autosaveLifecycleGenerationRef/);
assert.match(panel, /requestLifecycleGeneration/);
assert.match(panel, /isSqlErdAutosaveRequestCurrent/);
assert.equal(
  [...panel.matchAll(/tryBeginAutosave\(requestLifecycleGeneration\)/g)]
    .length,
  2
);
assert.equal(
  [...panel.matchAll(/completeAutosave\(requestLifecycleGeneration\)/g)]
    .length,
  2
);
assert.match(panel, /getSqlErdSourceStatus/);
assert.match(panel, /autosaveBlockReason: layoutAutosaveBlockReason/);
assert.match(panel, /aria-live="polite"/);
assert.doesNotMatch(panel, /sqlErdApiClient\.createSession/);
assert.match(panel, /"Save conflict"/);
assert.match(panel, /pendingLayoutAutosaveJson/);
assert.match(panel, /layoutAutosaveRetryAttempt/);
assert.match(panel, /type LayoutAutosaveBlockReason/);
assert.match(panel, /layoutAutosaveBlockReason/);
assert.match(panel, /getLayoutAutosaveBlockReason/);
assert.match(panel, /getLayoutAutosavePausedBanner/);
assert.match(panel, /AutosavePausedBanner/);
assert.match(panel, /Autosave paused/);
assert.match(panel, /Reload session/);
assert.match(panel, /Retry once/);
assert.match(panel, /handleReloadSession/);
assert.match(panel, /handleReloadPausedSession/);
assert.match(panel, /handleRetryLayoutAutosaveOnce/);
assert.match(panel, /handleLayoutChange/);
assert.match(panel, /sessionLoadRequestIdRef/);
assert.match(panel, /shouldApplySqlErdSessionLoadResult/);
assert.match(panel, /getSqlErdSessionLoadFailureState/);
assert.match(panel, /hasLoadedSessionRef/);
assert.match(panel, /SessionLoadPlaceholder/);
assert.match(panel, /Session을 다시 불러오기/);
assert.doesNotMatch(panel, /fallbackToSampleOnFailure/);
assert.match(panel, /void handleReloadSession\(\)/);
assert.match(panel, /onReloadSession=\{handleReloadPausedSession\}/);
assert.doesNotMatch(panel, /onReloadSession=\{handleReloadSession\}/);
assert.doesNotMatch(
  panel,
  /catch \{\s*setSqlErdViewSession\(sampleSqlErdViewSession\);[\s\S]*?setPendingLayoutAutosaveJson\(null\);/
);
assert.doesNotMatch(panel, /isLayoutAutosaveBlocked/);
assert.match(panel, /isSqlErdApiTransientAutosaveError/);
assert.match(panel, /getLayoutAutosaveBlockReasonForStatus/);
assert.match(panel, /isLayoutAutosaveTransientStatus/);
assert.match(panel, /createSqlErdLayoutAutosaveRequest/);
assert.match(panel, /getLayoutAutosaveDelayMs\(layoutAutosaveRetryAttempt\)/);
const layoutAutosaveEffect = panel.slice(
  panel.indexOf("const layoutAutosaveRequest")
);
const layoutAutosaveNonConflictCatch =
  layoutAutosaveEffect.match(
    /if \(isSqlErdApiConflictError\(error\)\) \{[\s\S]*?return;\n\s*\}\n\n([\s\S]*?)\n\s*\}\n\s*\}, autosaveDelayMs/
  )?.[1] ?? "";
assert.match(
  layoutAutosaveNonConflictCatch,
  /setLayoutAutosaveRetryAttempt\(\(currentAttempt\) => currentAttempt \+ 1\)/
);
assert.match(
  layoutAutosaveNonConflictCatch,
  /if \(layoutAutosaveBlockReason\) \{[\s\S]*?setLayoutAutosaveBlockReason\(layoutAutosaveBlockReason\)[\s\S]*?return;/
);
assert.doesNotMatch(
  layoutAutosaveNonConflictCatch,
  /setPendingLayoutAutosaveJson/
);
const layoutAutosaveConflictCatch =
  layoutAutosaveEffect.match(
    /if \(isSqlErdApiConflictError\(error\)\) \{([\s\S]*?)\n\s*return;\n\s*\}/
  )?.[1] ?? "";
assert.doesNotMatch(
  layoutAutosaveConflictCatch,
  /setPendingLayoutAutosaveJson\(null\)/
);
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
assert.match(sqlEditorDialectUtils, /@codemirror\/lang-sql/);
assert.match(panel, /@codemirror\/state/);
assert.match(panel, /@codemirror\/view/);
assert.match(panel, /SqlSourceEditor/);
assert.match(panel, /sqlSourceEditorTheme/);
assert.match(panel, /lastResolvedDialect/);
assert.match(panel, /sqlSourceMap/);
assert.match(panel, /setSqlSourceMap\(null\)/);
assert.match(panel, /setSqlSourceMap\(parseResult\.sourceMap\)/);
assert.match(
  panel,
  /sourceMapModelJson: activeViewSession\.modelJson/
);
assert.doesNotMatch(panel, /previousModelJson: parseStart\.session\.modelJson/);
assert.match(panel, /relationSourceCompartmentRef/);
assert.match(panel, /getSelectedSqlErdRelationSourceRanges/);
assert.match(panel, /import Link from "next\/link"/);
assert.match(panel, /\bHome\b/);
assert.match(panel, /function SqlErdHomeNavigationButton/);
assert.match(panel, /href="\/sql-erd"/);
assert.match(panel, /세션 목록으로 이동/);
assert.match(panel, /function CollapsedSourcePanel/);
assert.match(panel, /href="\/home"/);
assert.match(panel, /aria-label="홈으로 이동"/);
assert.match(panel, /<CollapsedSourcePanel onToggle=\{onToggle\} \/>/);
assert.doesNotMatch(panel, /scrollIntoView/);
assert.match(panel, /resolveSqlSourceEditorDialect/);
assert.match(panel, /setLastResolvedDialect\(parseResult\.resolvedDialect\)/);
assert.match(panel, /languageCompartmentRef/);
assert.match(panel, /getSqlSourceEditorLanguageExtension/);
assert.match(panel, /languageCompartment\.of/);
assert.match(panel, /createSqlSourceEditorDialectReconfigureEffect/);
assert.match(panel, /EditorState\.readOnly\.of\(readOnly\)/);
assert.match(panel, /EditorView\.editable\.of\(!readOnly\)/);
assert.match(panel, /isDialectSelectDisabled=\{!isSessionReady\}/);
assert.match(panel, /isSourceTextReadOnly=\{!isSessionReady\}/);
assert.doesNotMatch(panel, /\bsql\(\)/);
assert.doesNotMatch(panel, /<textarea/);
assert.doesNotMatch(panel, /setSqlErdViewSession/);
assert.match(panel, /sessionLoadState/);
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
assert.match(panel, /const inspectorTitle = getInspectorTitle\(viewModel\)/);
assert.match(panel, /\{inspectorTitle\}/);
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
assert.match(panel, /features\/sql-erd\/utils\/table-pin/);
assert.match(panel, /핀 위치로 이동/);
assert.match(panel, /Pin 해제/);
assert.match(panel, /sourceText=\{sqlErdEditState\.draftSourceText\}/);
assert.match(panel, /dialect=\{sqlErdEditState\.draftDialect\}/);
assert.match(
  panel,
  /sourceText: sqlErdEditState\.draftSourceText/
);
assert.match(panel, /modelJson=\{sqlErdViewSession\.modelJson\}/);
assert.match(panel, /layoutJson=\{sqlErdViewSession\.layoutJson\}/);
assert.match(panel, /label=\{sessionLoadState\.label\}/);
assert.doesNotMatch(panel, /PreviewTableCard/);

assert.match(inspectorUtils, /createSqlErdInspectorViewModel/);
assert.match(inspectorUtils, /type: "annotation"/);
assert.match(inspectorUtils, /formatSqlErdAnnotationEndpoint/);
assert.match(inspectorUtils, /isColumnConnectedToRelation/);
assert.match(inspectorUtils, /relation\.fromTableId === tableId/);
assert.match(inspectorUtils, /relation\.toTableId === tableId/);
assert.match(tablePinUtils, /getSqlErdPinnedTableCenter/);
assert.doesNotMatch(layoutAutosaveUtils, /pinnedTableId/);
assert.doesNotMatch(apiClient, /pinnedTableId/);

assert.match(canvasSurface, /TldrawSurface/);
assert.match(canvasSurface, /commerceSqltoerdFixture/);
assert.match(canvasSurface, /SqlErdCanvasShapeSync/);
assert.match(canvasSurface, /areSqlErdCanvasShapesApplied/);
assert.match(canvasSurface, /applySqlErdCanvasShapes/);
assert.match(canvasSurface, /shouldResetSqlErdCanvas/);
assert.match(canvasSurface, /editor\.updateShapes\(updates\)/);
assert.match(canvasSurface, /createSqltoerdTableShapes/);
assert.match(canvasSurface, /createSqltoerdRelationShapes/);
assert.match(canvasSurface, /createSqltoerdAnnotationShapes/);
assert.match(canvasSurface, /createSqltoerdCanvasShapes/);
assert.match(canvasSurface, /SqlErdRelationLayoutSync/);
assert.match(canvasSurface, /SqlErdAnnotationInteractionSync/);
assert.match(canvasSurface, /syncSqlErdAnnotationShapes/);
assert.match(canvasSurface, /addSqltoerdColumnAnnotation/);
assert.match(canvasSurface, /addSqltoerdTableAnnotation/);
assert.match(canvasSurface, /SQLTOERD_TABLE_CONNECT_START_EVENT/);
assert.match(canvasSurface, /updateSqltoerdAnnotationLabel/);
assert.match(canvasSurface, /removeSqltoerdAnnotation/);
assert.match(canvasSurface, /event\.key === "Delete"/);
assert.match(canvasSurface, /event\.key === "Backspace"/);
assert.match(canvasSurface, /window\.addEventListener\("keydown", handleKeyDown, true\)/);
assert.match(canvasSurface, /getSqltoerdRenderableAnnotations/);
assert.match(canvasSurface, /SqlErdRelationHighlightSync/);
assert.match(canvasSurface, /SqlErdPinnedTableNavigationSync/);
assert.match(canvasSurface, /editor\.centerOnPoint\(tableCenter/);
assert.match(canvasSurface, /resolveSqlErdRelationHighlightFromIds/);
assert.match(canvasSurface, /hoveredRelationIdRef/);
assert.match(canvasSurface, /selectedRelationIdRef/);
assert.doesNotMatch(canvasSurface, /hoveredDetailRef/);
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
assert.match(canvasSurface, /getSqlErdSelectionFromSelectedShapes/);
assert.match(canvasSurface, /SQLTOERD_COLUMN_SELECT_EVENT/);
assert.match(canvasSurface, /editor\.getSelectedShapes/);
assert.match(canvasSurface, /SQLTOERD_TABLE_SHAPE_TYPE/);
assert.match(canvasSurface, /SQLTOERD_RELATION_SHAPE_TYPE/);
assert.match(canvasSurface, /SqlErdRelationShapeUtil/);
assert.match(canvasSurface, /SQLTOERD_ANNOTATION_SHAPE_TYPE/);
assert.match(canvasSurface, /SqlErdAnnotationShapeUtil/);
assert.match(canvasSurface, /getSqlErdTableShapeId/);
assert.match(canvasSurface, /hashSqlErdShapeSourceId/);
assert.match(canvasSurface, /zoomToFit/);
assert.match(canvasSurface, /resetSqlErdCanvas\(editor, shapes\)/);
assert.match(
  canvasSurface,
  /const handleMount = useCallback\([\s\S]*?editor\.setCurrentTool\("select\.idle"\);[\s\S]*?resetSqlErdCanvas\(editor, shapes\);/
);
assert.match(canvasSurface, /selectedColumnId/);
assert.match(canvasSurface, /selectedState/);
assert.match(canvasSurface, /highlightedColumnIds/);
assert.match(canvasSurface, /SQLTOERD_RELATION_HOVER_EVENT/);
assert.match(canvasSurface, /Background: null/);
assert.match(canvasSurface, /bg-\[radial-gradient/);
assert.doesNotMatch(canvasSurface, /function SqlErdCanvasBackground/);
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
assert.match(tableShape, /data-sqltoerd-table-header/);
assert.match(tableShape, /data-sqltoerd-column-id/);
assert.match(tableShape, /data-sqltoerd-column-port/);
assert.match(tableShape, /SQLTOERD_COLUMN_CONNECT_START_EVENT/);
assert.match(tableShape, /SQLTOERD_TABLE_CONNECT_START_EVENT/);
assert.match(tableShape, /data-sqltoerd-column-port-hit/);
assert.match(tableShape, /data-sqltoerd-table-port-hit/);
assert.match(tableShape, /size-5/);
assert.match(tableShape, /size-2/);
assert.match(tableShape, /selectedColumnId/);
assert.match(tableShape, /selectedState/);
assert.match(tableShape, /highlightedColumnIds/);
assert.match(tableShape, /function selectSqlErdTableShapeColumn/);
assert.match(tableShape, /function selectSqlErdTableShape/);
assert.match(tableShape, /editor\.updateShapes\(updates\)/);
assert.match(
  tableShape,
  /function handleColumnClick\(columnId: string\) \{[\s\S]*?selectSqlErdTableShapeColumn\(editor, shape, columnId\);[\s\S]*?selectSqlErdColumn\({/
);
assert.match(tableShape, /aria-pressed=\{isSelected\}/);
assert.match(tableShape, /function handleTableKeyDown/);
assert.match(tableShape, /override onClick\(shape: SqlErdTableShape\)/);
assert.match(tableShape, /isSqlErdColumnPointerDrag/);
assert.match(tableShape, /columnPointerStartRef/);
assert.doesNotMatch(tableShape, /suppressNextColumnClickRef/);
assert.match(tableShape, /onPointerDownCapture/);
assert.doesNotMatch(tableShape, /onPointerUpCapture/);
assert.doesNotMatch(tableShape, /<article[\s\S]*?onClick=\{handleTableClick\}/);
assert.doesNotMatch(tableShape, /isSelected \|\| column\.foreignKey\s*\?\s*"border-blue-400 opacity-100"/);
assert.match(tableShape, /isHighlighted/);
assert.match(tableShape, /data-sqltoerd-column-highlighted/);
assert.match(tableShape, /data-sqltoerd-table-selected/);
assert.match(tableShape, /pointer-events-auto/);
assert.match(tableShape, /pointerEvents: "all"/);
assert.match(tableShape, /justify-self-end/);
assert.match(tableShape, /minmax\(max-content, 1fr\)/);
assert.doesNotMatch(tableShape, /const BADGE_COLUMN_WIDTH = 72/);
assert.doesNotMatch(tableShape, /gridTemplateColumns: `\$\{BADGE_COLUMN_WIDTH\}px max-content max-content`/);
assert.doesNotMatch(tableShape, /truncate/);
assert.doesNotMatch(tableShape, /text-overflow/);

assert.match(relationShape, /SQLTOERD_RELATION_SHAPE_TYPE/);
assert.match(relationShape, /SQLTOERD_RELATION_HOVER_EVENT/);
assert.match(relationShape, /class SqlErdRelationShapeUtil extends ShapeUtil/);
assert.match(relationShape, /SVGContainer/);
assert.match(relationShape, /getSqlErdRelationTableEdgeAnchors/);
assert.match(relationShape, /getSqlErdRelationShapeLayout/);
assert.match(relationShape, /getSqlErdRelationRoutePoints/);
assert.match(relationShape, /getSqlErdRelationColumnAnchors/);
assert.match(relationShape, /getSqlErdColumnAnchorY/);
assert.match(relationShape, /getRelationCurveControlPoints/);
assert.match(relationShape, /getRelationCurveBoundsPoints/);
assert.match(relationShape, /getSqlErdRelationCurveGeometryPoints/);
assert.match(relationShape, /TABLE_HEADER_HEIGHT/);
assert.match(relationShape, /TABLE_ROW_HEIGHT/);
assert.match(relationShape, /fromTableId/);
assert.match(relationShape, /toTableId/);
assert.match(relationShape, /fromColumnIds/);
assert.match(relationShape, /toColumnIds/);
assert.match(relationShape, /fromTableShapeId/);
assert.match(relationShape, /toTableShapeId/);
assert.match(relationShape, /startSide: T\.string/);
assert.match(relationShape, /endSide: T\.string/);
assert.match(relationShape, /startCardinality: T\.nullable\(T\.string\)/);
assert.match(relationShape, /endCardinality: T\.nullable\(T\.string\)/);
assert.match(relationShape, /points: T\.arrayOf/);
assert.match(relationShape, /arrowPoints: T\.arrayOf/);
assert.match(relationShape, /fromColumnIds: string\[\]/);
assert.match(relationShape, /toColumnIds: string\[\]/);
assert.match(relationShape, /shape\.props\.startSide/);
assert.match(relationShape, /shape\.props\.endSide/);
assert.match(relationShape, /onPointerEnter/);
assert.match(relationShape, /onPointerLeave/);
assert.match(relationShape, /getSqlErdRelationCurvePathData\(/);
assert.match(relationShape, /getSqlErdRelationCurveGeometryPoints\(/);
assert.match(relationShape, / C /);
assert.match(relationShape, /useValue/);
assert.match(relationShape, /data-sqltoerd-relation-hit-target/);
assert.match(relationShape, /data-sqltoerd-cardinality-marker/);
assert.match(relationShape, /getSqlErdCardinalityMarkerGeometry/);
assert.match(relationShape, /stroke="transparent"/);
assert.match(relationShape, /SQLTOERD_RELATION_HIT_STROKE_WIDTH/);
assert.doesNotMatch(relationShape, /canCull\(\)/);

assert.match(annotationShape, /SQLTOERD_ANNOTATION_SHAPE_TYPE/);
assert.match(annotationShape, /kind: "table_link" \| "column_link"/);
assert.match(annotationShape, /fromColumnId: T\.nullable\(T\.string\)/);
assert.match(annotationShape, /class SqlErdAnnotationShapeUtil extends ShapeUtil/);
assert.match(annotationShape, /data-sqltoerd-annotation-hit-target/);
assert.match(annotationShape, /SQLTOERD_ANNOTATION_HIT_STROKE_WIDTH = 16/);
assert.match(annotationShape, /strokeDasharray="8 6"/);
assert.match(annotationShape, /data-sqltoerd-annotation-label/);
assert.match(annotationShape, /maxLength=\{200\}/);
assert.match(annotationShape, /SQLTOERD_ANNOTATION_LABEL_CHANGE_EVENT/);
assert.match(annotationShape, /SQLTOERD_ANNOTATION_DELETE_EVENT/);
assert.match(annotationShape, /getSqlErdRelationCurvePathData/);
assert.match(annotationShape, /getSqlErdRelationCurveMidpoint/);
assert.doesNotMatch(
  annotationShape,
  /\(startPoint\.x \+ endPoint\.x\) \/ 2/
);
assert.doesNotMatch(annotationShape, /Cardinality/);
assert.match(relationShape, /hideSelectionBoundsBg/);
assert.match(relationShape, /hideSelectionBoundsFg/);
assert.match(canvasSurface, /fromColumnIds: relation\.fromColumnIds/);
assert.match(canvasSurface, /toColumnIds: relation\.toColumnIds/);
assert.match(canvasSurface, /shape\.props\.fromColumnIds/);
assert.match(canvasSurface, /shape\.props\.toColumnIds/);
assert.match(canvasSurface, /inferSqlErdRelationCardinality/);
assert.match(canvasSurface, /startCardinality: cardinality\?\.from \?\? null/);
assert.match(canvasSurface, /endCardinality: cardinality\?\.to \?\? null/);
assert.match(panel, /참조 컬럼/);
assert.match(panel, /대상 컬럼/);
assert.match(panel, /관계 의미/);

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
assert.match(apiClient, /listSessions/);
assert.match(apiClient, /getSession/);
assert.match(apiClient, /createSession/);
assert.match(apiClient, /updateSession/);
assert.match(apiClient, /deleteSession/);
assert.match(apiClient, /sql-erd-sessions/);
assert.doesNotMatch(apiClient, /sql-erd-session`/);
assert.match(apiClient, /Authorization: `Bearer \$\{accessToken\}`/);
assert.match(apiClient, /credentials: "same-origin"/);
