type GithubProjectV2Page<T> = {
  data: T[];
  meta: {
    total: number;
  };
};

export async function collectGithubProjectV2Pages<T>(
  loadPage: (page: number) => Promise<GithubProjectV2Page<T>>
): Promise<T[]> {
  const firstPage = await loadPage(1);
  const projects = [...firstPage.data];

  for (let page = 2; projects.length < firstPage.meta.total; page += 1) {
    const nextPage = await loadPage(page);
    if (nextPage.data.length === 0) {
      throw new Error("GitHub ProjectV2 pagination ended before the reported total");
    }
    projects.push(...nextPage.data);
  }

  return projects;
}
