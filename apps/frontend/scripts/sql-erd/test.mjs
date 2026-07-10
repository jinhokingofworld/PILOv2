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
  const inspectorOutputPath = join(outputDir, "inspector.mjs");
  const ddlParserOutputPath = join(outputDir, "ddl-parser.mjs");
  const sqlSourceMapOutputPath = join(outputDir, "sql-source-map.mjs");
  const generateSessionOutputPath = join(outputDir, "generate-session.mjs");
  const layoutAutosaveOutputPath = join(outputDir, "layout-autosave.mjs");
  const apiClientOutputPath = join(outputDir, "api-client.mjs");
  const sessionStateOutputPath = join(outputDir, "session-state.mjs");
  const statusCopyOutputPath = join(outputDir, "status-copy.mjs");
  const sqlEditorDialectOutputPath = join(outputDir, "sql-editor-dialect.mjs");
  const relationShapeOutputPath = join(outputDir, "relation-shape.mjs");
  const tableShapeOutputPath = join(outputDir, "table-shape.mjs");
  const canvasSelectionOutputPath = join(outputDir, "canvas-selection.mjs");

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
      "../../src/features/sql-erd/utils/sql-source-map.ts",
      sqlSourceMapOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/ddl-parser.ts",
      ddlParserOutputPath,
      [
        [/from "@\/features\/sql-erd\/types"/g, 'from "./types-stub.mjs"'],
        [
          /from "@\/features\/sql-erd\/utils\/sql-source-map"/g,
          'from "./sql-source-map.mjs"'
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
      "../../src/features/sql-erd/utils/layout-autosave.ts",
      layoutAutosaveOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/api/client.ts",
      apiClientOutputPath
    );
    await compileTypeScriptModule(
      "../../src/features/sql-erd/utils/session-state.ts",
      sessionStateOutputPath
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
          /from "@\/features\/sql-erd\/shapes\/sql-erd-relation-shape"/g,
          'from "./relation-shape-stub.mjs"'
        ],
        [
          /from "@\/features\/sql-erd\/shapes\/sql-erd-table-shape"/g,
          'from "./table-shape-stub.mjs"'
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
      inspectorRuntime,
      ddlParserRuntime,
      generateSessionRuntime,
      layoutAutosaveRuntime,
      apiClientRuntime,
      sessionStateRuntime,
      sqlEditorDialectRuntime,
      statusCopyRuntime,
      relationShapeRuntime,
      tableShapeRuntime,
      canvasSelectionRuntime
    ] = await Promise.all([
      import(pathToFileHref(modelOutputPath)),
      import(pathToFileHref(inspectorOutputPath)),
      import(pathToFileHref(ddlParserOutputPath)),
      import(pathToFileHref(generateSessionOutputPath)),
      import(pathToFileHref(layoutAutosaveOutputPath)),
      import(pathToFileHref(apiClientOutputPath)),
      import(pathToFileHref(sessionStateOutputPath)),
      import(pathToFileHref(sqlEditorDialectOutputPath)),
      import(pathToFileHref(statusCopyOutputPath)),
      import(pathToFileHref(relationShapeOutputPath)),
      import(pathToFileHref(tableShapeOutputPath)),
      import(pathToFileHref(canvasSelectionOutputPath))
    ]);

    return {
      apiClientRuntime,
      canvasSelectionRuntime,
      ddlParserRuntime,
      generateSessionRuntime,
      layoutAutosaveRuntime,
      inspectorRuntime,
      modelRuntime,
      relationShapeRuntime,
      sessionStateRuntime,
      sqlEditorDialectRuntime,
      statusCopyRuntime,
      tableShapeRuntime
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
  modelUtils,
  inspectorUtils,
  page,
  navigation,
  panel,
  sessionStateUtils,
  generateSessionUtils,
  layoutAutosaveUtils,
  statusCopyUtils,
  canvasSurface,
  mainShell,
  tableShape,
  relationShape,
  ddlParserUtils,
  sqlEditorDialectUtils,
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
    readSqlErdFile("../../src/features/sql-erd/utils/session-state.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/generate-session.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/layout-autosave.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/status-copy.ts"),
    readSqlErdFile("../../src/features/sql-erd/components/sql-erd-canvas.tsx"),
    readSqlErdFile("../../src/components/main-shell.tsx"),
    readSqlErdFile("../../src/features/sql-erd/shapes/sql-erd-table-shape.tsx"),
    readSqlErdFile("../../src/features/sql-erd/shapes/sql-erd-relation-shape.tsx"),
    readSqlErdFile("../../src/features/sql-erd/utils/ddl-parser.ts"),
    readSqlErdFile("../../src/features/sql-erd/utils/sql-editor-dialect.ts"),
    readSqlErdFile("../../src/features/sql-erd/api/client.ts"),
    readSqlErdFile("../../package.json")
  ]);

