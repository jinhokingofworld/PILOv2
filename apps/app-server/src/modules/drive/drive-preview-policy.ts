export const DRIVE_INLINE_IMAGE_MIME_TYPES = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;

const DRIVE_INLINE_PREVIEW_MIME_TYPES = new Set([
  "application/json",
  "application/pdf",
  ...DRIVE_INLINE_IMAGE_MIME_TYPES,
  "text/css",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/x-c",
  "text/x-c++src",
  "text/x-java-source",
  "text/x-python",
  "text/x-sql",
  "text/xml"
]);

export function normalizeDriveMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function isDriveInlinePreviewMimeType(mimeType: string): boolean {
  return DRIVE_INLINE_PREVIEW_MIME_TYPES.has(normalizeDriveMimeType(mimeType));
}
