export const sqlErdClientEvents = {
  join: "sql-erd:join",
  leave: "sql-erd:leave",
  presenceUpdate: "sql-erd:presence:update",
} as const;

export const sqlErdServerEvents = {
  error: "sql-erd:error",
  joined: "sql-erd:joined",
  presenceLeave: "sql-erd:presence:leave",
  presenceUpdate: "sql-erd:presence:update",
} as const;
