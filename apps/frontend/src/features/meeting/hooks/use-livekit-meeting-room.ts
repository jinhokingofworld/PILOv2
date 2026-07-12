"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionQuality,
  ConnectionState,
  Room,
  RoomEvent,
  Track
} from "livekit-client";
import type {
  Participant as LiveKitParticipant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication
} from "livekit-client";

import type { LiveKitJoin } from "@/features/meeting/types";

export type LiveKitMeetingRoomStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type LiveKitConnectionQuality =
  | "excellent"
  | "good"
  | "poor"
  | "lost"
  | "unknown";

type AttachedRemoteAudio = {
  element: HTMLMediaElement;
  track: RemoteTrack;
};

function getSafeLiveKitErrorMessage() {
  return "음성 회의 연결에 실패했습니다. 마이크 권한과 네트워크 상태를 확인해주세요.";
}

function getRemoteTrackKey(track: RemoteTrack) {
  return track.sid ?? track.mediaStreamTrack.id;
}

function mapConnectionState(state: ConnectionState): LiveKitMeetingRoomStatus {
  switch (state) {
    case ConnectionState.Connected:
      return "connected";
    case ConnectionState.Connecting:
      return "connecting";
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return "reconnecting";
    case ConnectionState.Disconnected:
      return "disconnected";
  }
}

function mapConnectionQuality(
  quality: ConnectionQuality
): LiveKitConnectionQuality {
  switch (quality) {
    case ConnectionQuality.Excellent:
      return "excellent";
    case ConnectionQuality.Good:
      return "good";
    case ConnectionQuality.Poor:
      return "poor";
    case ConnectionQuality.Lost:
      return "lost";
    case ConnectionQuality.Unknown:
      return "unknown";
  }
}

