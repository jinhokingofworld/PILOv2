type GithubPage<T> = {
  data: T[];
  meta: {
    total: number;
  };
};

export async function collectGithubPages<T>(
  loadPage: (page: number) => Promise<GithubPage<T>>
): Promise<T[]> {
  const firstPage = await loadPage(1);
  const items = [...firstPage.data];

  for (let page = 2; items.length < firstPage.meta.total; page += 1) {
    const nextPage = await loadPage(page);
    if (nextPage.data.length === 0) {
      throw new Error("GitHub pagination ended before the reported total");
    }
    items.push(...nextPage.data);
  }

  return items;
}