const {
  apiClientRuntime,
  canvasSelectionRuntime,
  ddlParserRuntime,
  generateSessionRuntime,
  layoutAutosaveRuntime,
  inspectorRuntime,
  modelRuntime,
  relationShapeRuntime,
  sessionStateRuntime,
  sqlEditorDialectRuntime,
  statusCopyRuntime,
  tableShapeRuntime
} = await compileSqlErdRuntimeModules();
const runtimeModel = createRuntimeTestModel();

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
assert.equal(
  sessionStateRuntime.shouldApplySqlErdSessionLoadResult(7, 7),
  true
);
assert.equal(
  sessionStateRuntime.shouldApplySqlErdSessionLoadResult(7, 8),
  false
);
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
  message: "Workspace session could not be saved. Check your connection and try Generate again.",
  tone: "error"
});

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
    tableLayouts: [{ tableId: "table.users", x: 512, y: 256, width: 320 }]
  },
  settingsJson: { sourcePanelOpen: true }
};
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
assert.deepEqual(createGenerateRequest.payload.settingsJson, {
  sourcePanelOpen: true
});

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
    postgresParseResult.sourceMap.columnsById["column.users.id"].from,
    postgresParseResult.sourceMap.columnsById["column.users.id"].to
  ),
  "id"
);
assert.equal(
  postgresSourceText.slice(
    postgresParseResult.sourceMap.columnsById["column.orders.id"].from,
    postgresParseResult.sourceMap.columnsById["column.orders.id"].to
  ),
  "id"
);
assert.notEqual(
  postgresParseResult.sourceMap.columnsById["column.users.id"].from,
  postgresParseResult.sourceMap.columnsById["column.orders.id"].from
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
assert.match(page, /h-screen/);
assert.doesNotMatch(page, /-m-6/);
assert.doesNotMatch(page, /h-\[calc\(100vh-3\.5rem\)\]/);

assert.match(mainShell, /isSqlErdImmersiveRoute/);
assert.match(mainShell, /pathname\.startsWith\("\/sql-erd"\)/);

assert.match(navigation, /SQLtoERD/);
assert.match(navigation, /href: "\/sql-erd"/);
assert.doesNotMatch(navigation, /Inspector/);
assert.doesNotMatch(navigation, /href: "\/sql-erd#inspector"/);

assert.match(sessionStateUtils, /getSqlErdSessionReloadFailureAction/);
assert.match(sessionStateUtils, /kind: "preserve_current"/);
assert.match(sessionStateUtils, /kind: "fallback_to_sample"/);
assert.match(sessionStateUtils, /shouldApplySqlErdSessionLoadResult/);
assert.match(sessionStateUtils, /SQL_ERD_LAYOUT_AUTOSAVE_DEBOUNCE_MS = 2000/);
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

assert.match(layoutAutosaveUtils, /createSqlErdLayoutAutosaveRequest/);
assert.match(layoutAutosaveUtils, /baseRevision: session\.revision/);
assert.match(layoutAutosaveUtils, /layoutJson/);
assert.match(layoutAutosaveUtils, /missing_workspace_session/);

assert.match(statusCopyUtils, /getSqlErdGenerateErrorMessage/);
assert.match(statusCopyUtils, /getSqlErdSignInRequiredState/);
assert.match(statusCopyUtils, /getSqlErdWorkspaceSaveErrorState/);
assert.match(statusCopyUtils, /CREATE TABLE statement/);
assert.match(statusCopyUtils, /Check your connection and try Generate again/);

assert.match(panel, /SqlErdCanvas/);
assert.match(panel, /useAuthSession/);
assert.match(panel, /createSqlErdApiClient/);
assert.match(panel, /getActiveSession/);
assert.match(panel, /createSqlErdGenerateWorkspaceRequest/);
assert.match(panel, /getSqlErdGenerateErrorMessage/);
assert.match(panel, /getSqlErdSignInRequiredState/);
assert.match(panel, /getSqlErdWorkspaceSaveErrorState/);
assert.match(panel, /handleGenerate/);
assert.match(panel, /createSession/);
assert.match(panel, /updateSession/);
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
assert.match(panel, /fallbackToSampleOnFailure/);
assert.match(panel, /getSqlErdSessionReloadFailureAction/);
assert.match(
  panel,
  /void handleReloadSession\(\{ fallbackToSampleOnFailure: true \}\)/
);
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
const layoutAutosaveNonConflictCatch =
  panel.match(
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
  panel.match(
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
assert.match(panel, /resolveSqlSourceEditorDialect/);
assert.match(panel, /setLastResolvedDialect\(generateRequest\.resolvedDialect\)/);
assert.match(panel, /languageCompartmentRef/);
assert.match(panel, /getSqlSourceEditorLanguageExtension/);
assert.match(panel, /languageCompartment\.of/);
assert.match(panel, /createSqlSourceEditorDialectReconfigureEffect/);
assert.match(panel, /EditorState\.readOnly\.of\(readOnly\)/);
assert.match(panel, /EditorView\.editable\.of\(!readOnly\)/);
assert.doesNotMatch(panel, /\bsql\(\)/);
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
assert.match(canvasSurface, /applySqlErdCanvasShapes/);
assert.match(canvasSurface, /shouldResetSqlErdCanvas/);
assert.match(canvasSurface, /editor\.updateShapes\(updates\)/);
assert.match(canvasSurface, /createSqltoerdTableShapes/);
assert.match(canvasSurface, /createSqltoerdRelationShapes/);
assert.match(canvasSurface, /createSqltoerdCanvasShapes/);
assert.match(canvasSurface, /SqlErdRelationLayoutSync/);
assert.match(canvasSurface, /SqlErdRelationHighlightSync/);
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
assert.match(canvasSurface, /getSqlErdTableShapeId/);
assert.match(canvasSurface, /hashSqlErdShapeSourceId/);
assert.match(canvasSurface, /zoomToFit/);
assert.match(canvasSurface, /resetSqlErdCanvas\(editor, shapes\)/);
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
assert.match(relationShape, /getRelationCurveGeometryPoints/);
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
assert.match(relationShape, /points: T\.arrayOf/);
assert.match(relationShape, /arrowPoints: T\.arrayOf/);
assert.match(relationShape, /fromColumnIds: string\[\]/);
assert.match(relationShape, /toColumnIds: string\[\]/);
assert.match(relationShape, /shape\.props\.startSide/);
assert.match(relationShape, /shape\.props\.endSide/);
assert.match(relationShape, /onPointerEnter/);
assert.match(relationShape, /onPointerLeave/);
assert.match(relationShape, /getRelationCurvePathData\(/);
assert.match(relationShape, /getRelationCurveGeometryPoints\(/);
assert.match(relationShape, / C /);
assert.match(relationShape, /useValue/);
assert.match(relationShape, /data-sqltoerd-relation-hit-target/);
assert.match(relationShape, /stroke="transparent"/);
assert.match(relationShape, /SQLTOERD_RELATION_HIT_STROKE_WIDTH/);
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
