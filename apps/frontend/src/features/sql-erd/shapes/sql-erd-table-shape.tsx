"use client";

import {
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent
} from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  useEditor,
  type Editor,
  type TLBaseShape,
  type TLShape,
  type TLShapeId,
  type TLShapePartial
} from "tldraw";

import type { ErdColumn, ErdTable } from "@/features/sql-erd/types";
import { useSqlErdTableFocus } from "@/features/sql-erd/components/sql-erd-table-focus-context";
import { getSqlErdFocusedTableRole } from "@/features/sql-erd/utils/agent-table-focus";
import {
  getSqltoerdTableBadgeColumnWidth,
  getSqltoerdTableCardSize,
  SQLTOERD_BADGE_MIN_COLUMN_WIDTH as BADGE_MIN_COLUMN_WIDTH,
  SQLTOERD_ROW_COLUMN_GAP as ROW_COLUMN_GAP,
  SQLTOERD_TABLE_HEADER_HEIGHT as TABLE_HEADER_HEIGHT,
  SQLTOERD_TABLE_MIN_WIDTH as TABLE_MIN_WIDTH,
  SQLTOERD_TABLE_ROW_HEIGHT as TABLE_ROW_HEIGHT
} from "@/features/sql-erd/utils/table-card-layout";

export const SQLTOERD_TABLE_SHAPE_TYPE = "sqltoerd_table";
export const SQLTOERD_COLUMN_SELECT_EVENT = "sqltoerd:column-select";
export const SQLTOERD_COLUMN_CONNECT_START_EVENT =
  "sqltoerd:column-connect-start";
export const SQLTOERD_TABLE_CONNECT_START_EVENT =
  "sqltoerd:table-connect-start";
export const SQLTOERD_TABLE_SELECT_EVENT = "sqltoerd:table-select";

const COLUMN_CLICK_DRAG_THRESHOLD = 4;

export type SqlErdTableColumnShapeProps = {
  id: string;
  name: string;
  dataType: string;
  primaryKey: boolean;
  foreignKey: boolean;
  unique: boolean;
  nullable: boolean;
};

export type SqlErdTableSelectionState = "none" | "table" | "column";

export type SqlErdTableShapeProps = {
  w: number;
  h: number;
  tableId: string;
  tableName: string;
  schemaName: string | null;
  badgeColumnWidth: number;
  selectedColumnId: string | null;
  selectedState: SqlErdTableSelectionState;
  highlightedColumnIds: string[];
  columns: SqlErdTableColumnShapeProps[];
};

export type SqlErdTableShape = TLBaseShape<
  typeof SQLTOERD_TABLE_SHAPE_TYPE,
  SqlErdTableShapeProps
>;

export function isSqlErdTableShape(
  shape: TLShape | null | undefined
): shape is SqlErdTableShape {
  return shape?.type === SQLTOERD_TABLE_SHAPE_TYPE;
}

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [SQLTOERD_TABLE_SHAPE_TYPE]: SqlErdTableShapeProps;
  }
}

type ColumnBadge = {
  label: "PK" | "FK" | "UQ" | "NN";
  className: string;
};

type SqlErdColumnSelectEventDetail = {
  columnId: string;
  tableId: string;
};

type SqlErdTableSelectEventDetail = {
  tableId: string;
};

export type SqlErdColumnConnectStartEventDetail = {
  clientX: number;
  clientY: number;
  columnId: string;
  pointerId: number;
  side: "left" | "right";
  tableId: string;
};

export type SqlErdTableConnectStartEventDetail = Omit<
  SqlErdColumnConnectStartEventDetail,
  "columnId"
>;

export function getSqlErdTableSelectionAtLocalPoint(
  shape: SqlErdTableShape,
  point: { x: number; y: number }
):
  | { type: "table" }
  | { type: "column"; columnId: string }
  | null {
  if (
    point.x < 0 ||
    point.x > shape.props.w ||
    point.y < 0 ||
    point.y > shape.props.h
  ) {
    return null;
  }

  if (point.y < TABLE_HEADER_HEIGHT) {
    return { type: "table" };
  }

  const columnIndex = Math.floor(
    (point.y - TABLE_HEADER_HEIGHT) / TABLE_ROW_HEIGHT
  );
  const column = shape.props.columns[columnIndex];

  return column ? { type: "column", columnId: column.id } : null;
}

