"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionState, Room, RoomEvent, Track } from "livekit-client";
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

export function useLiveKitMeetingRoom() {
  const roomRef = useRef<Room | null>(null);
  const attachedRemoteAudioRef = useRef<Map<string, AttachedRemoteAudio>>(
    new Map()
  );
  const remoteAudioContainerRef = useRef<HTMLDivElement | null>(null);
  const [activeSpeakerIdentities, setActiveSpeakerIdentities] = useState<
    Set<string>
  >(new Set());
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
    setStatus("idle");
  }, [detachAllRemoteAudio]);

  const connect = useCallback(
    async (livekit: LiveKitJoin, audioDeviceId: string | null = null) => {
      await disconnect();

      const room = new Room();
      roomRef.current = room;
      setErrorMessage(null);
      setRoomName(livekit.livekitRoomName);
      setStatus("connecting");

      const handleConnectionStateChanged = (nextState: ConnectionState) => {
        setStatus(mapConnectionState(nextState));
      };
      const handleDisconnected = () => {
        detachAllRemoteAudio();
        setActiveSpeakerIdentities(new Set());
        setIsMicrophoneEnabled(false);
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

      room
        .on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
        .on(RoomEvent.Disconnected, handleDisconnected)
        .on(RoomEvent.Reconnecting, () => setStatus("reconnecting"))
        .on(RoomEvent.Reconnected, () => setStatus("connected"))
        .on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged)
        .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
        .on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

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
    disconnect,
    errorMessage,
    isConnected: status === "connected",
    isConnecting: status === "connecting" || status === "reconnecting",
    isMicrophoneEnabled,
    remoteAudioContainerRef,
    roomName,
    setMicrophoneEnabled,
    status
  };
}
