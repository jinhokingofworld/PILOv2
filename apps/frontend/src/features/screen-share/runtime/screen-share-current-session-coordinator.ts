type CurrentSessionSnapshot = {
  session: unknown;
};

type ScreenShareCurrentSessionCoordinatorOptions<
  Snapshot extends CurrentSessionSnapshot
> = {
  getCurrent: (workspaceId: string) => Promise<Snapshot>;
  isCurrentWorkspace: (workspaceId: string) => boolean;
  onSnapshot: (snapshot: Snapshot) => void;
  workspaceId: string;
};

export class ScreenShareCurrentSessionCoordinator<
  Snapshot extends CurrentSessionSnapshot
> {
  private disposed = false;
  private generation = 0;
  private inFlight = false;
  private pending = false;
  private readonly options: ScreenShareCurrentSessionCoordinatorOptions<Snapshot>;

  constructor(options: ScreenShareCurrentSessionCoordinatorOptions<Snapshot>) {
    this.options = options;
  }

  invalidate() {
    if (this.disposed) return;

    this.generation += 1;
    this.pending = true;
    this.runNext();
  }

  dispose() {
    this.disposed = true;
    this.generation += 1;
    this.pending = false;
  }

  private runNext() {
    if (this.disposed || this.inFlight || !this.pending) return;

    this.pending = false;
    this.inFlight = true;
    const generation = this.generation;
    const { getCurrent, isCurrentWorkspace, onSnapshot, workspaceId } =
      this.options;

    void getCurrent(workspaceId)
      .then((snapshot) => {
        if (
          !this.disposed &&
          generation === this.generation &&
          isCurrentWorkspace(workspaceId)
        ) {
          onSnapshot(snapshot);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = false;
        this.runNext();
      });
  }
}
