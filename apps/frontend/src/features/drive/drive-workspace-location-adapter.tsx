"use client";

import { useMemo, type RefObject } from "react";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import { restoreDriveAttachedPdfWhenReady } from "./drive-attached-pdf-follow";
import {
  createDriveDocumentWorkspaceLocation,
  createDrivePdfWorkspaceLocation,
  createDriveWorkspaceLocation,
  getDriveScrollOffset,
  readDriveWorkspaceTarget,
  waitForDriveSurfaceTarget,
} from "./drive-workspace-location";

function getDocumentScroller() {
  return document.scrollingElement ?? document.documentElement;
}

function findDriveDocumentSurface(documentId: string) {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-workspace-follow-drive-document-id]",
    ),
  ).find(
    (element) => element.dataset.workspaceFollowDriveDocumentId === documentId,
  ) ?? null;
}

function findDrivePdfScroller(fileId: string) {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-workspace-follow-drive-pdf-file-id]",
    ),
  ).find(
    (element) => element.dataset.workspaceFollowDrivePdfFileId === fileId,
  ) ?? null;
}

function findOpenDrivePdfScroller() {
  return document.querySelector<HTMLElement>(
    "[data-workspace-follow-drive-pdf-file-id][data-workspace-follow-drive-pdf-page]",
  );
}

function readDrivePdfPage(pdf: HTMLElement) {
  const pageNumber = Number(pdf.dataset.workspaceFollowDrivePdfPage);
  return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : null;
}

export function DriveWorkspaceLocationAdapter({
  documentId,
  folderId,
  listRef,
  loadFolder,
  openPdf,
  pdfFileId,
  pdfPageNumber,
  setPdfPageNumber,
  workspaceId,
}: {
  documentId: string | null;
  folderId: string | null;
  listRef: RefObject<HTMLDivElement | null>;
  loadFolder: (folderId: string | null) => Promise<boolean>;
  openPdf: (fileId: string, folderId: string | null) => Promise<boolean>;
  pdfFileId: string | null;
  pdfPageNumber: number;
  setPdfPageNumber: (pageNumber: number) => void;
  workspaceId: string;
}) {
  const adapter = useMemo(
    () => ({
      capture() {
        const pdf = pdfFileId
          ? findDrivePdfScroller(pdfFileId)
          : documentId
            ? findOpenDrivePdfScroller()
            : null;
        const currentPdfFileId =
          pdf?.dataset.workspaceFollowDrivePdfFileId ?? null;
        const currentPdfPageNumber = pdf ? readDrivePdfPage(pdf) : null;
        if (pdf && currentPdfFileId && currentPdfPageNumber) {
          return createDrivePdfWorkspaceLocation({
            documentId,
            fileId: currentPdfFileId,
            folderId: documentId ? null : folderId,
            metrics: {
              clientHeight: pdf.clientHeight,
              clientWidth: pdf.clientWidth,
              scrollHeight: pdf.scrollHeight,
              scrollLeft: pdf.scrollLeft,
              scrollTop: pdf.scrollTop,
              scrollWidth: pdf.scrollWidth,
            },
            pageNumber: currentPdfPageNumber,
          }) as WorkspacePresenceLocation;
        }
        if (documentId && findDriveDocumentSurface(documentId)) {
          const scroller = getDocumentScroller();
          return createDriveDocumentWorkspaceLocation(documentId, {
            clientHeight: scroller.clientHeight,
            clientWidth: scroller.clientWidth,
            scrollHeight: scroller.scrollHeight,
            scrollLeft: scroller.scrollLeft,
            scrollTop: scroller.scrollTop,
            scrollWidth: scroller.scrollWidth,
          });
        }
        const list = listRef.current;
        if (!list) return null;
        return createDriveWorkspaceLocation(folderId, {
          clientHeight: list.clientHeight,
          clientWidth: list.clientWidth,
          scrollHeight: list.scrollHeight,
          scrollLeft: list.scrollLeft,
          scrollTop: list.scrollTop,
          scrollWidth: list.scrollWidth,
        });
      },
      page: "drive" as const,
      ready: Boolean(workspaceId),
      async restore(
        location: WorkspacePresenceLocation,
        { signal }: { signal: AbortSignal },
      ) {
        if (signal.aborted) return false;
        const target = readDriveWorkspaceTarget(location);
        if (!target) return false;
        if (target.surface === "document") {
          const surface = await waitForDriveSurfaceTarget({
            findTarget: () => findDriveDocumentSurface(target.documentId),
            signal,
            timeoutMs: 5_000,
          });
          if (!surface || signal.aborted) return false;
          const scroller = getDocumentScroller();
          window.scrollTo(
            getDriveScrollOffset(target.viewport, {
              clientHeight: scroller.clientHeight,
              clientWidth: scroller.clientWidth,
              scrollHeight: scroller.scrollHeight,
              scrollWidth: scroller.scrollWidth,
            }),
          );
          return true;
        }
        if (target.surface === "pdf") {
          if ("documentId" in target) {
            if (target.documentId !== documentId) return false;
            const opened = await restoreDriveAttachedPdfWhenReady({
              fileId: target.fileId,
              pageNumber: target.pageNumber,
              signal,
              timeoutMs: 5_000,
            });
            if (!opened || signal.aborted) return false;
          } else {
            if (
              !(await openPdf(target.fileId, target.folderId)) ||
              signal.aborted
            ) {
              return false;
            }
            setPdfPageNumber(target.pageNumber);
          }
          const pdf = await waitForDriveSurfaceTarget({
            findTarget: () => findDrivePdfScroller(target.fileId),
            signal,
            timeoutMs: 5_000,
          });
          if (!pdf || signal.aborted) return false;
          pdf.scrollTo(
            getDriveScrollOffset(target.viewport, {
              clientHeight: pdf.clientHeight,
              clientWidth: pdf.clientWidth,
              scrollHeight: pdf.scrollHeight,
              scrollWidth: pdf.scrollWidth,
            }),
          );
          return true;
        }

        if (!(await loadFolder(target.folderId)) || signal.aborted) return false;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const list = listRef.current;
        if (!list || signal.aborted) return false;
        list.scrollTo(
          getDriveScrollOffset(target.viewport, {
            clientHeight: list.clientHeight,
            clientWidth: list.clientWidth,
            scrollHeight: list.scrollHeight,
            scrollWidth: list.scrollWidth,
          }),
        );
        return true;
      },
    }),
    [
      documentId,
      folderId,
      listRef,
      loadFolder,
      openPdf,
      pdfFileId,
      pdfPageNumber,
      setPdfPageNumber,
      workspaceId,
    ],
  );
  useWorkspaceLocationAdapter(adapter);
  return null;
}
