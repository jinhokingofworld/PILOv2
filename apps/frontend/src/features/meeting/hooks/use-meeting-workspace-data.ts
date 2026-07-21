"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createMeetingApiClient } from "@/features/meeting/api/client";
import {
  localMeetingMockActionItemDeliveryOptions,
  getLocalMeetingMockReportList,
  isLocalMeetingMockReport,
  localMeetingMockReportDetail
} from "@/features/meeting/mock-data";
import type {
  JoinMeetingInput,
  CurrentMeetingPayload,
  Meeting,
  MeetingRecording,
  MeetingReportActionItem,
  MeetingReportActionItemDelivery,
  MeetingReportActionItemDeliveryInput,
  MeetingReportActionItemDeliveryResult,
  UpdateMeetingReportActionItemInput,
  UpdateMeetingReportContentInput,
  MeetingReportListQuery,
  MeetingReportSummary,
  StartMeetingInput
} from "@/features/meeting/types";

export type MeetingWorkspaceDataStatus =
  | "idle"
  | "loading"
  | "success"
  | "error";

type MeetingWorkspaceCurrentState = CurrentMeetingPayload;

type MeetingWorkspaceReportsState = {
  nextCursor: string | null;
  reports: MeetingReportSummary[];
};

type UseMeetingWorkspaceDataOptions = {
  accessToken?: string | null;
  enabled?: boolean;
  reportsEnabled?: boolean;
  reportsQuery?: MeetingReportListQuery;
  meetingRoomId?: string | null;
  workspaceId: string;
};

const emptyCurrentState: MeetingWorkspaceCurrentState = {
  activeParticipantCount: 0,
  currentRecording: null,
  meeting: null
};

const emptyReportsState: MeetingWorkspaceReportsState = {
  nextCursor: null,
  reports: []
};
const canUseLocalMeetingMockData =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_ENABLE_MEETING_MOCK === "true";

function errorFromUnknown(error: unknown) {
  return error instanceof Error
    ? error
    : new Error("Meeting data could not be loaded");
}

