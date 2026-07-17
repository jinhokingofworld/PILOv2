import { isWorkspaceMembershipRevokedEvent } from "../workspace-membership-revocation/workspace-membership-revocation";

type DocumentConnectionContext = {
  userId?: unknown;
  workspaceId?: unknown;
};

type DocumentConnection = {
  close: (event: { code: number; reason: string }) => void;
  context: DocumentConnectionContext;
};

type DocumentConnectionStore = {
  getConnections: () => readonly DocumentConnection[];
};

export type DocumentMembershipRevocationHocuspocus = {
  documents: ReadonlyMap<string, DocumentConnectionStore>;
};

const ACCESS_REVOKED_CLOSE_EVENT = {
  code: 4003,
  reason: "Workspace access revoked",
};

export function createDocumentMembershipRevocationHandler({
  hocuspocus,
}: {
  hocuspocus: DocumentMembershipRevocationHocuspocus;
}) {
  return {
    async handle(payload: unknown): Promise<boolean> {
      if (!isWorkspaceMembershipRevokedEvent(payload)) {
        return false;
      }

      try {
        for (const document of hocuspocus.documents.values()) {
          for (const connection of document.getConnections()) {
            if (
              connection.context.workspaceId !== payload.workspaceId ||
              connection.context.userId !== payload.userId
            ) {
              continue;
            }

            connection.close(ACCESS_REVOKED_CLOSE_EVENT);
          }
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}
