import * as dagre from "@dagrejs/dagre";

import type {
  SqltoerdLayoutJsonV1,
  SqltoerdModelJsonV1,
  SqltoerdTableLayout
} from "@/features/sql-erd/types";
import { createSqltoerdLayoutForModel } from "@/features/sql-erd/utils/model";
import { getSqltoerdTableCardSize } from "@/features/sql-erd/utils/table-card-layout";

export type SqltoerdAutoLayoutTableSize = {
  height: number;
  tableId: string;
  width: number;
};

export type SqltoerdMinimumZoomCamera = {
  x: number;
  y: number;
  z: number;
};

type SqltoerdAutoLayoutInput = {
  layoutJson: SqltoerdLayoutJsonV1;
  modelJson: SqltoerdModelJsonV1;
  tableSizes: SqltoerdAutoLayoutTableSize[];
};

type SqltoerdRelatedPlacedLayout = {
  layout: SqltoerdTableLayout;
  position: "left" | "right";
};

const AUTO_LAYOUT_MARGIN = 80;
const AUTO_LAYOUT_NODE_GAP = 72;
const AUTO_LAYOUT_RANK_GAP = 144;
const AUTO_LAYOUT_FALLBACK_HEIGHT = 180;
const AUTO_LAYOUT_FALLBACK_WIDTH = 320;

export function getSqltoerdMinimumZoomCamera(
  pageBounds: { h: number; w: number; x: number; y: number },
  viewport: { height: number; width: number },
  zoom: number
): SqltoerdMinimumZoomCamera {
  return {
    x: -pageBounds.x + (viewport.width - pageBounds.w * zoom) / 2 / zoom,
    y: -pageBounds.y + (viewport.height - pageBounds.h * zoom) / 2 / zoom,
    z: zoom
  };
}

