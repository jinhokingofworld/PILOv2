export function formatCanvasCoordinate(value: number) {
  if (!Number.isFinite(value)) return "0";

  const rounded = Math.round(value * 10) / 10;

  return Object.is(rounded, -0) ? "0" : rounded.toFixed(1);
}

export function formatCanvasCoordinatePoint(point: { x: number; y: number }) {
  return `X ${formatCanvasCoordinate(point.x)}  Y ${formatCanvasCoordinate(point.y)}`;
}
