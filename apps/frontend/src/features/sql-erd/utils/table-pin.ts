export type SqlErdTablePinState = {
  navigationRequestId: number;
  pinnedTableId: string | null;
};

type SqlErdTablePinShape = {
  props: {
    h: number;
    tableId: string;
    w: number;
  };
  x: number;
  y: number;
};

export function createSqlErdTablePinState(): SqlErdTablePinState {
  return {
    navigationRequestId: 0,
    pinnedTableId: null
  };
}

export function pinSqlErdTable(
  state: SqlErdTablePinState,
  tableId: string
): SqlErdTablePinState {
  if (state.pinnedTableId === tableId) {
    return {
      ...state,
      navigationRequestId: state.navigationRequestId + 1
    };
  }

  return {
    navigationRequestId: 0,
    pinnedTableId: tableId
  };
}

export function clearSqlErdTablePin(): SqlErdTablePinState {
  return createSqlErdTablePinState();
}

export function getSqlErdPinnedTableCenter(
  tableShapes: SqlErdTablePinShape[],
  tableId: string
) {
  const tableShape = tableShapes.find(
    (shape) => shape.props.tableId === tableId
  );

  if (!tableShape) {
    return null;
  }

  return {
    x: tableShape.x + tableShape.props.w / 2,
    y: tableShape.y + tableShape.props.h / 2
  };
}
