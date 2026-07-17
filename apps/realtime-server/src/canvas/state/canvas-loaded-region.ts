import type {
  CanvasLoadedViewportBounds,
  CanvasRoomLoadedRegion,
  CanvasRoomRef,
} from "../contracts/canvas-types";

const MAX_ROOM_LOADED_REGIONS = 64;

export function isCoveringRegion(
  region: CanvasRoomLoadedRegion,
  bounds: CanvasLoadedViewportBounds,
) {
  const left = bounds.x - bounds.margin;
  const top = bounds.y - bounds.margin;
  const right = bounds.x + bounds.width + bounds.margin;
  const bottom = bounds.y + bounds.height + bounds.margin;

  return (
    region.left <= left &&
    region.top <= top &&
    region.right >= right &&
    region.bottom >= bottom
  );
}

export function createLoadedRegion(
  room: CanvasRoomRef,
  bounds: CanvasLoadedViewportBounds,
): CanvasRoomLoadedRegion {
  const left = bounds.x - bounds.margin;
  const top = bounds.y - bounds.margin;
  const right = bounds.x + bounds.width + bounds.margin;
  const bottom = bounds.y + bounds.height + bounds.margin;

  return {
    bottom,
    id: `${room.workspaceId}:${room.canvasId}:${Math.round(left)}:${Math.round(top)}:${Math.round(right)}:${Math.round(bottom)}`,
    left,
    loadedAt: new Date().toISOString(),
    right,
    top,
  };
}

export function mergeLoadedRegions(
  regions: CanvasRoomLoadedRegion[],
  nextRegion: CanvasRoomLoadedRegion,
) {
  const mergedRegion = { ...nextRegion };
  const remainingRegions: CanvasRoomLoadedRegion[] = [];

  regions.forEach((region) => {
    if (!doRegionsOverlap(region, mergedRegion)) {
      remainingRegions.push(region);
      return;
    }

    mergedRegion.bottom = Math.max(mergedRegion.bottom, region.bottom);
    mergedRegion.left = Math.min(mergedRegion.left, region.left);
    mergedRegion.loadedAt =
      region.loadedAt < mergedRegion.loadedAt
        ? region.loadedAt
        : mergedRegion.loadedAt;
    mergedRegion.right = Math.max(mergedRegion.right, region.right);
    mergedRegion.top = Math.min(mergedRegion.top, region.top);
  });

  return [...remainingRegions, mergedRegion]
    .sort((left, right) => left.loadedAt.localeCompare(right.loadedAt))
    .slice(-MAX_ROOM_LOADED_REGIONS);
}

function doRegionsOverlap(
  leftRegion: CanvasRoomLoadedRegion,
  rightRegion: CanvasRoomLoadedRegion,
) {
  return (
    leftRegion.left <= rightRegion.right &&
    leftRegion.right >= rightRegion.left &&
    leftRegion.top <= rightRegion.bottom &&
    leftRegion.bottom >= rightRegion.top
  );
}
