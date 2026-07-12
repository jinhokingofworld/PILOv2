# Board Realtime

Board realtime delivers cache invalidations only. The Board API remains the
source of truth, so clients reload the Board snapshot after an invalidation.

## Events

- Client: `board:join`, `board:leave`
- Server: `board:joined`, `board:invalidated`, `board:error`

`board:join` validates the bearer-session user against both the Board's
workspace and `workspace_members` before the socket joins
`workspace:{workspaceId}:board:{boardId}`.

App Server publishes the minimal invalidation payload to Redis. Realtime Server
validates it and emits only `{ workspaceId, boardId, updatedAt }` to that Board
room.