export function isSqlErdColumnPointerDrag(
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  return (
    Math.hypot(end.x - start.x, end.y - start.y) >
    COLUMN_CLICK_DRAG_THRESHOLD
  );
}

export function getSqlErdConnectorPortVisibilityClassName({
  isHighlighted,
  isSelected,
  selectedOpacityClassName
}: {
  isHighlighted: boolean;
  isSelected: boolean;
  selectedOpacityClassName: "opacity-45" | "opacity-100";
}) {
  if (isSelected) {
    return `pointer-events-auto ${selectedOpacityClassName} hover:opacity-100`;
  }
  if (isHighlighted) {
    return "pointer-events-none opacity-0 [@media(hover:hover)_and_(pointer:fine)]:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:opacity-100";
  }
  return "pointer-events-none opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-focus-visible:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:group-focus-visible:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100";
}

export function selectSqlErdColumn(detail: SqlErdColumnSelectEventDetail) {
  window.dispatchEvent(
    new CustomEvent(SQLTOERD_COLUMN_SELECT_EVENT, {
      detail
    })
  );
}

export function selectSqlErdTable(detail: SqlErdTableSelectEventDetail) {
  window.dispatchEvent(
    new CustomEvent(SQLTOERD_TABLE_SELECT_EVENT, {
      detail
    })
  );
}

export function startSqlErdColumnConnection(
  detail: SqlErdColumnConnectStartEventDetail
) {
  window.dispatchEvent(
    new CustomEvent(SQLTOERD_COLUMN_CONNECT_START_EVENT, {
      detail
    })
  );
}

export function startSqlErdTableConnection(
  detail: SqlErdTableConnectStartEventDetail
) {
  window.dispatchEvent(
    new CustomEvent(SQLTOERD_TABLE_CONNECT_START_EVENT, {
      detail
    })
  );
}

export function getSqlErdTableShapeSelectionUpdates(
  editor: Editor,
  selectedTableShape: SqlErdTableShape,
  selection:
    | {
        type: "column";
        columnId: string;
      }
    | {
        type: "table";
      },
  selectedShapeIds: readonly TLShapeId[] = [selectedTableShape.id]
) {
  const updates: TLShapePartial<SqlErdTableShape>[] = [];
  const selectedShapeIdSet = new Set(selectedShapeIds);

  for (const shape of editor.getCurrentPageShapes()) {
    if (!isSqlErdTableShape(shape)) {
      continue;
    }

    const isSelectedTable = shape.id === selectedTableShape.id;
    const isShapeSelected = selectedShapeIdSet.has(shape.id);
    const selectedState: SqlErdTableSelectionState = !isShapeSelected
      ? "none"
      : isSelectedTable
        ? selection.type
        : "table";
    const selectedColumnId =
      isShapeSelected && isSelectedTable && selection.type === "column"
        ? selection.columnId
        : null;

    if (
      shape.props.selectedState === selectedState &&
      shape.props.selectedColumnId === selectedColumnId
    ) {
      continue;
    }

    updates.push({
      id: shape.id,
      type: SQLTOERD_TABLE_SHAPE_TYPE,
      props: {
        ...shape.props,
        selectedColumnId,
        selectedState
      }
    });
  }

  return updates;
}

function getNextSqlErdSelectedShapeIds(
  editor: Pick<Editor, "getSelectedShapeIds">,
  shapeId: TLShapeId,
  toggle: boolean,
  baseSelectedShapeIds?: readonly TLShapeId[]
) {
  if (!toggle) {
    return [shapeId];
  }

  const selectedShapeIds = Array.from(
    baseSelectedShapeIds ?? editor.getSelectedShapeIds()
  );
  return selectedShapeIds.includes(shapeId)
    ? selectedShapeIds.filter((selectedShapeId) => selectedShapeId !== shapeId)
    : [...selectedShapeIds, shapeId];
}

