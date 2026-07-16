export const githubSourceClientEvents = {
  subscribe: "github:source:subscribe",
  unsubscribe: "github:source:unsubscribe"
} as const;

export const githubSourceServerEvents = {
  error: "github:source:error",
  invalidated: "github:source:invalidated",
  subscribed: "github:source:subscribed"
} as const;
