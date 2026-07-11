export const githubProjectV2RepositoryLinkSql = `
  SELECT project_v2_id
  FROM github_project_v2_repositories
  WHERE repository_id = $1
    AND project_v2_id = ANY($2::uuid[])
`;
