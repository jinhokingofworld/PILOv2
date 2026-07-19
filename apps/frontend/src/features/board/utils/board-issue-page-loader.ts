import type {
  BoardIssueCardPayload,
  BoardPaginatedPayload
} from "@/features/board/types";

export const BOARD_ISSUES_PAGE_LIMIT = 100;
const MAX_CONCURRENT_PAGE_REQUESTS = 3;

export type BoardIssuePageLoadResult<T extends { id: string }> = {
  items: T[];
  meta: BoardPaginatedPayload<T>["meta"];
  failedPages: number[];
};

type LoadAllBoardIssuePagesOptions<T extends { id: string }> = {
  fetchPage: (
    page: number,
    limit: number
  ) => Promise<BoardPaginatedPayload<T>>;
  onFirstPage?: (page: BoardPaginatedPayload<T>) => void;
  onProgress?: (result: BoardIssuePageLoadResult<T>) => void;
};

function mergePagesInOrder<T extends { id: string }>(
  pages: Map<number, T[]>,
  meta: BoardPaginatedPayload<T>["meta"]
) {
  const seenIds = new Set<string>();
  const items: T[] = [];

  for (let page = 1; page <= Math.ceil(meta.total / meta.limit); page += 1) {
    for (const item of pages.get(page) ?? []) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        items.push(item);
      }
    }
  }

  return items;
}

export async function loadAllBoardIssuePages<
  T extends { id: string } = BoardIssueCardPayload
>({
  fetchPage,
  onFirstPage,
  onProgress
}: LoadAllBoardIssuePagesOptions<T>): Promise<BoardIssuePageLoadResult<T>> {
  const firstPage = await fetchPage(1, BOARD_ISSUES_PAGE_LIMIT);
  const pages = new Map<number, T[]>([[1, firstPage.data]]);
  const failedPages: number[] = [];
  const totalPages = Math.ceil(firstPage.meta.total / firstPage.meta.limit);

  onFirstPage?.(firstPage);

  let nextPage = 2;
  const loadNextPage = async () => {
    while (nextPage <= totalPages) {
      const page = nextPage;
      nextPage += 1;

      try {
        const response = await fetchPage(page, BOARD_ISSUES_PAGE_LIMIT);
        pages.set(page, response.data);
      } catch {
        failedPages.push(page);
      }

      onProgress?.({
        items: mergePagesInOrder(pages, firstPage.meta),
        meta: firstPage.meta,
        failedPages: [...failedPages].sort((left, right) => left - right)
      });
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_PAGE_REQUESTS, Math.max(totalPages - 1, 0)) },
      () => loadNextPage()
    )
  );

  return {
    items: mergePagesInOrder(pages, firstPage.meta),
    meta: firstPage.meta,
    failedPages: failedPages.sort((left, right) => left - right)
  };
}