export function primeSqlErdPointerSelection(
  editor: Pick<Editor, "getSelectedShapeIds" | "setSelectedShapes">,
  shapeId: TLShapeId,
  options: { toggle?: boolean } = {}
) {
  const selectedShapeIds = Array.from(editor.getSelectedShapeIds());

  if (!options.toggle && !selectedShapeIds.includes(shapeId)) {
    editor.setSelectedShapes([shapeId]);
  }

  return selectedShapeIds;
}

export function selectSqlErdTableShape(
  editor: Editor,
  selectedTableShape: SqlErdTableShape,
  toggle = false,
  baseSelectedShapeIds?: readonly TLShapeId[]
) {
  const selectedShapeIds = getNextSqlErdSelectedShapeIds(
    editor,
    selectedTableShape.id,
    toggle,
    baseSelectedShapeIds
  );
  const updates = getSqlErdTableShapeSelectionUpdates(
    editor,
    selectedTableShape,
    { type: "table" },
    selectedShapeIds
  );

  editor.run(
    () => {
      if (updates.length) {
        editor.updateShapes(updates);
      }

      editor.setSelectedShapes(selectedShapeIds);
    },
    { history: "ignore" }
  );
}

export function selectSqlErdTableShapeColumn(
  editor: Editor,
  selectedTableShape: SqlErdTableShape,
  columnId: string,
  toggle = false,
  baseSelectedShapeIds?: readonly TLShapeId[]
) {
  const selectedShapeIds = getNextSqlErdSelectedShapeIds(
    editor,
    selectedTableShape.id,
    toggle,
    baseSelectedShapeIds
  );
  const updates = getSqlErdTableShapeSelectionUpdates(
    editor,
    selectedTableShape,
    {
      type: "column",
      columnId
    },
    selectedShapeIds
  );

  editor.run(
    () => {
      if (updates.length) {
        editor.updateShapes(updates);
      }

      editor.setSelectedShapes(selectedShapeIds);
    },
    { history: "ignore" }
  );
}

export function getSqlErdTableShapeSize(table: ErdTable, fallbackWidth?: number) {
  const tableCardSize = getSqltoerdTableCardSize(table, fallbackWidth);

  return {
    w: tableCardSize.width,
    h: tableCardSize.height,
    badgeColumnWidth: tableCardSize.badgeColumnWidth
  };
}

export function toSqlErdTableShapeColumns(
  columns: ErdColumn[]
): SqlErdTableColumnShapeProps[] {
  return columns.map((column) => ({
    id: column.id,
    name: column.name,
    dataType: column.dataType,
    primaryKey: column.primaryKey,
    foreignKey: column.foreignKey,
    unique: column.unique,
    nullable: column.nullable
  }));
}

export function getSqlErdTableBadgeColumnWidth(
  columns: SqlErdTableColumnShapeProps[]
) {
  return getSqltoerdTableBadgeColumnWidth(columns);
}

function getColumnBadges(column: SqlErdTableColumnShapeProps): ColumnBadge[] {
  const badges: ColumnBadge[] = [];

  if (column.primaryKey) {
    badges.push({
      label: "PK",
      className: "bg-amber-50 text-amber-700"
    });
  }

  if (column.foreignKey) {
    badges.push({
      label: "FK",
      className: "bg-blue-50 text-blue-600"
    });
  }

  if (column.unique) {
    badges.push({
      label: "UQ",
      className: "bg-violet-50 text-violet-600"
    });
  }

  if (!column.nullable && !column.primaryKey) {
    badges.push({
      label: "NN",
      className: "bg-slate-100 text-slate-500"
    });
  }

  return badges;
}

export function getSqlErdColumnRowVisualStyle({
  isAlternateRow,
  isHighlighted,
  isSelected
}: {
  isAlternateRow: boolean;
  isHighlighted: boolean;
  isSelected: boolean;
}) {
  if (isSelected) {
    return {
      backgroundColor: "#dbeafe",
      boxShadow:
        "inset 4px 0 0 #2563eb, inset 0 0 0 1px rgba(37, 99, 235, 0.32)"
    };
  }

  if (isHighlighted) {
    return {
      backgroundColor: "#f0f7ff",
      boxShadow: "inset 3px 0 0 rgba(96, 165, 250, 0.55)"
    };
  }

  return {
    backgroundColor: isAlternateRow ? "#f8fafc" : "#ffffff",
    boxShadow: undefined
  };
}

