# Repository-scoped ProjectV2 list filter implementation plan

## Goal

Return explicitly linked GitHub Projects from repository-scoped discovery by fixing the local SQL correlation bug without changing the API or schema.

## Task 1: Add the regression test

Files:

- Modify `apps/app-server/scripts/github-integration/repository-scoped-project-v2.test.mjs`

Steps:

1. Assert that the count query aliases `github_projects_v2` as `gp`.
2. Assert that the repository link filter compares `gpr.project_v2_id` with `gp.id`.
3. Assert that the selection filter compares its installation and project IDs with `gp.installation_id` and `gp.id`.
4. Run the focused test and confirm it fails against the current implementation.

## Task 2: Correct the query aliases

Files:

- Modify `apps/app-server/src/modules/github-integration/github-project-v2.service.ts`

Steps:

1. Alias the count query table as `gp`.
2. Qualify the filter builder's outer ProjectV2 columns with `gp`.
3. Qualify the list ordering columns with `gp`.
4. Run the focused test and confirm it passes.

## Task 3: Verify scope and regressions

1. Run the app-server TypeScript build.
2. Run the GitHub Integration domain test runner.
3. Review the diff for API, schema, common-area, and unrelated-domain changes.
4. Run the required read-only `fast_reviewer` pass and address any material finding.

