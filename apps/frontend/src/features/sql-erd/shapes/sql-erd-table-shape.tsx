"use client";

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type TLBaseShape,
  type TLShape
} from "tldraw";

import type { ErdColumn, ErdTable } from "@/features/sql-erd/types";
import { getTableDisplayName } from "@/features/sql-erd/utils/model";

export const SQLTOERD_TABLE_SHAPE_TYPE = "sqltoerd_table";

const TABLE_MIN_WIDTH = 260;
const TABLE_HEADER_HEIGHT = 54;
const TABLE_ROW_HEIGHT = 42;
const TABLE_BORDER_WIDTH = 1;
const BADGE_MIN_COLUMN_WIDTH = 72;
const BADGE_WIDTH = 30;
const BADGE_GAP = 4;
const ROW_SIDE_PADDING = 24;
const ROW_COLUMN_GAP = 28;
const ROW_CONTENT_SAFETY_PADDING = 16;
const TABLE_NAME_CHAR_WIDTH = 13;
const COLUMN_NAME_CHAR_WIDTH = 10.5;
const COLUMN_TYPE_CHAR_WIDTH = 9.5;

export type SqlErdTableColumnShapeProps = {
  id: string;
  name: string;
  dataType: string;
  primaryKey: boolean;
  foreignKey: boolean;
  unique: boolean;
  nullable: boolean;
};

export type SqlErdTableShapeProps = {
  w: number;
  h: number;
  tableId: string;
  tableName: string;
  schemaName: string | null;
  badgeColumnWidth: number;
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

export function getSqlErdTableShapeSize(table: ErdTable, fallbackWidth?: number) {
  const badgeColumnWidth = getSqlErdTableBadgeColumnWidth(table.columns);
  const titleWidth =
    getTableDisplayName(table).length * TABLE_NAME_CHAR_WIDTH + ROW_SIDE_PADDING * 2;
  const rowContentWidth = Math.max(
    ...table.columns.map(
      (column) =>
        badgeColumnWidth +
        ROW_COLUMN_GAP * 2 +
        column.name.length * COLUMN_NAME_CHAR_WIDTH +
        column.dataType.length * COLUMN_TYPE_CHAR_WIDTH +
        ROW_CONTENT_SAFETY_PADDING
    ),
    0
  );
  const width = Math.ceil(
    Math.max(
      TABLE_MIN_WIDTH,
      fallbackWidth ?? 0,
      titleWidth,
      rowContentWidth + ROW_SIDE_PADDING * 2
    )
  );
  const height =
    TABLE_HEADER_HEIGHT +
    table.columns.length * TABLE_ROW_HEIGHT +
    TABLE_BORDER_WIDTH * 2;

  return { w: width, h: height, badgeColumnWidth };
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

function getColumnBadgeCount(column: SqlErdTableColumnShapeProps) {
  let count = 0;

  if (column.primaryKey) {
    count += 1;
  }

  if (column.foreignKey) {
    count += 1;
  }

  if (column.unique) {
    count += 1;
  }

  if (!column.nullable && !column.primaryKey) {
    count += 1;
  }

  return count;
}

export function getSqlErdTableBadgeColumnWidth(
  columns: SqlErdTableColumnShapeProps[]
) {
  const maxBadgeCount = Math.max(
    ...columns.map((column) => getColumnBadgeCount(column)),
    0
  );

  if (maxBadgeCount === 0) {
    return BADGE_MIN_COLUMN_WIDTH;
  }

  return Math.max(
    BADGE_MIN_COLUMN_WIDTH,
    maxBadgeCount * BADGE_WIDTH + Math.max(0, maxBadgeCount - 1) * BADGE_GAP
  );
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

function SqlErdTableCard({ shape }: { shape: SqlErdTableShape }) {
  const displayName = shape.props.schemaName
    ? `${shape.props.schemaName}.${shape.props.tableName}`
    : shape.props.tableName;

  return (
    <HTMLContainer
      className="overflow-visible"
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <article
        className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.12)]"
        style={{
          height: shape.props.h,
          minWidth: shape.props.w,
          width: shape.props.w
        }}
      >
        <header className="flex h-[54px] items-center border-b border-slate-200 bg-slate-100 px-6">
          <h3 className="whitespace-nowrap text-[22px] font-semibold leading-none text-slate-950">
            {displayName}
          </h3>
        </header>

        <div className="divide-y divide-slate-100">
          {shape.props.columns.map((column, columnIndex) => {
            const badges = getColumnBadges(column);

            return (
              <div
                className="grid h-[42px] items-center px-6 font-mono text-[20px] leading-none"
                key={column.id}
                style={{
                  backgroundColor: columnIndex % 2 === 0 ? "#ffffff" : "#f8fafc",
                  columnGap: ROW_COLUMN_GAP,
                  gridTemplateColumns: `${shape.props.badgeColumnWidth}px max-content max-content`
                }}
              >
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
                <span className="whitespace-nowrap text-right text-slate-400">
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

  override getDefaultProps(): SqlErdTableShape["props"] {
    return {
      w: TABLE_MIN_WIDTH,
      h: TABLE_HEADER_HEIGHT + TABLE_ROW_HEIGHT,
      tableId: "",
      tableName: "",
      schemaName: null,
      badgeColumnWidth: BADGE_MIN_COLUMN_WIDTH,
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