export function useMeetingWorkspaceData({
  accessToken = null,
  enabled = true,
  meetingRoomId,
  reportsEnabled = true,
  reportsQuery = {},
  workspaceId
}: UseMeetingWorkspaceDataOptions) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedMeetingRoomId = meetingRoomId?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const usesRoomScopedApi = meetingRoomId !== undefined;
  const canLoad = Boolean(
    enabled &&
      normalizedWorkspaceId &&
      normalizedAccessToken &&
      (!usesRoomScopedApi || normalizedMeetingRoomId)
  );
  const canLoadLocalMockReports = Boolean(
    canUseLocalMeetingMockData &&
      enabled &&
      normalizedWorkspaceId &&
      normalizedAccessToken
  );
  const canLoadReports = canLoad || canLoadLocalMockReports;
  const reportsQueryKey = JSON.stringify(reportsQuery);
  const meetingClient = useMemo(
    () => createMeetingApiClient({ accessToken: normalizedAccessToken }),
    [normalizedAccessToken]
  );
  const [currentState, setCurrentState] =
    useState<MeetingWorkspaceCurrentState>(emptyCurrentState);
  const [reportsState, setReportsState] =
    useState<MeetingWorkspaceReportsState>(emptyReportsState);
  const [currentStatus, setCurrentStatus] =
    useState<MeetingWorkspaceDataStatus>("idle");
  const [reportsStatus, setReportsStatus] =
    useState<MeetingWorkspaceDataStatus>("idle");
  const [currentError, setCurrentError] = useState<Error | null>(null);
  const [reportsError, setReportsError] = useState<Error | null>(null);
  const localMeetingMockReportRef = useRef(localMeetingMockReportDetail);

  const mutateLocalMockActionItem = useCallback(
    (
      actionItemId: string,
      mutation: (actionItem: MeetingReportActionItem) => MeetingReportActionItem
    ) => {
      const report = localMeetingMockReportRef.current;
      const actionItems = report.actionItems ?? [];
      const currentActionItem = actionItems.find((item) => item.id === actionItemId);
      if (!currentActionItem) {
        throw new Error("Mock meeting report action item could not be found");
      }

      const actionItem = mutation(currentActionItem);
      localMeetingMockReportRef.current = {
        ...report,
        actionItems: actionItems.map((item) =>
          item.id === actionItemId ? actionItem : item
        )
      };
      return actionItem;
    },
    []
  );

  const requireWorkspace = useCallback(() => {
    if (!canLoad) {
      throw new Error("Meeting action requires an authenticated workspace");
    }

    return normalizedWorkspaceId;
  }, [canLoad, normalizedWorkspaceId]);

  const loadCurrentMeeting = useCallback(async () => {
    if (!canLoad) {
      return emptyCurrentState;
    }

    return usesRoomScopedApi && normalizedMeetingRoomId
      ? meetingClient.getCurrentMeetingInRoom(
          normalizedWorkspaceId,
          normalizedMeetingRoomId
        )
      : meetingClient.getCurrentMeeting(normalizedWorkspaceId);
  }, [
    canLoad,
    meetingClient,
    normalizedMeetingRoomId,
    normalizedWorkspaceId,
    usesRoomScopedApi
  ]);

  const loadReports = useCallback(async () => {
    if (!canLoadReports || !reportsEnabled) {
      return emptyReportsState;
    }

    const query = JSON.parse(reportsQueryKey) as MeetingReportListQuery;
    if (!canLoad) {
      return getLocalMeetingMockReportList(query) ?? emptyReportsState;
    }

    const result = await meetingClient.listMeetingReports(
      normalizedWorkspaceId,
      query
    );
    if (!canUseLocalMeetingMockData || result.reports.length) return result;

    return getLocalMeetingMockReportList(query) ?? result;
  }, [
    canLoad,
    canLoadReports,
    meetingClient,
    normalizedWorkspaceId,
    reportsEnabled,
    reportsQueryKey
  ]);

  const reloadCurrentMeeting = useCallback(async () => {
    if (!canLoad) {
      setCurrentState(emptyCurrentState);
      setCurrentStatus("idle");
      setCurrentError(null);
      return emptyCurrentState;
    }

    setCurrentStatus("loading");
    setCurrentError(null);

    try {
      const nextCurrentState = await loadCurrentMeeting();
      setCurrentState(nextCurrentState);
      setCurrentStatus("success");
      return nextCurrentState;
    } catch (error) {
      const nextError = errorFromUnknown(error);
      setCurrentState(emptyCurrentState);
      setCurrentError(nextError);
      setCurrentStatus("error");
      return emptyCurrentState;
    }
  }, [canLoad, loadCurrentMeeting]);

  const reloadReports = useCallback(async () => {
    if (!canLoadReports || !reportsEnabled) {
      setReportsState(emptyReportsState);
      setReportsStatus("idle");
      setReportsError(null);
      return emptyReportsState;
    }

    setReportsStatus("loading");
    setReportsError(null);

    try {
      const nextReportsState = await loadReports();
      setReportsState(nextReportsState);
      setReportsStatus("success");
      return nextReportsState;
    } catch (error) {
      const nextError = errorFromUnknown(error);
      setReportsState(emptyReportsState);
      setReportsError(nextError);
      setReportsStatus("error");
      return emptyReportsState;
    }
  }, [canLoadReports, loadReports, reportsEnabled]);

  const startMeeting = useCallback(
    async (input: StartMeetingInput = {}) => {
      const targetWorkspaceId = requireWorkspace();
      const result =
        usesRoomScopedApi && normalizedMeetingRoomId
          ? await meetingClient.startMeetingInRoom(
              targetWorkspaceId,
              normalizedMeetingRoomId,
              input
            )
          : await meetingClient.startMeeting(targetWorkspaceId, input);
      setCurrentState({
        activeParticipantCount: 1,
        currentRecording: result.currentRecording,
        meeting: result.meeting
      });
      setCurrentStatus("success");
      setCurrentError(null);
      return result;
    },
    [
      meetingClient,
      normalizedMeetingRoomId,
      requireWorkspace,
      usesRoomScopedApi
    ]
  );

  const joinMeeting = useCallback(
    async (meetingId: string, input: JoinMeetingInput = {}) => {
      const targetWorkspaceId = requireWorkspace();
      const result = await meetingClient.joinMeeting(
        targetWorkspaceId,
        meetingId,
        input
      );
      await reloadCurrentMeeting();
      return result;
    },
    [meetingClient, reloadCurrentMeeting, requireWorkspace]
  );

  const leaveMeeting = useCallback(
    async (meetingId: string) => {
      const targetWorkspaceId = requireWorkspace();
      const result = await meetingClient.leaveMeeting(targetWorkspaceId, meetingId);
      await reloadCurrentMeeting();
      return result;
    },
    [meetingClient, reloadCurrentMeeting, requireWorkspace]
  );

  const startRecording = useCallback(
    async (meetingId: string) => {
      const targetWorkspaceId = requireWorkspace();
      const result = await meetingClient.startRecording(
        targetWorkspaceId,
        meetingId
      );
      await reloadCurrentMeeting();
      return result;
    },
    [meetingClient, reloadCurrentMeeting, requireWorkspace]
  );

  const endRecording = useCallback(
    async (meetingId: string, recordingId: string) => {
      const targetWorkspaceId = requireWorkspace();
      const result = await meetingClient.endRecording(
        targetWorkspaceId,
        meetingId,
        recordingId
      );
      await Promise.all([reloadCurrentMeeting(), reloadReports()]);
      return result;
    },
    [meetingClient, reloadCurrentMeeting, reloadReports, requireWorkspace]
  );

  const getMeeting = useCallback(
    async (meetingId: string) => {
      return meetingClient.getMeeting(requireWorkspace(), meetingId);
    },
    [meetingClient, requireWorkspace]
  );

  const listRecordings = useCallback(
    async (meetingId: string) => {
      return meetingClient.listRecordings(requireWorkspace(), meetingId);
    },
    [meetingClient, requireWorkspace]
  );

  const getCurrentRecording = useCallback(
    async (meetingId: string) => {
      return meetingClient.getCurrentRecording(requireWorkspace(), meetingId);
    },
    [meetingClient, requireWorkspace]
  );

  const listParticipants = useCallback(
    async (meetingId: string) => {
      return meetingClient.listParticipants(requireWorkspace(), meetingId);
    },
    [meetingClient, requireWorkspace]
  );

  const getMeetingReport = useCallback(
    async (reportId: string) => {
      if (canUseLocalMeetingMockData && isLocalMeetingMockReport(reportId)) {
        return { report: localMeetingMockReportRef.current };
      }

      return meetingClient.getMeetingReport(requireWorkspace(), reportId);
    },
    [meetingClient, requireWorkspace]
  );

  const deleteMeetingReport = useCallback(
    async (reportId: string) => {
      const result = await meetingClient.deleteMeetingReport(
        requireWorkspace(),
        reportId
      );
      await reloadReports();
      return result;
    },
    [meetingClient, reloadReports, requireWorkspace]
  );

  const updateMeetingReportContent = useCallback(
    async (reportId: string, body: UpdateMeetingReportContentInput) => {
      const result = await meetingClient.updateMeetingReportContent(
        requireWorkspace(),
        reportId,
        body
      );
      await reloadReports();
      return result;
    },
    [meetingClient, reloadReports, requireWorkspace]
  );

  const listMeetingReportsByMeeting = useCallback(
    async (meetingId: string) => {
      return meetingClient.listMeetingReportsByMeeting(
        requireWorkspace(),
        meetingId
      );
    },
    [meetingClient, requireWorkspace]
  );

  const regenerateMeetingReport = useCallback(
    async (reportId: string) => {
      const result = await meetingClient.regenerateMeetingReport(
        requireWorkspace(),
        reportId
      );
      await reloadReports();
      return result;
    },
    [meetingClient, reloadReports, requireWorkspace]
  );

  const retryMeetingReportActionItemExtraction = useCallback(
    async (reportId: string) => {
      const result = await meetingClient.retryMeetingReportActionItemExtraction(
        requireWorkspace(),
        reportId
      );
      await reloadReports();
      return result;
    },
    [meetingClient, reloadReports, requireWorkspace]
  );

  const updateMeetingReportActionItem = useCallback(
    async (
      reportId: string,
      actionItemId: string,
      body: UpdateMeetingReportActionItemInput
    ) => {
      if (canUseLocalMeetingMockData && isLocalMeetingMockReport(reportId)) {
        const report = localMeetingMockReportRef.current;
        const assignee =
          body.assigneeUserId === undefined
            ? undefined
            : (report.actionItemAssignees ?? []).find(
                (candidate) => candidate.userId === body.assigneeUserId
              ) ?? null;
        const updatedAt = new Date().toISOString();
        return {
          actionItem: mutateLocalMockActionItem(actionItemId, (actionItem) => ({
            ...actionItem,
            ...(body.title === undefined ? {} : { title: body.title }),
            ...(body.description === undefined
              ? {}
              : { description: body.description }),
            ...(body.priority === undefined ? {} : { priority: body.priority }),
            ...(assignee === undefined ? {} : { assignee }),
            updatedByUserId: "local-user-3",
            updatedAt
          }))
        };
      }

      return meetingClient.updateMeetingReportActionItem(
        requireWorkspace(),
        reportId,
        actionItemId,
        body
      );
    },
    [meetingClient, mutateLocalMockActionItem, requireWorkspace]
  );

  const approveMeetingReportActionItem = useCallback(
    async (reportId: string, actionItemId: string) => {
      if (canUseLocalMeetingMockData && isLocalMeetingMockReport(reportId)) {
        const approvedAt = new Date().toISOString();
        return {
          actionItem: mutateLocalMockActionItem(actionItemId, (actionItem) => ({
            ...actionItem,
            status: "APPROVED",
            approvedByUserId: "local-user-3",
            approvedAt,
            dismissedByUserId: null,
            dismissedAt: null,
            updatedAt: approvedAt
          }))
        };
      }

      return meetingClient.approveMeetingReportActionItem(
        requireWorkspace(),
        reportId,
        actionItemId
      );
    },
    [meetingClient, mutateLocalMockActionItem, requireWorkspace]
  );

  const getMeetingReportActionItemDeliveryOptions = useCallback(
    async (reportId: string, actionItemId: string) => {
      if (canUseLocalMeetingMockData && isLocalMeetingMockReport(reportId)) {
        return localMeetingMockActionItemDeliveryOptions;
      }

      return meetingClient.getMeetingReportActionItemDeliveryOptions(
        requireWorkspace(),
        reportId,
        actionItemId
      );
    },
    [meetingClient, requireWorkspace]
  );

  const deliverMeetingReportActionItem = useCallback(
    async (
      reportId: string,
      actionItemId: string,
      body: MeetingReportActionItemDeliveryInput
    ) => {
      if (canUseLocalMeetingMockData && isLocalMeetingMockReport(reportId)) {
        const deliveredAt = new Date().toISOString();
        const currentActionItem = (
          localMeetingMockReportRef.current.actionItems ?? []
        ).find((item) => item.id === actionItemId);
        if (!currentActionItem) {
          throw new Error("Mock meeting report action item could not be found");
        }

        const targetResourceId = `local-${body.deliveryType}-${actionItemId}`;
        const delivery: MeetingReportActionItemDelivery = {
          deliveryType: body.deliveryType,
          status: "COMPLETED",
          errorCode: null,
          draft: body,
          targetResourceId,
          calendarEvent:
            body.deliveryType === "calendar_event"
              ? {
                  id: targetResourceId,
                  title: body.calendar.title?.trim() || currentActionItem.title
                }
              : null,
          piloIssue:
            body.deliveryType === "pilo_issue"
              ? {
                  id: targetResourceId,
                  title: body.issue.title?.trim() || currentActionItem.title,
                  boardId: body.issue.boardId,
                  columnId: body.issue.columnId,
                  columnName:
                    localMeetingMockActionItemDeliveryOptions.boards
                      .find((board) => board.id === body.issue.boardId)
                      ?.columns.find((column) => column.id === body.issue.columnId)
                      ?.name ?? null
                }
              : null
        };
        mutateLocalMockActionItem(actionItemId, (actionItem) => ({
          ...actionItem,
          status: "APPROVED",
          approvedByUserId: "local-user-3",
          approvedAt: deliveredAt,
          dismissedByUserId: null,
          dismissedAt: null,
          delivery,
          updatedAt: deliveredAt
        }));
        return {
          actionItemId,
          deliveryType: body.deliveryType,
          status: "COMPLETED",
          ...(body.deliveryType === "calendar_event"
            ? { calendarEventId: 1 }
            : { piloIssueId: targetResourceId })
        } satisfies MeetingReportActionItemDeliveryResult;
      }

      return meetingClient.deliverMeetingReportActionItem(
        requireWorkspace(),
        reportId,
        actionItemId,
        body
      );
    },
    [meetingClient, mutateLocalMockActionItem, requireWorkspace]
  );

  const dismissMeetingReportActionItem = useCallback(
    async (reportId: string, actionItemId: string) => {
      if (canUseLocalMeetingMockData && isLocalMeetingMockReport(reportId)) {
        const dismissedAt = new Date().toISOString();
        return {
          actionItem: mutateLocalMockActionItem(actionItemId, (actionItem) => ({
            ...actionItem,
            status: "DISMISSED",
            approvedByUserId: null,
            approvedAt: null,
            dismissedByUserId: "local-user-3",
            dismissedAt,
            updatedAt: dismissedAt
          }))
        };
      }

      return meetingClient.dismissMeetingReportActionItem(
        requireWorkspace(),
        reportId,
        actionItemId
      );
    },
    [meetingClient, mutateLocalMockActionItem, requireWorkspace]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      if (!canLoad) {
        setCurrentState(emptyCurrentState);
        setCurrentStatus("idle");
        setCurrentError(null);
        return;
      }

      setCurrentStatus("loading");
      setCurrentError(null);
      setCurrentState(emptyCurrentState);

      try {
        const nextCurrentState = await loadCurrentMeeting();
        if (!active) return;

        setCurrentState(nextCurrentState);
        setCurrentStatus("success");
      } catch (error) {
        if (!active) return;

        setCurrentState(emptyCurrentState);
        setCurrentError(errorFromUnknown(error));
        setCurrentStatus("error");
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [canLoad, loadCurrentMeeting]);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!canLoadReports || !reportsEnabled) {
        setReportsState(emptyReportsState);
        setReportsStatus("idle");
        setReportsError(null);
        return;
      }

      setReportsStatus("loading");
      setReportsError(null);

      try {
        const nextReportsState = await loadReports();
        if (!active) return;

        setReportsState(nextReportsState);
        setReportsStatus("success");
      } catch (error) {
        if (!active) return;

        setReportsState(emptyReportsState);
        setReportsError(errorFromUnknown(error));
        setReportsStatus("error");
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [canLoadReports, loadReports, reportsEnabled]);

  return {
    accessToken: normalizedAccessToken,
    activeParticipantCount: currentState.activeParticipantCount,
    approveMeetingReportActionItem,
    canLoad,
    currentError,
    currentRecording: currentState.currentRecording,
    currentStatus,
    deleteMeetingReport,
    deliverMeetingReportActionItem,
    dismissMeetingReportActionItem,
    endRecording,
    getCurrentRecording,
    getMeeting,
    getMeetingReport,
    getMeetingReportActionItemDeliveryOptions,
    joinMeeting,
    leaveMeeting,
    listMeetingReportsByMeeting,
    listParticipants,
    listRecordings,
    meeting: currentState.meeting,
    nextReportCursor: reportsState.nextCursor,
    regenerateMeetingReport,
    retryMeetingReportActionItemExtraction,
    reloadCurrentMeeting,
    reloadReports,
    reports: reportsState.reports,
    reportsError,
    reportsStatus,
    meetingRoomId: normalizedMeetingRoomId,
    startMeeting,
    startRecording,
    updateMeetingReportActionItem,
    updateMeetingReportContent,
    workspaceId: normalizedWorkspaceId
  };
}

export type MeetingWorkspaceData = ReturnType<typeof useMeetingWorkspaceData>;

export type MeetingWorkspaceCurrentSnapshot = {
  activeParticipantCount: number;
  currentRecording: MeetingRecording | null;
  meeting: Meeting | null;
};
