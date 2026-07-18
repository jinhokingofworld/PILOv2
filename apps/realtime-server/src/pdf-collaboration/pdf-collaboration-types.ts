export type PdfCollaborationRoomRef = {
  fileId: string;
  workspaceId: string;
};

export type PdfCollaborationPoint = {
  xRatio: number;
  yRatio: number;
};

export type PdfCollaborationTool = "highlighter" | "pen";

export type PdfCollaborationStroke = {
  color: string;
  id: string;
  pageNumber: number;
  points: PdfCollaborationPoint[];
  tool: PdfCollaborationTool;
  width: number;
};

export type PdfCollaborationPresence = PdfCollaborationRoomRef & {
  displayName: string;
  pageNumber: number;
  updatedAt: string;
  userId: string;
};

export type PdfCollaborationPointer = PdfCollaborationPresence &
  PdfCollaborationPoint;

export type PdfCollaborationSnapshot = PdfCollaborationRoomRef & {
  presence: PdfCollaborationPresence[];
  pointers: PdfCollaborationPointer[];
  strokesByPage: Record<number, PdfCollaborationStroke[]>;
};

export type PdfCollaborationPageUpdate = PdfCollaborationRoomRef & {
  pageNumber: number;
};

export type PdfCollaborationPointerUpdate = PdfCollaborationPageUpdate &
  PdfCollaborationPoint;

export type PdfCollaborationStrokeCommit = PdfCollaborationRoomRef & {
  color: string;
  id: string;
  pageNumber: number;
  points: PdfCollaborationPoint[];
  tool: PdfCollaborationTool;
  width: number;
};

export type PdfCollaborationStrokeRemove = PdfCollaborationRoomRef & {
  pageNumber: number;
  strokeId: string;
};
