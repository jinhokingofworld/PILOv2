export type PublicScreenShareSession = {
  id: string;
  sharer: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  };
  startedAt: string;
};

export type LiveKitJoin = {
  livekitUrl: string;
  livekitToken: string;
  expiresAt: string;
};

export type StartScreenSharePayload = LiveKitJoin & {
  id: string;
  status: "starting";
  startedAt: null;
  sharer: PublicScreenShareSession["sharer"];
};
