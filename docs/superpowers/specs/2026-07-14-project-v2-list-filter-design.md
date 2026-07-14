# Repository-scoped ProjectV2 list filter design

## Problem

Repository ProjectV2 discovery successfully persists explicit repository links, but the follow-up list query returns an empty array. The correlated `EXISTS` filters refer to outer columns without the `gp` alias, so PostgreSQL resolves `id` and `installation_id` against the inner tables where possible. The resulting comparisons do not correlate with `github_projects_v2`.

## Scope

- Correct the ProjectV2 list query aliases in the GitHub Integration domain.
- Add a regression test under `apps/app-server/scripts/github-integration/`.
- Keep the existing repository-scoped discovery, selection, API response, and database schema unchanged.

## Design

Keep the existing `EXISTS` query structure and qualify every outer ProjectV2 column with the existing `gp` alias. Alias the count query's `github_projects_v2` table as `gp` so the same filter builder is valid for both count and data queries. Preserve the existing list ordering because it is unrelated to the correlation bug.

This is intentionally a local query correction. It does not change GitHub authentication, discovery token selection, API contracts, migrations, or shared app-server infrastructure.

## Verification

Extend `repository-scoped-project-v2.test.mjs` to assert that the count query and both correlated subqueries use the `gp` alias. Run the focused domain test before and after the production change to demonstrate RED/GREEN behavior, then run the app-server build and GitHub Integration domain runner.
