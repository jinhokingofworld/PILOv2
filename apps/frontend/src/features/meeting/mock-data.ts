import type {
  MeetingReportDetail,
  MeetingReportListPayload,
  MeetingReportListQuery,
  MeetingReportSummary
} from "@/features/meeting/types";

export const LOCAL_MEETING_MOCK_REPORT_ID = "local-meeting-report-mock";

export const localMeetingMockActionItemDeliveryOptions = {
  boards: [
    {
      id: "local-board-pilo-project",
      name: "PILO_Project",
      columns: [
        { id: "local-column-todo", name: "To do" },
        { id: "local-column-review", name: "검토 중" }
      ]
    }
  ]
};

export const localMeetingMockReportSummary: MeetingReportSummary = {
  id: LOCAL_MEETING_MOCK_REPORT_ID,
  meetingId: "local-meeting-mock",
  recordingId: "local-recording-mock",
  status: "COMPLETED",
  failedStep: null,
  errorMessage: null,
  title: "데일리 스크럼: 회의록 생성 워커 분리 및 배포 검토",
  summary:
    "백엔드 담당자가 회의록 생성 작업을 워커로 분리하는 구현을 완료했고 PR을 올렸다고 공유했다. 현재는 배포 순서와 롤백 가능 여부만 추가로 확인하면 되는 상태로 정리됐다.",
  discussionPoints:
    "앱 서버가 회의록 생성 작업을 등록하고 워커가 작업을 받아 결과를 저장하는 흐름을 확인했다.\n배포 순서와 롤백 방식을 별도로 점검해야 한다는 의견이 나왔다.",
  decisions:
    "회의록 생성 작업은 앱 서버와 분리된 워커에서 처리하고, 배포 전 롤백 시나리오를 확인한다.\n배포 확인이 끝나면 현재 PR을 승인하고 워커부터 순차 배포한다.",
  contentVersion: 1,
  contentEditedByUserId: null,
  contentEditedAt: null,
  actionItemCandidates: [],
  actionItemExtraction: {
    status: "COMPLETED",
    errorMessage: null
  },
  retryCount: 0,
  participantSummary: {
    totalCount: 4,
    participants: [
      { userId: "local-user-1", name: "작은채널", avatarUrl: null },
      { userId: "local-user-2", name: "김주형 (라건)", avatarUrl: null },
      { userId: "local-user-3", name: "김진호", avatarUrl: null }
    ],
    hasMore: true
  },
  canDelete: false,
  canEdit: false,
  createdAt: "2026-07-20T10:47:00.000Z",
  updatedAt: "2026-07-20T10:48:00.000Z"
};