function SqlErdTableCard({ shape }: { shape: SqlErdTableShape }) {
  const editor = useEditor();
  const tableFocus = useSqlErdTableFocus();
  const tablePointerSelectionRef = useRef<TLShapeId[] | null>(null);
  const columnPointerStartRef = useRef<{
    selectedShapeIds: TLShapeId[];
    x: number;
    y: number;
  } | null>(null);
  const displayName = shape.props.schemaName
    ? `${shape.props.schemaName}.${shape.props.tableName}`
    : shape.props.tableName;
  const selectedState = shape.props.selectedState ?? "none";
  const highlightedColumnIds = shape.props.highlightedColumnIds ?? [];
  const focusRole = tableFocus
    ? getSqlErdFocusedTableRole(tableFocus, shape.props.tableId)
    : null;
  const isFocusDimmed = focusRole === "dimmed";

  function handleTableClick(
    toggle = false,
    baseSelectedShapeIds?: readonly TLShapeId[]
  ) {
    if (isFocusDimmed) return;
    selectSqlErdTableShape(
      editor,
      shape,
      toggle,
      baseSelectedShapeIds
    );
    if (!toggle) {
      selectSqlErdTable({ tableId: shape.props.tableId });
    }
  }

  function handleTableKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleTableClick();
  }

  function handleColumnClick(
    columnId: string,
    toggle = false,
    baseSelectedShapeIds?: readonly TLShapeId[]
  ) {
    if (isFocusDimmed) return;
    selectSqlErdTableShapeColumn(
      editor,
      shape,
      columnId,
      toggle,
      baseSelectedShapeIds
    );
    if (!toggle) {
      selectSqlErdColumn({
        columnId,
        tableId: shape.props.tableId
      });
    }
  }

  function handleColumnPointerDown(event: PointerEvent<HTMLDivElement>) {
    const selectedShapeIds = primeSqlErdPointerSelection(editor, shape.id, {
      toggle: event.shiftKey
    });
    columnPointerStartRef.current = {
      selectedShapeIds,
      x: event.clientX,
      y: event.clientY
    };
  }

  function handleColumnDomClick(
    event: MouseEvent<HTMLDivElement>,
    columnId: string
  ) {
    const pointerStart = columnPointerStartRef.current;
    columnPointerStartRef.current = null;

    if (
      pointerStart &&
      isSqlErdColumnPointerDrag(pointerStart, {
        x: event.clientX,
        y: event.clientY
      })
    ) {
      return;
    }

    event.stopPropagation();
    handleColumnClick(
      columnId,
      event.shiftKey,
      pointerStart?.selectedShapeIds
    );
  }

  return (
    <HTMLContainer
      className="pointer-events-auto overflow-visible"
      style={{
        filter: isFocusDimmed ? "blur(2px) saturate(0.45)" : undefined,
        height: shape.props.h,
        opacity: isFocusDimmed ? 0.2 : focusRole === "related" ? 0.86 : 1,
        pointerEvents: isFocusDimmed ? "none" : "all",
        transition: "filter 160ms ease, opacity 160ms ease",
        width: shape.props.w
      }}
    >
      <article
        className={`overflow-visible rounded-md border bg-white shadow-[0_12px_28px_rgba(15,23,42,0.12)] transition-[border-color,box-shadow] ${
          selectedState === "table"
            ? "border-blue-500 ring-2 ring-blue-200"
            : selectedState === "column"
              ? "border-blue-300"
              : "border-slate-200"
        } ${
          focusRole === "primary"
            ? "outline outline-4 outline-blue-400 outline-offset-4"
            : focusRole === "related"
              ? "outline outline-2 outline-sky-300 outline-offset-2"
              : ""
        }`}
        data-sqltoerd-table-focus-role={focusRole ?? undefined}
        data-sqltoerd-table-selected={
          selectedState === "table" ? "true" : undefined
        }
        style={{
          height: shape.props.h,
          minWidth: shape.props.w,
          width: shape.props.w
        }}
      >
        <header
          className="group relative flex h-[54px] cursor-grab items-center rounded-t-md border-b border-slate-200 bg-slate-100 px-6 outline-none transition-colors active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-inset"
          data-sqltoerd-table-header
          data-sqltoerd-table-id={shape.props.tableId}
          onClick={(event) => {
            event.stopPropagation();
            handleTableClick(
              event.shiftKey,
              tablePointerSelectionRef.current ?? undefined
            );
            tablePointerSelectionRef.current = null;
          }}
          onKeyDown={handleTableKeyDown}
          role="button"
          tabIndex={isFocusDimmed ? -1 : 0}
          onPointerDownCapture={(event) => {
            tablePointerSelectionRef.current = primeSqlErdPointerSelection(
              editor,
              shape.id,
              { toggle: event.shiftKey }
            );
          }}
        >
          {(["left", "right"] as const).map((side) => (
            <button
              aria-label={`테이블 설명 관계 ${side === "left" ? "시작" : "끝"}`}
              className={`absolute top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-full transition-opacity ${
                side === "left" ? "left-[-10px]" : "right-[-10px]"
              } ${getSqlErdConnectorPortVisibilityClassName({
                isHighlighted: false,
                isSelected: selectedState === "table",
                selectedOpacityClassName: "opacity-45"
              })}`}
              data-sqltoerd-table-port={side}
              data-sqltoerd-table-port-hit
              data-sqltoerd-table-id={shape.props.tableId}
              key={side}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
                startSqlErdTableConnection({
                  clientX: event.clientX,
                  clientY: event.clientY,
                  pointerId: event.pointerId,
                  side,
                  tableId: shape.props.tableId
                });
              }}
              title="드래그하여 SQL에 반영되지 않는 테이블 설명 관계 추가"
              tabIndex={-1}
              type="button"
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full border border-slate-500 bg-white shadow-sm"
              />
            </button>
          ))}
          <h3 className="whitespace-nowrap text-[22px] font-semibold leading-none text-slate-950">
            {displayName}
          </h3>
        </header>

        <div className="divide-y divide-slate-100">
          {shape.props.columns.map((column, columnIndex) => {
            const badges = getColumnBadges(column);
            const isSelected = shape.props.selectedColumnId === column.id;
            const isHighlighted = highlightedColumnIds.includes(column.id);

            return (
              <div
                aria-pressed={isSelected}
                className="group relative grid h-[42px] cursor-pointer items-center px-6 font-mono text-[20px] leading-none outline-none transition-colors last:rounded-b-md focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-inset"
                data-sqltoerd-column-id={column.id}
                data-sqltoerd-table-id={shape.props.tableId}
                data-sqltoerd-column-highlighted={
                  isHighlighted ? "true" : undefined
                }
                key={column.id}
                onClick={(event) => {
                  handleColumnDomClick(event, column.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  handleColumnClick(column.id);
                }}
                onPointerCancel={() => {
                  columnPointerStartRef.current = null;
                }}
                onPointerDownCapture={handleColumnPointerDown}
                role="button"
                style={{
                  ...getSqlErdColumnRowVisualStyle({
                    isAlternateRow: columnIndex % 2 !== 0,
                    isHighlighted,
                    isSelected
                  }),
                  columnGap: ROW_COLUMN_GAP,
                  gridTemplateColumns: `${shape.props.badgeColumnWidth}px max-content minmax(max-content, 1fr)`
                }}
                tabIndex={isFocusDimmed ? -1 : 0}
              >
                {(["left", "right"] as const).map((side) => {
                  const isPortSelected =
                    isSelected || selectedState === "table";

                  return (
                    <button
                      aria-hidden="true"
                      className={`absolute top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-full transition-opacity ${
                        side === "left" ? "left-[-10px]" : "right-[-10px]"
                      } ${getSqlErdConnectorPortVisibilityClassName({
                        isHighlighted,
                        isSelected: isPortSelected,
                        selectedOpacityClassName:
                          isSelected || isHighlighted
                            ? "opacity-100"
                            : "opacity-45"
                      })}`}
                      data-sqltoerd-column-id={column.id}
                      data-sqltoerd-column-port={side}
                      data-sqltoerd-column-port-hit
                      data-sqltoerd-table-id={shape.props.tableId}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || !event.isPrimary) {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();
                        columnPointerStartRef.current = null;
                        startSqlErdColumnConnection({
                          clientX: event.clientX,
                          clientY: event.clientY,
                          columnId: column.id,
                          pointerId: event.pointerId,
                          side,
                          tableId: shape.props.tableId
                        });
                      }}
                      title="드래그하여 SQL에 반영되지 않는 설명 관계 추가"
                      tabIndex={-1}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full border border-blue-500 bg-white shadow-sm"
                      />
                    </button>
                  );
                })}
                <div className="flex min-w-0 items-center gap-1">
                  {badges.map((badge) => (
                    <span
                      className={`inline-flex h-6 items-center rounded-sm px-1.5 text-[16px] font-bold ${badge.className}`}
                      key={badge.label}
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>
                <span className="whitespace-nowrap text-slate-700">
                  {column.name}
                </span>
                <span className="justify-self-end whitespace-nowrap text-right text-slate-400">
                  {column.dataType.toLowerCase()}
                </span>
              </div>
            );
          })}
        </div>
      </article>
    </HTMLContainer>
  );
}

