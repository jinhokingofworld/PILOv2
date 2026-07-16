export const workspacePresenceClientEvents = {
  join: "workspace-presence:join",
  leave: "workspace-presence:leave",
  update: "workspace-presence:update",
} as const;

export const workspacePresenceServerEvents = {
  error: "workspace-presence:error",
  joined: "workspace-presence:joined",
  leave: "workspace-presence:leave",
  update: "workspace-presence:update",
} as const;
