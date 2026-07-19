import {
  ScreenSharePresets,
  type RoomOptions,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions
} from "livekit-client";

export const screenShareCaptureOptions = {
  audio: false,
  contentHint: "detail",
  preferCurrentTab: true,
  resolution: { width: 1920, height: 1080, frameRate: 15 },
  selfBrowserSurface: "include"
} satisfies ScreenShareCaptureOptions;

export const screenSharePublishOptions = {
  screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
  screenShareSimulcastLayers: [
    ScreenSharePresets.h360fps3,
    ScreenSharePresets.h720fps5
  ]
} satisfies TrackPublishOptions;

export const publisherScreenShareRoomOptions = {
  dynacast: true
} satisfies RoomOptions;

export const viewerScreenShareRoomOptions = {
  adaptiveStream: true
} satisfies RoomOptions;
