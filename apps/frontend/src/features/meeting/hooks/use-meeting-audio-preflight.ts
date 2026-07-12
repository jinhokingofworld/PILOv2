"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MeetingAudioPreflightStatus =
  | "idle"
  | "requesting"
  | "ready"
  | "error";

const PREVIEW_ERROR_MESSAGE =
  "마이크를 확인하지 못했습니다. 권한과 입력 장치를 확인한 뒤 다시 시도해주세요.";

function toInputLevel(samples: Uint8Array) {
  let sum = 0;

  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }

  return Math.min(1, Math.sqrt(sum / samples.length) * 3);
}

export function useMeetingAudioPreflight() {
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previewRequestIdRef = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [status, setStatus] = useState<MeetingAudioPreflightStatus>("idle");

  const releaseResources = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const readInputDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }

    const nextDevices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audioinput"
    );
    setDevices(nextDevices);
    setSelectedDeviceId((currentDeviceId) =>
      currentDeviceId && !nextDevices.some((device) => device.deviceId === currentDeviceId)
        ? null
        : currentDeviceId
    );
    return nextDevices;
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);

    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    const samples = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    audioContextRef.current = audioContext;

    const updateLevel = () => {
      analyser.getByteTimeDomainData(samples);
      setInputLevel(toInputLevel(samples));
      animationFrameRef.current = window.requestAnimationFrame(updateLevel);
    };

    updateLevel();
  }, []);

  const requestPreview = useCallback(
    async (deviceId: string | null = null) => {
      const requestId = previewRequestIdRef.current + 1;
      previewRequestIdRef.current = requestId;
      releaseResources();

      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMessage(PREVIEW_ERROR_MESSAGE);
        setStatus("error");
        return false;
      }

      setErrorMessage(null);
      setInputLevel(0);
      setStatus("requesting");

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
          video: false
        });
        if (previewRequestIdRef.current !== requestId) {
          stream.getTracks().forEach((track) => track.stop());
          return false;
        }
        streamRef.current = stream;
        const inputDevices = await readInputDevices();
        if (previewRequestIdRef.current !== requestId) {
          return false;
        }
        if (!inputDevices.length) {
          throw new Error("No audio input device is available");
        }
        const trackDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId;
        const nextDeviceId =
          [trackDeviceId, deviceId, inputDevices[0]?.deviceId].find(
            (candidate) =>
              candidate &&
              inputDevices.some((inputDevice) => inputDevice.deviceId === candidate)
          ) ?? null;

        setSelectedDeviceId(nextDeviceId);
        startMeter(stream);
        setStatus("ready");
        return true;
      } catch {
        if (previewRequestIdRef.current !== requestId) {
          return false;
        }
        releaseResources();
        setInputLevel(0);
        setErrorMessage(PREVIEW_ERROR_MESSAGE);
        setStatus("error");
        return false;
      }
    },
    [readInputDevices, releaseResources, startMeter]
  );

  const selectDevice = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      await requestPreview(deviceId);
    },
    [requestPreview]
  );

  const release = useCallback(() => {
    previewRequestIdRef.current += 1;
    releaseResources();
    setDevices([]);
    setErrorMessage(null);
    setInputLevel(0);
    setSelectedDeviceId(null);
    setStatus("idle");
  }, [releaseResources]);

  useEffect(() => {
    const handleDeviceChange = () => {
      void readInputDevices();
    };

    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, [readInputDevices]);

  useEffect(() => release, [release]);

  return {
    devices,
    errorMessage,
    inputLevel,
    release,
    requestPreview,
    selectDevice,
    selectedDeviceId,
    status
  };
}