export function createSqltoerdAutoLayout({
  layoutJson,
  modelJson,
  tableSizes
}: SqltoerdAutoLayoutInput): SqltoerdLayoutJsonV1 {
  const tableSizeById = createTableSizeById(tableSizes);
  const graph = new dagre.graphlib.Graph({ multigraph: true });

  graph.setGraph({
    marginx: AUTO_LAYOUT_MARGIN,
    marginy: AUTO_LAYOUT_MARGIN,
    nodesep: AUTO_LAYOUT_NODE_GAP,
    rankdir: "LR",
    ranksep: AUTO_LAYOUT_RANK_GAP,
    ranker: "network-simplex"
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const table of getTablesSortedById(modelJson)) {
    const tableSize = getTableSize(tableSizeById, table.id);

    graph.setNode(table.id, tableSize);
  }

  for (const relation of getRelationsSortedById(modelJson)) {
    if (
      !graph.hasNode(relation.fromTableId) ||
      !graph.hasNode(relation.toTableId)
    ) {
      continue;
    }

    // The parsed relation points from child FK to parent key. Reversing the
    // graph edge makes left-to-right layouts read parent -> child.
    graph.setEdge({
      name: relation.id,
      v: relation.toTableId,
      w: relation.fromTableId
    });
  }

  dagre.layout(graph);

  const previousLayoutsByTableId = new Map(
    layoutJson.tableLayouts.map((tableLayout) => [
      tableLayout.tableId,
      tableLayout
    ])
  );

  return {
    ...layoutJson,
    tableLayouts: modelJson.schema.tables.map((table) => {
      const tableSize = getTableSize(tableSizeById, table.id);
      const dagreNode = graph.node(table.id);
      const previousLayout = previousLayoutsByTableId.get(table.id);

      return {
        ...previousLayout,
        tableId: table.id,
        x: roundLayoutCoordinate(dagreNode.x - tableSize.width / 2),
        y: roundLayoutCoordinate(dagreNode.y - tableSize.height / 2)
      };
    })
  };
}

export function createSqltoerdAutoLayoutTableSizes(
  modelJson: SqltoerdModelJsonV1,
  layoutJson: SqltoerdLayoutJsonV1
): SqltoerdAutoLayoutTableSize[] {
  const previousLayoutsByTableId = new Map(
    layoutJson.tableLayouts.map((tableLayout) => [
      tableLayout.tableId,
      tableLayout
    ])
  );

  return modelJson.schema.tables.map((table) => {
    const previousLayout = previousLayoutsByTableId.get(table.id);
    const tableCardSize = getSqltoerdTableCardSize(
      table,
      previousLayout?.width
    );

    return {
      height: tableCardSize.height,
      tableId: table.id,
      width: tableCardSize.width
    };
  });
}

export function createSqltoerdIncrementalLayout({
  layoutJson,
  modelJson,
  tableSizes
}: SqltoerdAutoLayoutInput): SqltoerdLayoutJsonV1 {
  const baseLayoutJson = createSqltoerdLayoutForModel(modelJson, layoutJson);
  const tableSizeById = createTableSizeById(tableSizes);
  const existingLayoutsByTableId = new Map(
    layoutJson.tableLayouts.map((tableLayout) => [
      tableLayout.tableId,
      tableLayout
    ])
  );
  const placedLayouts = modelJson.schema.tables
    .filter((table) => existingLayoutsByTableId.has(table.id))
    .map((table) => existingLayoutsByTableId.get(table.id)!)
    .map((tableLayout) => ({ ...tableLayout }));
  const placedLayoutsByTableId = new Map(
    placedLayouts.map((tableLayout) => [tableLayout.tableId, tableLayout])
  );

  for (const table of getTablesSortedById(modelJson)) {
    if (placedLayoutsByTableId.has(table.id)) {
      continue;
    }

    const tableSize = getTableSize(tableSizeById, table.id);
    const nextLayout = findIncrementalTableLayout({
      placedLayouts,
      placedLayoutsByTableId,
      relationModel: modelJson,
      tableId: table.id,
      tableSize,
      tableSizeById
    });

    placedLayouts.push(nextLayout);
    placedLayoutsByTableId.set(nextLayout.tableId, nextLayout);
  }

  return {
    ...baseLayoutJson,
    tableLayouts: modelJson.schema.tables.map((table) => {
      const tableLayout = placedLayoutsByTableId.get(table.id);

      if (!tableLayout) {
        throw new Error(`Missing incremental layout for table ${table.id}.`);
      }

      return tableLayout;
    })
  };
}

function createTableSizeById(tableSizes: SqltoerdAutoLayoutTableSize[]) {
  return new Map(
    tableSizes.map((tableSize) => [
      tableSize.tableId,
      {
        height: tableSize.height,
        width: tableSize.width
      }
    ])
  );
}

function getTableSize(
  tableSizeById: Map<string, Omit<SqltoerdAutoLayoutTableSize, "tableId">>,
  tableId: string
) {
  return (
    tableSizeById.get(tableId) ?? {
      height: AUTO_LAYOUT_FALLBACK_HEIGHT,
      width: AUTO_LAYOUT_FALLBACK_WIDTH
    }
  );
}

function getTablesSortedById(modelJson: SqltoerdModelJsonV1) {
  return [...modelJson.schema.tables].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}

function getRelationsSortedById(modelJson: SqltoerdModelJsonV1) {
  return [...modelJson.schema.relations].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}

function findIncrementalTableLayout({
  placedLayouts,
  placedLayoutsByTableId,
  relationModel,
  tableId,
  tableSize,
  tableSizeById
}: {
  placedLayouts: SqltoerdTableLayout[];
  placedLayoutsByTableId: Map<string, SqltoerdTableLayout>;
  relationModel: SqltoerdModelJsonV1;
  tableId: string;
  tableSize: Omit<SqltoerdAutoLayoutTableSize, "tableId">;
  tableSizeById: Map<string, Omit<SqltoerdAutoLayoutTableSize, "tableId">>;
}): SqltoerdTableLayout {
  const relatedPlacedLayouts = getRelatedPlacedLayouts(
    relationModel,
    tableId,
    placedLayoutsByTableId
  );
  const candidates = relatedPlacedLayouts.flatMap((relatedTable) =>
    createRelatedLayoutCandidates({
      position: relatedTable.position,
      relatedLayout: relatedTable.layout,
      relatedSize: getTableSize(tableSizeById, relatedTable.layout.tableId),
      tableId,
      tableSize
    })
  );
  const fallbackCandidate = createFallbackLayoutCandidate(
    placedLayouts,
    tableId,
    tableSize
  );

  for (const candidate of [...candidates, fallbackCandidate]) {
    const availableLayout = findFirstAvailableLayout(
      candidate,
      placedLayouts,
      tableSize,
      tableSizeById
    );

    if (availableLayout) {
      return availableLayout;
    }
  }

  return fallbackCandidate;
}

function getRelatedPlacedLayouts(
  modelJson: SqltoerdModelJsonV1,
  tableId: string,
  placedLayoutsByTableId: Map<string, SqltoerdTableLayout>
): SqltoerdRelatedPlacedLayout[] {
  const relatedLayouts: SqltoerdRelatedPlacedLayout[] = [];

  for (const relation of getRelationsSortedById(modelJson)) {
    if (relation.fromTableId === tableId) {
      const parentLayout = placedLayoutsByTableId.get(relation.toTableId);

      if (parentLayout) {
        relatedLayouts.push({ layout: parentLayout, position: "right" });
      }

      continue;
    }

    if (relation.toTableId === tableId) {
      const childLayout = placedLayoutsByTableId.get(relation.fromTableId);

      if (childLayout) {
        relatedLayouts.push({ layout: childLayout, position: "left" });
      }
    }
  }

  return relatedLayouts;
}

function createRelatedLayoutCandidates({
  relatedLayout,
  relatedSize,
  position,
  tableId,
  tableSize
}: {
  relatedLayout: SqltoerdTableLayout;
  relatedSize: Omit<SqltoerdAutoLayoutTableSize, "tableId">;
  position: "left" | "right";
  tableId: string;
  tableSize: Omit<SqltoerdAutoLayoutTableSize, "tableId">;
}) {
  const verticalOffsets = [0, 1, -1, 2, -2].map(
    (multiplier) => multiplier * (tableSize.height + AUTO_LAYOUT_NODE_GAP)
  );
  const preferredX = position === "right"
    ? relatedLayout.x + relatedSize.width + AUTO_LAYOUT_RANK_GAP
    : relatedLayout.x - tableSize.width - AUTO_LAYOUT_RANK_GAP;

  return verticalOffsets.map((verticalOffset) => ({
    tableId,
    x: preferredX,
    y: relatedLayout.y + verticalOffset
  }));
}

function createFallbackLayoutCandidate(
  placedLayouts: SqltoerdTableLayout[],
  tableId: string,
  tableSize: Omit<SqltoerdAutoLayoutTableSize, "tableId">
): SqltoerdTableLayout {
  if (!placedLayouts.length) {
    return { tableId, x: AUTO_LAYOUT_MARGIN, y: AUTO_LAYOUT_MARGIN };
  }

  const rightmost = Math.max(
    ...placedLayouts.map(
      (tableLayout) =>
        tableLayout.x + (tableLayout.width ?? AUTO_LAYOUT_FALLBACK_WIDTH)
    )
  );
  const topmost = Math.min(...placedLayouts.map((tableLayout) => tableLayout.y));

  return {
    tableId,
    x: rightmost + AUTO_LAYOUT_RANK_GAP,
    y: Math.max(AUTO_LAYOUT_MARGIN, topmost - tableSize.height)
  };
}

function findFirstAvailableLayout(
  candidate: SqltoerdTableLayout,
  placedLayouts: SqltoerdTableLayout[],
  tableSize: Omit<SqltoerdAutoLayoutTableSize, "tableId">,
  tableSizeById: Map<string, Omit<SqltoerdAutoLayoutTableSize, "tableId">>
) {
  for (let row = 0; row < 40; row += 1) {
    const nextCandidate = {
      ...candidate,
      y: candidate.y + row * (tableSize.height + AUTO_LAYOUT_NODE_GAP)
    };

    if (
      !placedLayouts.some((placedLayout) =>
        doLayoutsOverlap(
          nextCandidate,
          tableSize,
          placedLayout,
          getTableSize(tableSizeById, placedLayout.tableId)
        )
      )
    ) {
      return nextCandidate;
    }
  }

  return null;
}

function doLayoutsOverlap(
  leftLayout: SqltoerdTableLayout,
  leftSize: Omit<SqltoerdAutoLayoutTableSize, "tableId">,
  rightLayout: SqltoerdTableLayout,
  rightSize: Omit<SqltoerdAutoLayoutTableSize, "tableId">
) {
  return !(
    leftLayout.x + leftSize.width + AUTO_LAYOUT_NODE_GAP <= rightLayout.x ||
    rightLayout.x + rightSize.width + AUTO_LAYOUT_NODE_GAP <= leftLayout.x ||
    leftLayout.y + leftSize.height + AUTO_LAYOUT_NODE_GAP <= rightLayout.y ||
    rightLayout.y + rightSize.height + AUTO_LAYOUT_NODE_GAP <= leftLayout.y
  );
}

function roundLayoutCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}
