"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useMeetingAudioPreflight } from "@/features/meeting/hooks/use-meeting-audio-preflight";

type MeetingAudioPreflightDialogProps = {
  onClose: () => void;
  onConfirm: (audioDeviceId: string | null) => void;
};

function getDeviceLabel(device: MediaDeviceInfo, index: number) {
  return device.label || `마이크 ${index + 1}`;
}

export function MeetingAudioPreflightDialog({
  onClose,
  onConfirm
}: MeetingAudioPreflightDialogProps) {
  const {
    devices,
    errorMessage,
    inputLevel,
    release,
    requestPreview,
    selectDevice,
    selectedDeviceId,
    status
  } = useMeetingAudioPreflight();

  useEffect(() => {
    void requestPreview();
  }, [requestPreview]);

  const close = () => {
    release();
    onClose();
  };

  const confirm = () => {
    const audioDeviceId = selectedDeviceId;
    release();
    onConfirm(audioDeviceId);
  };

  const levelPercent = Math.round(inputLevel * 100);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
        <div className="space-y-2">
          <h2 className="text-base font-semibold">마이크 확인</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            회의에 참여하기 전에 사용할 마이크와 입력 신호를 확인해주세요.
          </p>
        </div>

        <div className="mt-6 grid gap-5">
          <label className="grid gap-2 text-sm font-medium" htmlFor="meeting-audio-device">
            입력 장치
            <select
              id="meeting-audio-device"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              disabled={status !== "ready" || devices.length === 0}
              value={selectedDeviceId ?? ""}
              onChange={(event) => void selectDevice(event.target.value)}
            >
              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {getDeviceLabel(device, index)}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">입력 감도</span>
              <span className="text-muted-foreground">{levelPercent}%</span>
            </div>
            <div
              aria-label="마이크 입력 감도"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={levelPercent}
              className="h-3 overflow-hidden rounded-full bg-muted"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-100"
                style={{ width: `${levelPercent}%` }}
              />
            </div>
          </div>

          {errorMessage ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <p>{errorMessage}</p>
              <Button
                className="mt-3"
                size="sm"
                type="button"
                variant="outline"
                onClick={() => void requestPreview()}
              >
                다시 시도
              </Button>
            </div>
          ) : null}
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" onClick={close}>
            취소
          </Button>
          <Button
            disabled={status !== "ready" || !selectedDeviceId}
            type="button"
            onClick={confirm}
          >
            이 장치로 참여
          </Button>
        </div>
      </div>
    </div>
  );
}
