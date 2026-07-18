export type DriveAttachedPdfFollowController = {
  openAtPage: (pageNumber: number) => void;
};

export function createDriveAttachedPdfFollowCoordinator() {
  const controllers = new Map<string, DriveAttachedPdfFollowController>();

  return {
    openAtPage(fileId: string, pageNumber: number) {
      const controller = controllers.get(fileId);
      if (!controller || !Number.isInteger(pageNumber) || pageNumber < 1) {
        return false;
      }
      controller.openAtPage(pageNumber);
      return true;
    },
    register(fileId: string, controller: DriveAttachedPdfFollowController) {
      controllers.set(fileId, controller);
      return () => {
        if (controllers.get(fileId) === controller) controllers.delete(fileId);
      };
    },
  };
}

export const driveAttachedPdfFollowCoordinator =
  createDriveAttachedPdfFollowCoordinator();

export async function restoreDriveAttachedPdfWhenReady({
  coordinator = driveAttachedPdfFollowCoordinator,
  fileId,
  intervalMs,
  pageNumber,
  signal,
  timeoutMs,
}: {
  coordinator?: ReturnType<typeof createDriveAttachedPdfFollowCoordinator>;
  fileId: string;
  intervalMs?: number;
  pageNumber: number;
  signal: AbortSignal;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + (timeoutMs ?? 1_000);
  do {
    if (signal.aborted) return false;
    if (coordinator.openAtPage(fileId, pageNumber)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs ?? 16));
  } while (!signal.aborted);
  return false;
}