export class SqlErdTableShapeUtil extends ShapeUtil<SqlErdTableShape> {
  static override type = SQLTOERD_TABLE_SHAPE_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    tableId: T.string,
    tableName: T.string,
    schemaName: T.nullable(T.string),
    badgeColumnWidth: T.number,
    selectedColumnId: T.nullable(T.string),
    selectedState: T.string,
    highlightedColumnIds: T.arrayOf(T.string),
    columns: T.arrayOf(
      T.object({
        id: T.string,
        name: T.string,
        dataType: T.string,
        primaryKey: T.boolean,
        foreignKey: T.boolean,
        unique: T.boolean,
        nullable: T.boolean
      })
    )
  };

  override canBind() {
    return false;
  }

  override canResize() {
    return false;
  }

  override hideSelectionBoundsBg() {
    return true;
  }

  override hideSelectionBoundsFg(shape: SqlErdTableShape) {
    return shape.props.selectedState === "column";
  }

  override onClick(shape: SqlErdTableShape) {
    const localPoint = this.editor.getPointInShapeSpace(
      shape,
      this.editor.inputs.getCurrentPagePoint()
    );
    const selection = getSqlErdTableSelectionAtLocalPoint(shape, localPoint);

    if (!selection) {
      return;
    }

    const toggle = this.editor.inputs.shiftKey;

    if (toggle) {
      return;
    }

    if (selection.type === "column") {
      selectSqlErdTableShapeColumn(
        this.editor,
        shape,
        selection.columnId,
        false
      );
      selectSqlErdColumn({
        columnId: selection.columnId,
        tableId: shape.props.tableId
      });
      return;
    }

    selectSqlErdTableShape(this.editor, shape);
    selectSqlErdTable({ tableId: shape.props.tableId });
  }

  override getDefaultProps(): SqlErdTableShape["props"] {
    return {
      w: TABLE_MIN_WIDTH,
      h: TABLE_HEADER_HEIGHT + TABLE_ROW_HEIGHT,
      tableId: "",
      tableName: "",
      schemaName: null,
      badgeColumnWidth: BADGE_MIN_COLUMN_WIDTH,
      selectedColumnId: null,
      selectedState: "none",
      highlightedColumnIds: [],
      columns: []
    };
  }

  override getGeometry(shape: SqlErdTableShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true
    });
  }

  override component(shape: SqlErdTableShape) {
    return <SqlErdTableCard shape={shape} />;
  }

  override getIndicatorPath(shape: SqlErdTableShape) {
    const path = new Path2D();

    path.roundRect(0, 0, shape.props.w, shape.props.h, 8);

    return path;
  }
}
