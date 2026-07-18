export type CanvasDriveFileReference = {
  fileId: string;
  fileName: string;
  mimeType: string;
};

const CANVAS_DRIVE_TEXT_MIME_TYPES = new Set([
  "application/json",
  "text/css",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/x-c",
  "text/x-c++src",
  "text/x-java-source",
  "text/x-python",
  "text/x-sql",
  "text/xml",
]);

export function normalizeCanvasDriveMimeType(mimeType: string) {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function isCanvasDriveImageMimeType(mimeType: string) {
  return [
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
  ].includes(normalizeCanvasDriveMimeType(mimeType));
}

export function isCanvasDriveTextMimeType(mimeType: string) {
  const normalizedMimeType = normalizeCanvasDriveMimeType(mimeType);

  return CANVAS_DRIVE_TEXT_MIME_TYPES.has(normalizedMimeType);
}

export function isCanvasDrivePreviewMimeType(mimeType: string) {
  const normalizedMimeType = normalizeCanvasDriveMimeType(mimeType);

  return (
    normalizedMimeType === "application/pdf" ||
    isCanvasDriveImageMimeType(normalizedMimeType) ||
    isCanvasDriveTextMimeType(normalizedMimeType)
  );
}