export const localMeetingMockReportDetail: MeetingReportDetail = {
  ...localMeetingMockReportSummary,
  transcriptText:
    "00:15 오늘은 회의록 생성 워커 분리 작업과 배포 순서를 확인하겠습니다.\n00:20 앱 서버가 작업을 등록하고 워커가 처리 결과를 저장하는 흐름까지 구현했습니다.\n00:52 앱 서버에서 직접 생성하지 말고 워커가 받아서 처리하는 걸로 가죠. 배포 전에 기존 경로로 되돌릴 수 있는지만 확인하면 될 것 같습니다.\n01:19 워커를 먼저 올리고 처리 상태가 정상인지 본 다음 앱 서버를 배포하는 순서로 진행하겠습니다.\n01:36 배포 순서와 롤백 방법을 검토하는 이슈를 만들고 확인 결과를 공유하겠습니다.\n02:05 기존 Supabase 설정이 남아 있는지 최종 확인하겠습니다.",
  evidenceSegments: [
    {
      id: "local-segment-summary",
      segmentIndex: 0,
      startedAtMs: 15_000,
      endedAtMs: 18_000,
      text: "오늘은 회의록 생성 워커 분리 작업과 배포 순서를 확인하겠습니다."
    },
    {
      id: "local-segment-discussion",
      segmentIndex: 1,
      startedAtMs: 20_000,
      endedAtMs: 32_000,
      text: "앱 서버가 작업을 등록하고 워커가 처리 결과를 저장하는 흐름까지 구현했습니다."
    },
    {
      id: "local-segment-decision-1",
      segmentIndex: 2,
      startedAtMs: 52_000,
      endedAtMs: 66_000,
      text: "앱 서버에서 직접 생성하지 말고 워커가 받아서 처리하는 걸로 가죠. 배포 전에 기존 경로로 되돌릴 수 있는지만 확인하면 될 것 같습니다."
    },
    {
      id: "local-segment-decision-2",
      segmentIndex: 3,
      startedAtMs: 79_000,
      endedAtMs: 91_000,
      text: "워커를 먼저 올리고 처리 상태가 정상인지 본 다음 앱 서버를 배포하는 순서로 진행하겠습니다."
    },
    {
      id: "local-segment-action-item-1",
      segmentIndex: 4,
      startedAtMs: 96_000,
      endedAtMs: 108_000,
      text: "배포 순서와 롤백 방법을 검토하는 이슈를 만들고 확인 결과를 공유하겠습니다."
    },
    {
      id: "local-segment-action-item-2",
      segmentIndex: 5,
      startedAtMs: 125_000,
      endedAtMs: 132_000,
      text: "기존 Supabase 설정이 남아 있는지 최종 확인하겠습니다."
    }
  ],
  evidence: [
    {
      sourceType: "summary",
      sourceIndex: 0,
      transcriptSegmentId: "local-segment-summary"
    },
    {
      sourceType: "discussion",
      sourceIndex: 0,
      transcriptSegmentId: "local-segment-discussion"
    },
    {
      sourceType: "decision",
      sourceIndex: 0,
      transcriptSegmentId: "local-segment-decision-1"
    },
    {
      sourceType: "decision",
      sourceIndex: 1,
      transcriptSegmentId: "local-segment-decision-2"
    },
    {
      sourceType: "action_item",
      sourceIndex: 0,
      transcriptSegmentId: "local-segment-action-item-1"
    },
    {
      sourceType: "action_item",
      sourceIndex: 1,
      transcriptSegmentId: "local-segment-action-item-2"
    }
  ],
  activityEvidence: [
    {
      id: "local-activity-pr",
      sourceIndex: 0,
      occurredAt: "2026-07-20T10:31:00.000Z",
      action: "GitHub · Pull request 열림",
      summary: "meeting-worker 분리 및 배포 검토 PR #214가 생성되었습니다.",
      references: [{ sourceType: "decision", sourceIndex: 0 }]
    },
    {
      id: "local-activity-board",
      sourceIndex: 1,
      occurredAt: "2026-07-20T10:36:00.000Z",
      action: "PILO Board · 이슈 이동",
      summary: "‘회의록 워커 배포 순서 확인’ 이슈가 검토 중으로 이동했습니다.",
      references: [{ sourceType: "decision", sourceIndex: 0 }]
    },
    {
      id: "local-activity-action-item-1",
      sourceIndex: 2,
      occurredAt: "2026-07-20T10:39:00.000Z",
      action: "PILO Board · 이슈 생성",
      summary: "배포 순서와 롤백 방식 검토 이슈가 생성되었습니다.",
      references: [{ sourceType: "action_item", sourceIndex: 0 }]
    },
    {
      id: "local-activity-action-item-2",
      sourceIndex: 3,
      occurredAt: "2026-07-20T10:42:00.000Z",
      action: "GitHub · 체크리스트 등록",
      summary: "Supabase 기존 설정 최종 확인 항목이 배포 체크리스트에 추가되었습니다.",
      references: [{ sourceType: "action_item", sourceIndex: 1 }]
    }
  ],
  actionItems: [
    {
      id: "local-action-item-1",
      sourceIndex: 0,
      title: "배포 순서와 롤백 방식 검토",
      description:
        "워커와 앱 서버의 배포 순서를 확인하고, 장애 발생 시 기존 경로로 되돌리는 절차를 정리한다.",
      priority: "HIGH",
      assignee: { userId: "local-user-2", name: "김주형 (라건)", avatarUrl: null },
      deliverySuggestion: { deliveryType: "pilo_issue", calendar: null },
      status: "PENDING",
      updatedByUserId: null,
      approvedByUserId: null,
      approvedAt: null,
      dismissedByUserId: null,
      dismissedAt: null,
      delivery: null,
      createdAt: "2026-07-20T10:38:00.000Z",
      updatedAt: "2026-07-20T10:38:00.000Z"
    },
    {
      id: "local-action-item-2",
      sourceIndex: 1,
      title: "Supabase 기존 설정 잔존 여부 최종 확인",
      description:
        "RDS 전환 이후 남아 있는 Supabase 설정과 연결 정보를 확인하고, 정리 결과를 배포 체크리스트에 기록한다.",
      priority: "MEDIUM",
      assignee: null,
      deliverySuggestion: {
        deliveryType: "calendar_event",
        calendar: {
          isAllDay: false,
          startDate: "2026-07-21",
          endDate: "2026-07-21",
          startTime: "10:00",
          endTime: "10:30"
        }
      },
      status: "PENDING",
      updatedByUserId: null,
      approvedByUserId: null,
      approvedAt: null,
      dismissedByUserId: null,
      dismissedAt: null,
      delivery: null,
      createdAt: "2026-07-20T10:41:00.000Z",
      updatedAt: "2026-07-20T10:41:00.000Z"
    }
  ],
  actionItemAssignees: [
    { userId: "local-user-2", name: "김주형 (라건)", avatarUrl: null },
    { userId: "local-user-3", name: "김진호", avatarUrl: null }
  ],
  decisionItems: [
    {
      id: "local-decision-1",
      sourceIndex: 0,
      text: "회의록 생성 작업은 앱 서버와 분리된 워커에서 처리하고, 배포 전 롤백 시나리오를 확인한다.",
      isUserEdited: false,
      editedByUserId: null,
      editedAt: null
    },
    {
      id: "local-decision-2",
      sourceIndex: 1,
      text: "배포 확인이 끝나면 현재 PR을 승인하고 워커부터 순차 배포한다.",
      isUserEdited: false,
      editedByUserId: null,
      editedAt: null
    }
  ]
};

export function getLocalMeetingMockReportList(
  query: MeetingReportListQuery
): MeetingReportListPayload | null {
  if (query.cursor) return null;
  if (query.status && query.status !== localMeetingMockReportSummary.status) {
    return null;
  }

  const normalizedQuery = query.q?.trim().toLocaleLowerCase("ko-KR");
  if (normalizedQuery) {
    const searchText = [
      localMeetingMockReportSummary.title,
      localMeetingMockReportSummary.summary,
      localMeetingMockReportSummary.discussionPoints,
      localMeetingMockReportSummary.decisions
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("ko-KR");
    if (!searchText.includes(normalizedQuery)) return null;
  }

  const createdAt = Date.parse(localMeetingMockReportSummary.createdAt);
  if (query.from && createdAt < Date.parse(query.from)) return null;
  if (query.to && createdAt >= Date.parse(query.to)) return null;

  return {
    nextCursor: null,
    reports: [localMeetingMockReportSummary]
  };
}

export function isLocalMeetingMockReport(reportId: string) {
  return reportId === LOCAL_MEETING_MOCK_REPORT_ID;
}