export function useLiveKitMeetingRoom() {
  const roomRef = useRef<Room | null>(null);
  const attachedRemoteAudioRef = useRef<Map<string, AttachedRemoteAudio>>(
    new Map()
  );
  const remoteAudioContainerRef = useRef<HTMLDivElement | null>(null);
  const [activeSpeakerIdentities, setActiveSpeakerIdentities] = useState<
    Set<string>
  >(new Set());
  const [connectionQuality, setConnectionQuality] =
    useState<LiveKitConnectionQuality>("unknown");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMicrophoneEnabled, setIsMicrophoneEnabled] = useState(false);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveKitMeetingRoomStatus>("idle");

  const detachAllRemoteAudio = useCallback(() => {
    attachedRemoteAudioRef.current.forEach(({ element, track }) => {
      track.detach(element);
      element.remove();
    });
    attachedRemoteAudioRef.current.clear();
  }, []);

  const attachRemoteAudio = useCallback((track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Audio) {
      return;
    }

    const key = getRemoteTrackKey(track);
    if (attachedRemoteAudioRef.current.has(key)) {
      return;
    }

    const element = track.attach();
    element.autoplay = true;
    element.dataset.livekitRemoteAudio = "true";
    element.dataset.livekitTrackSid = key;
    remoteAudioContainerRef.current?.appendChild(element);
    attachedRemoteAudioRef.current.set(key, { element, track });
  }, []);

  const detachRemoteAudio = useCallback((track: RemoteTrack) => {
    const key = getRemoteTrackKey(track);
    const attached = attachedRemoteAudioRef.current.get(key);

    if (!attached) {
      track.detach().forEach((element) => element.remove());
      return;
    }

    track.detach(attached.element);
    attached.element.remove();
    attachedRemoteAudioRef.current.delete(key);
  }, []);

  const attachExistingRemoteAudio = useCallback(
    (room: Room) => {
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          const track = publication.track;
          if (track) {
            attachRemoteAudio(track);
          }
        });
      });
    },
    [attachRemoteAudio]
  );

  const disconnect = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;

    if (room) {
      await room.disconnect(true).catch(() => undefined);
    }

    detachAllRemoteAudio();
    setActiveSpeakerIdentities(new Set());
    setErrorMessage(null);
    setIsMicrophoneEnabled(false);
    setRoomName(null);
    setConnectionQuality("unknown");
    setStatus("idle");
  }, [detachAllRemoteAudio]);

  const connect = useCallback(
    async (livekit: LiveKitJoin, audioDeviceId: string | null = null) => {
      await disconnect();

      const room = new Room();
      roomRef.current = room;
      setErrorMessage(null);
      setRoomName(livekit.livekitRoomName);
      setConnectionQuality("unknown");
      setStatus("connecting");

      const handleConnectionStateChanged = (nextState: ConnectionState) => {
        if (roomRef.current !== room) {
          return;
        }
        setStatus(mapConnectionState(nextState));
      };
      const handleDisconnected = () => {
        if (roomRef.current !== room) {
          return;
        }
        detachAllRemoteAudio();
        setActiveSpeakerIdentities(new Set());
        setIsMicrophoneEnabled(false);
        setConnectionQuality("unknown");
        setStatus("disconnected");
      };
      const handleActiveSpeakersChanged = (
        speakers: LiveKitParticipant[]
      ) => {
        setActiveSpeakerIdentities(
          new Set(speakers.map((participant) => participant.identity))
        );
      };
      const handleTrackSubscribed = (
        track: RemoteTrack,
        _publication: RemoteTrackPublication,
        _participant: RemoteParticipant
      ) => {
        attachRemoteAudio(track);
      };
      const handleTrackUnsubscribed = (
        track: RemoteTrack,
        _publication: RemoteTrackPublication,
        _participant: RemoteParticipant
      ) => {
        detachRemoteAudio(track);
      };
      const handleConnectionQualityChanged = (
        quality: ConnectionQuality,
        participant: LiveKitParticipant
      ) => {
        if (
          roomRef.current !== room ||
          participant.identity !== room.localParticipant.identity
        ) {
          return;
        }
        setConnectionQuality(mapConnectionQuality(quality));
      };

      room
        .on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
        .on(RoomEvent.Disconnected, handleDisconnected)
        .on(RoomEvent.Reconnecting, () => {
          if (roomRef.current === room) {
            setConnectionQuality("unknown");
            setStatus("reconnecting");
          }
        })
        .on(RoomEvent.Reconnected, () => {
          if (roomRef.current === room) {
            setStatus("connected");
          }
        })
        .on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged)
        .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
        .on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
        .on(RoomEvent.ConnectionQualityChanged, handleConnectionQualityChanged);

      try {
        await room.connect(livekit.livekitUrl, livekit.livekitToken);
        await room.startAudio();
        await room.localParticipant.setMicrophoneEnabled(
          true,
          audioDeviceId ? { deviceId: audioDeviceId } : undefined
        );
        attachExistingRemoteAudio(room);
        setIsMicrophoneEnabled(true);
        setStatus("connected");
      } catch (error) {
        await room.disconnect(true).catch(() => undefined);
        detachAllRemoteAudio();
        roomRef.current = null;
        setErrorMessage(getSafeLiveKitErrorMessage());
        setIsMicrophoneEnabled(false);
        setRoomName(null);
        setConnectionQuality("unknown");
        setStatus("error");
        throw error;
      }
    },
    [
      attachExistingRemoteAudio,
      attachRemoteAudio,
      detachAllRemoteAudio,
      detachRemoteAudio,
      disconnect
    ]
  );

  const setMicrophoneEnabled = useCallback(async (enabled: boolean) => {
    const room = roomRef.current;
    if (!room) {
      return;
    }

    await room.localParticipant.setMicrophoneEnabled(enabled);
    setIsMicrophoneEnabled(enabled);
  }, []);

  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = null;
      void room?.disconnect(true);
      detachAllRemoteAudio();
    };
  }, [detachAllRemoteAudio]);

  return {
    activeSpeakerIdentities,
    connect,
    connectionQuality,
    disconnect,
    errorMessage,
    hasActiveSession: roomName !== null,
    isConnected: status === "connected",
    isConnecting: status === "connecting" || status === "reconnecting",
    isMicrophoneEnabled,
    remoteAudioContainerRef,
    roomName,
    setMicrophoneEnabled,
    status
  };
}
