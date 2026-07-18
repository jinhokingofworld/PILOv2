export type PublisherStatus =
  | "idle"
  | "selecting"
  | "reserving"
  | "connecting"
  | "sharing"
  | "stopping";

export type ViewerStatus = "closed" | "connecting" | "viewing";
export type ViewerMode = "floating" | "focus" | "fullscreen";

export type ScreenShareState = {
  publisher: {
    status: PublisherStatus;
    sessionId: string | null;
    error: string | null;
  };
  viewer: {
    status: ViewerStatus;
    sessionId: string | null;
    mode: ViewerMode;
    error: string | null;
  };
};

export type ScreenShareAction =
  | { type: "publisher/selecting" }
  | { type: "publisher/picker-cancelled" }
  | { type: "publisher/reserving" }
  | { type: "publisher/connecting"; sessionId: string }
  | { type: "publisher/sharing"; sessionId: string }
  | { type: "publisher/stopping"; sessionId: string }
  | { type: "publisher/stopped"; sessionId: string }
  | { type: "publisher/failed"; sessionId: string | null; error: string }
  | { type: "viewer/connecting"; sessionId: string }
  | { type: "viewer/connected"; sessionId: string }
  | { type: "viewer/floating-entered" }
  | { type: "viewer/focus-entered" }
  | { type: "viewer/fullscreen-entered" }
  | { type: "viewer/fullscreen-exited" }
  | { type: "viewer/closed"; sessionId: string }
  | { type: "viewer/ended"; sessionId: string }
  | { type: "viewer/failed"; sessionId: string; error: string };

const idlePublisher: ScreenShareState["publisher"] = {
  status: "idle",
  sessionId: null,
  error: null
};

const closedViewer: ScreenShareState["viewer"] = {
  status: "closed",
  sessionId: null,
  mode: "floating",
  error: null
};

export const initialScreenShareState: ScreenShareState = {
  publisher: idlePublisher,
  viewer: closedViewer
};

function withPublisher(
  state: ScreenShareState,
  publisher: ScreenShareState["publisher"]
): ScreenShareState {
  return { ...state, publisher };
}

function withViewer(
  state: ScreenShareState,
  viewer: ScreenShareState["viewer"]
): ScreenShareState {
  return { ...state, viewer };
}

function hasPublisherSession(state: ScreenShareState, sessionId: string) {
  return state.publisher.sessionId === sessionId;
}

function hasViewerSession(state: ScreenShareState, sessionId: string) {
  return state.viewer.sessionId === sessionId;
}

export function reduceScreenShareState(
  state: ScreenShareState,
  action: ScreenShareAction
): ScreenShareState {
  switch (action.type) {
    case "publisher/selecting":
      return withPublisher(state, { ...idlePublisher, status: "selecting" });
    case "publisher/picker-cancelled":
      return state.publisher.status === "selecting"
        ? withPublisher(state, idlePublisher)
        : state;
    case "publisher/reserving":
      return state.publisher.status === "selecting"
        ? withPublisher(state, { ...idlePublisher, status: "reserving" })
        : state;
    case "publisher/connecting":
      return state.publisher.status === "reserving"
        ? withPublisher(state, {
            status: "connecting",
            sessionId: action.sessionId,
            error: null
          })
        : state;
    case "publisher/sharing":
      return state.publisher.status === "connecting" &&
        hasPublisherSession(state, action.sessionId)
        ? withPublisher(state, { ...state.publisher, status: "sharing" })
        : state;
    case "publisher/stopping":
      return state.publisher.status === "sharing" &&
        hasPublisherSession(state, action.sessionId)
        ? withPublisher(state, { ...state.publisher, status: "stopping" })
        : state;
    case "publisher/stopped":
      return state.publisher.status === "stopping" &&
        hasPublisherSession(state, action.sessionId)
        ? withPublisher(state, idlePublisher)
        : state;
    case "publisher/failed":
      if (action.sessionId === null) {
        return state.publisher.sessionId === null &&
          (state.publisher.status === "selecting" ||
            state.publisher.status === "reserving")
          ? withPublisher(state, { ...idlePublisher, error: action.error })
          : state;
      }
      return hasPublisherSession(state, action.sessionId)
        ? withPublisher(state, { ...idlePublisher, error: action.error })
        : state;
    case "viewer/connecting":
      return withViewer(state, {
        status: "connecting",
        sessionId: action.sessionId,
        mode: "floating",
        error: null
      });
    case "viewer/connected":
      return state.viewer.status === "connecting" &&
        hasViewerSession(state, action.sessionId)
        ? withViewer(state, { ...state.viewer, status: "viewing" })
        : state;
    case "viewer/floating-entered":
      return state.viewer.status === "viewing"
        ? withViewer(state, { ...state.viewer, mode: "floating" })
        : state;
    case "viewer/focus-entered":
      return state.viewer.status === "viewing"
        ? withViewer(state, { ...state.viewer, mode: "focus" })
        : state;
    case "viewer/fullscreen-entered":
      return state.viewer.status === "viewing"
        ? withViewer(state, { ...state.viewer, mode: "fullscreen" })
        : state;
    case "viewer/fullscreen-exited":
      return state.viewer.status === "viewing" &&
        state.viewer.mode === "fullscreen"
        ? withViewer(state, { ...state.viewer, mode: "focus" })
        : state;
    case "viewer/closed":
    case "viewer/ended":
      return hasViewerSession(state, action.sessionId)
        ? withViewer(state, closedViewer)
        : state;
    case "viewer/failed":
      return hasViewerSession(state, action.sessionId)
        ? withViewer(state, { ...closedViewer, error: action.error })
        : state;
  }
}
