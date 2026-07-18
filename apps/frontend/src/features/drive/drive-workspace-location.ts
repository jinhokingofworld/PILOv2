type ScrollMetrics = {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
};

type DriveLocationLike = {
  context: Record<string, string | null | undefined>;
  page: string;
  viewport: {
    kind: string;
    key?: string;
    xRatio?: number;
    yRatio?: number;
  };
};

export const DRIVE_PDF_SURFACE_KEY = "drive-pdf";

function normalizedId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function ratio(offset: number, size: number, clientSize: number) {
  const range = Math.max(size - clientSize, 0);
  return range ? Math.min(Math.max(offset / range, 0), 1) : 0;
}

export function createDriveWorkspaceLocation(
  folderId: string | null,
  metrics: ScrollMetrics,
) {
  return {
    context: { documentId: null, folderId, pdfFileId: null, pdfPage: null },
    page: "drive" as const,
    route: {
      pathname: "/files",
      search: folderId ? `?folderId=${encodeURIComponent(folderId)}` : "",
    },
    viewport: {
      key: "drive-list" as const,
      kind: "element" as const,
      xRatio: ratio(metrics.scrollLeft, metrics.scrollWidth, metrics.clientWidth),
      yRatio: ratio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight),
    },
  };
}

export function createDriveDocumentWorkspaceLocation(
  documentId: string,
  metrics: ScrollMetrics,
) {
  return {
    context: {
      documentId,
      folderId: null,
      pdfFileId: null,
      pdfPage: null,
    },
    page: "drive" as const,
    route: {
      pathname: "/files",
      search: `?documentId=${encodeURIComponent(documentId)}`,
    },
    viewport: {
      kind: "document" as const,
      xRatio: ratio(metrics.scrollLeft, metrics.scrollWidth, metrics.clientWidth),
      yRatio: ratio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight),
    },
  };
}

export function createDrivePdfWorkspaceLocation({
  documentId = null,
  fileId,
  folderId,
  metrics,
  pageNumber,
}: {
  documentId?: string | null;
  fileId: string;
  folderId: string | null;
  metrics: ScrollMetrics;
  pageNumber: number;
}) {
  return {
    context: {
      documentId,
      folderId,
      pdfFileId: fileId,
      pdfPage: String(pageNumber),
    },
    page: "drive" as const,
    route: {
      pathname: "/files",
      search: documentId
        ? `?documentId=${encodeURIComponent(documentId)}`
        : folderId
          ? `?folderId=${encodeURIComponent(folderId)}`
          : "",
    },
    viewport: {
      kind: "element" as const,
      key: DRIVE_PDF_SURFACE_KEY,
      xRatio: ratio(metrics.scrollLeft, metrics.scrollWidth, metrics.clientWidth),
      yRatio: ratio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight),
    },
  };
}

export function readDriveFolderId(location: {
  context: Record<string, string | null>;
}) {
  return location.context.folderId ?? null;
}

export function getDriveScrollOffset(
  viewport: { xRatio: number; yRatio: number },
  metrics: Omit<ScrollMetrics, "scrollLeft" | "scrollTop">,
) {
  return {
    left: viewport.xRatio * Math.max(metrics.scrollWidth - metrics.clientWidth, 0),
    top: viewport.yRatio * Math.max(metrics.scrollHeight - metrics.clientHeight, 0),
  };
}

export function readDriveWorkspaceTarget(location: DriveLocationLike) {
  if (location.page !== "drive") return null;
  const { viewport } = location;
  const documentId = normalizedId(location.context.documentId);
  if (
    documentId &&
    viewport.kind === "document" &&
    Number.isFinite(viewport.xRatio) &&
    Number.isFinite(viewport.yRatio)
  ) {
    return {
      documentId,
      surface: "document" as const,
      viewport: {
        kind: "document" as const,
        xRatio: viewport.xRatio!,
        yRatio: viewport.yRatio!,
      },
    };
  }

  const fileId = normalizedId(location.context.pdfFileId);
  const parsedPage = Number(location.context.pdfPage);
  if (
    fileId &&
    Number.isInteger(parsedPage) &&
    parsedPage > 0 &&
    viewport.kind === "element" &&
    viewport.key === DRIVE_PDF_SURFACE_KEY &&
    Number.isFinite(viewport.xRatio) &&
    Number.isFinite(viewport.yRatio)
  ) {
    const pdfDocumentId = normalizedId(location.context.documentId);
    return {
      ...(pdfDocumentId ? { documentId: pdfDocumentId } : {}),
      fileId,
      folderId: normalizedId(location.context.folderId),
      pageNumber: parsedPage,
      surface: "pdf" as const,
      viewport: {
        kind: "element" as const,
        key: DRIVE_PDF_SURFACE_KEY,
        xRatio: viewport.xRatio!,
        yRatio: viewport.yRatio!,
      },
    };
  }

  if (
    !documentId &&
    !fileId &&
    viewport.kind === "element" &&
    viewport.key === "drive-list" &&
    Number.isFinite(viewport.xRatio) &&
    Number.isFinite(viewport.yRatio)
  ) {
    return {
      folderId: normalizedId(location.context.folderId),
      surface: "list" as const,
      viewport: {
        kind: "element" as const,
        key: "drive-list" as const,
        xRatio: viewport.xRatio!,
        yRatio: viewport.yRatio!,
      },
    };
  }
  return null;
}

function waitForNextPoll(signal: AbortSignal, intervalMs: number) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timerId);
      resolve(false);
    };
    const timerId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, intervalMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForDriveSurfaceTarget<T>({
  findTarget,
  intervalMs = 16,
  signal,
  timeoutMs = 1_000,
}: {
  findTarget: () => T | null;
  intervalMs?: number;
  signal: AbortSignal;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (signal.aborted) return null;
    const target = findTarget();
    if (target) return target;
    if (Date.now() >= deadline) return null;
  } while (await waitForNextPoll(signal, intervalMs));
  return null;
}
