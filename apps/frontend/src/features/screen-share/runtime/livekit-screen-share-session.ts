import { RoomEvent, Track } from "livekit-client";

import type { ScreenShareApiClient } from "../api/client.ts";
import type { LiveKitJoin, StartScreenSharePayload } from "../types.ts";

type LocalScreenTrack = {
  source: Track.Source;
  mediaStreamTrack: {
    addEventListener(
      type: "ended",
      listener: () => void,
      options?: { once?: boolean }
    ): void;
    removeEventListener(type: "ended", listener: () => void): void;
  };
  stop(): void;
};

type RemoteScreenTrack = {
  source?: Track.Source;
};

type TrackPublication = {
  source?: Track.Source;
};

type ScreenShareRoom = {
  localParticipant: {
    publishTrack(track: LocalScreenTrack): Promise<unknown>;
  };
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  on(
    event: typeof RoomEvent.TrackSubscribed,
    handler: (track: RemoteScreenTrack, publication: TrackPublication) => void
  ): ScreenShareRoom;
  off(
    event: typeof RoomEvent.TrackSubscribed,
    handler: (track: RemoteScreenTrack, publication: TrackPublication) => void
  ): ScreenShareRoom;
};

type PublisherApi = Pick<ScreenShareApiClient, "start" | "end">;
type ViewerApi = Pick<ScreenShareApiClient, "createViewerToken">;

type PublisherDependencies = {
  workspaceId: string;
  api: PublisherApi;
  createLocalScreenTracks(options: {
    audio: false;
  }): Promise<LocalScreenTrack[]>;
  createRoom(): ScreenShareRoom;
  onNativeStop(): void;
};

type ViewerDependencies<Element> = {
  workspaceId: string;
  sessionId: string;
  api: ViewerApi;
  createRoom(): ScreenShareRoom;
  mediaElements: {
    attach(track: RemoteScreenTrack): Element;
    detach(track: RemoteScreenTrack, element: Element): void;
  };
};

export type PublisherSession = {
  sessionId: string;
  stop(): Promise<void>;
};

export type ViewerSession<Element> = {
  readonly element: Element | null;
  sessionId: string;
  stop(): Promise<void>;
};

async function settle(tasks: Array<Promise<unknown>>) {
  await Promise.allSettled(tasks);
}

function stopTracks(tracks: LocalScreenTrack[]) {
  for (const track of tracks) {
    track.stop();
  }
}

export async function createPublisherSession({
  workspaceId,
  api,
  createLocalScreenTracks,
  createRoom,
  onNativeStop
}: PublisherDependencies): Promise<PublisherSession> {
  const tracks = await createLocalScreenTracks({ audio: false });
  let room: ScreenShareRoom | null = null;
  let start: StartScreenSharePayload | null = null;
  let stopped = false;
  let nativeStopCalled = false;
  let screenTrack: LocalScreenTrack | null = null;

  const handleNativeStop = () => {
    if (nativeStopCalled) return;
    nativeStopCalled = true;
    onNativeStop();
  };

  const cleanup = async (endSession: boolean) => {
    if (stopped) return;
    stopped = true;
    if (screenTrack) {
      screenTrack.mediaStreamTrack.removeEventListener(
        "ended",
        handleNativeStop
      );
    }
    stopTracks(tracks);
    await settle([
      ...(room ? [room.disconnect()] : []),
      ...(endSession && start ? [api.end(workspaceId, start.id)] : [])
    ]);
  };

  try {
    screenTrack =
      tracks.find((track) => track.source === Track.Source.ScreenShare) ?? null;
    if (!screenTrack) {
      throw new Error("Screen capture did not provide a video track");
    }

    start = await api.start(workspaceId);
    room = createRoom();
    await room.connect(start.livekitUrl, start.livekitToken);
    await room.localParticipant.publishTrack(screenTrack);
    screenTrack.mediaStreamTrack.addEventListener(
      "ended",
      handleNativeStop,
      { once: true }
    );

    return {
      sessionId: start.id,
      stop: () => cleanup(true)
    };
  } catch (error) {
    await cleanup(start !== null);
    throw error;
  }
}

export async function createViewerSession<Element>({
  workspaceId,
  sessionId,
  api,
  createRoom,
  mediaElements
}: ViewerDependencies<Element>): Promise<ViewerSession<Element>> {
  let join: LiveKitJoin | null = null;
  let room: ScreenShareRoom | null = null;
  let attached: { track: RemoteScreenTrack; element: Element } | null = null;
  let stopped = false;

  const handleTrackSubscribed = (
    track: RemoteScreenTrack,
    publication: TrackPublication
  ) => {
    const source = publication.source ?? track.source;
    if (source !== Track.Source.ScreenShare || attached) return;
    attached = { track, element: mediaElements.attach(track) };
  };

  const cleanup = async () => {
    if (stopped) return;
    stopped = true;
    if (room) {
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    }
    if (attached) {
      mediaElements.detach(attached.track, attached.element);
      attached = null;
    }
    if (room) {
      await settle([room.disconnect()]);
    }
  };

  try {
    join = await api.createViewerToken(workspaceId, sessionId);
    room = createRoom();
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    await room.connect(join.livekitUrl, join.livekitToken);

    return {
      get element() {
        return attached?.element ?? null;
      },
      sessionId,
      stop: cleanup
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
