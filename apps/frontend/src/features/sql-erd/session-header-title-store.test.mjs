import assert from "node:assert/strict";
import test from "node:test";

import {
  clearSqlErdSessionHeaderTitle,
  getSqlErdSessionHeaderTitleSnapshot,
  resolveSqlErdSessionHeaderTitle,
  setSqlErdSessionHeaderTitle,
  subscribeSqlErdSessionHeaderTitle
} from "./session-header-title-store.ts";

test("SQLtoERD session header title publishes and clears only the matching session", () => {
  const snapshots = [];
  const unsubscribe = subscribeSqlErdSessionHeaderTitle(() => {
    snapshots.push(getSqlErdSessionHeaderTitleSnapshot());
  });

  assert.equal(getSqlErdSessionHeaderTitleSnapshot(), null);

  setSqlErdSessionHeaderTitle("session-a", "Commerce ERD");
  assert.deepEqual(getSqlErdSessionHeaderTitleSnapshot(), {
    sessionId: "session-a",
    title: "Commerce ERD"
  });

  clearSqlErdSessionHeaderTitle("session-b");
  assert.deepEqual(getSqlErdSessionHeaderTitleSnapshot(), {
    sessionId: "session-a",
    title: "Commerce ERD"
  });

  setSqlErdSessionHeaderTitle("session-a", "Orders ERD");
  clearSqlErdSessionHeaderTitle("session-a");
  unsubscribe();

  assert.equal(getSqlErdSessionHeaderTitleSnapshot(), null);
  assert.deepEqual(snapshots, [
    { sessionId: "session-a", title: "Commerce ERD" },
    { sessionId: "session-a", title: "Orders ERD" },
    null
  ]);
});

test("SQLtoERD session header title ignores a stale session snapshot", () => {
  assert.equal(
    resolveSqlErdSessionHeaderTitle(
      { sessionId: "session-a", title: "Orders ERD" },
      "session-b",
      "SQLtoERD"
    ),
    "SQLtoERD"
  );
  assert.equal(
    resolveSqlErdSessionHeaderTitle(
      { sessionId: "session-b", title: "Customers ERD" },
      "session-b",
      "SQLtoERD"
    ),
    "Customers ERD"
  );
});
