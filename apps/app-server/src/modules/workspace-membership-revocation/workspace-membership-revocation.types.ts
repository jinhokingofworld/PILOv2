export type WorkspaceMembershipRevokedEventV1 = {
  version: 1;
  type: "membership.revoked";
  workspaceId: string;
  userId: string;
  occurredAt: string;
};
