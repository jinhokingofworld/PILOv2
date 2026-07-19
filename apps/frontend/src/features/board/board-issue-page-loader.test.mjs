import assert from "node:assert/strict";
import test from "node:test";

import { loadAllBoardIssuePages } from "./utils/board-issue-page-loader.ts";

function issue(id) {
  return { id: String(id) };
}

function page(data, total = data.length) {
  return {
    data,
    meta: { page: 1, limit: 100, total }
  };
}

test("publishes the first page before loading the remaining pages with at most three requests", async () => {
  const requestedPages = [];
  let firstPublishedCount = 0;
  let activeRequests = 0;
  let maxObservedConcurrency = 0;
  const items = Array.from({ length: 250 }, (_, index) => issue(index + 1));

  const result = await loadAllBoardIssuePages({
    fetchPage: async (requestedPage, limit) => {
      assert.equal(limit, 100);
      requestedPages.push(requestedPage);
      activeRequests += 1;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, activeRequests);
      if (requestedPage > 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      activeRequests -= 1;
      return page(items.slice((requestedPage - 1) * limit, requestedPage * limit), 250);
    },
    onFirstPage: (firstPage) => {
      firstPublishedCount = firstPage.data.length;
      assert.deepEqual(requestedPages, [1]);
    }
  });

  assert.deepEqual(requestedPages.sort(), [1, 2, 3]);
  assert.equal(firstPublishedCount, 100);
  assert.equal(result.items.length, 250);
  assert.equal(maxObservedConcurrency <= 3, true);
});

test("merges pages in page order and removes duplicate issue ids", async () => {
  const result = await loadAllBoardIssuePages({
    fetchPage: async (requestedPage) => {
      if (requestedPage === 1) return page([issue(1), issue(2)], 250);
      if (requestedPage === 2) return page([issue(3), issue(2)], 250);
      return page([issue(5)], 250);
    }
  });

  assert.deepEqual(result.items.map((item) => item.id), ["1", "2", "3", "5"]);
  assert.deepEqual(result.failedPages, []);
});

test("keeps successful pages and reports failed follow-up pages", async () => {
  const result = await loadAllBoardIssuePages({
    fetchPage: async (requestedPage) => {
      if (requestedPage === 1) return page([issue(1)], 250);
      if (requestedPage === 2) throw new Error("page two failed");
      return page([issue(requestedPage)], 250);
    }
  });

  assert.deepEqual(result.items.map((item) => item.id), ["1", "3"]);
  assert.deepEqual(result.failedPages, [2]);
});
