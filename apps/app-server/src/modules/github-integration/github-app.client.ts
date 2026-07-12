import { createSign } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError, badRequest, forbidden } from "../../common/api-error";
import { GITHUB_API_VERSION } from "./github-api.constants";

export interface GithubAppInstallationLookupRequest {
  installationId: number;
  appId: string;
  privateKey: string;
  now?: () => Date;
}

export interface GithubAppInstallationTokenRequest
  extends GithubAppInstallationLookupRequest {
  installationAccessToken?: string;
}

export interface GithubAppInstallationDeleteResult {
  deleted: true;
  alreadyDeleted: boolean;
}

const githubGraphqlRateLimitErrorMarker = Symbol("githubGraphqlRateLimitError");

export class GithubGraphqlRateLimitError extends ApiError {
  readonly [githubGraphqlRateLimitErrorMarker] = true;

  constructor(message: string) {
    super(HttpStatus.BAD_REQUEST, "BAD_REQUEST", message);
    this.message = message;
  }
}

export function isGithubGraphqlRateLimitError(error: unknown): boolean {
  return error instanceof GithubGraphqlRateLimitError && error[githubGraphqlRateLimitErrorMarker] === true;
}

export interface GithubAppInstallationDetails {
  githubInstallationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: string | null;
  permissions: Record<string, unknown>;
  installedAt: string | null;
  suspendedAt: string | null;
}

export interface GithubPullRequestFileLookupRequest
  extends GithubAppInstallationTokenRequest {
  owner: string;
  repo: string;
  pullNumber: number;
  page: number;
  perPage: number;
}

export interface GithubPullRequestLookupRequest
  extends GithubAppInstallationTokenRequest {
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface GithubRepositoryCompareRequest
  extends GithubAppInstallationTokenRequest {
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
}

export interface GithubRepositoryFileContentRequest
  extends GithubAppInstallationTokenRequest {
  owner: string;
  repo: string;
  path: string;
  ref: string;
}

export interface GithubInstallationRepositoriesRequest
  extends GithubAppInstallationTokenRequest {}

export interface GithubRepositoryIssuesRequest
  extends GithubAppInstallationTokenRequest {
  owner: string;
  repo: string;
}

export interface GithubRepositoryPullRequestsRequest
  extends GithubAppInstallationTokenRequest {
  owner: string;
  repo: string;
}

export interface GithubProjectV2UserAccessTokenRequest {
  userAccessToken?: string | null;
  accountType?: "User" | "Organization";
}

export interface GithubRepositoryIssueUpdateRequest
  extends GithubProjectV2UserAccessTokenRequest {
  owner: string;
  repo: string;
  issueNumber: number;
  assignees?: string[];
  title?: string;
  body?: string;
  state?: "open" | "closed";
}

export interface GithubRepositoryAssigneesRequest
  extends GithubProjectV2UserAccessTokenRequest {
  owner: string;
  repo: string;
}

export interface GithubRepositoryIssueCreateRequest
  extends GithubProjectV2UserAccessTokenRequest {
  owner: string;
  repo: string;
  title: string;
  body?: string;
}

export interface GithubProjectV2LookupRequest
  extends GithubAppInstallationTokenRequest,
    GithubProjectV2UserAccessTokenRequest {
  projectNodeId: string;
}

export interface GithubProjectV2ItemLookupRequest
  extends GithubAppInstallationTokenRequest,
    GithubProjectV2UserAccessTokenRequest {
  projectItemNodeId: string;
}

export type GithubProjectV2PermissionLevel = "ADMIN" | "WRITE" | "READ";

export interface GithubProjectV2PermissionLookupRequest {
  ownerLogin: string;
  ownerType: "User" | "Organization";
  projectNodeId: string;
  userAccessToken: string;
}

export interface GithubProjectV2PermissionLookupResult {
  permission: GithubProjectV2PermissionLevel | null;
}

export interface GithubProjectV2ItemAddRequest
  extends GithubProjectV2UserAccessTokenRequest {
  projectNodeId: string;
  contentNodeId: string;
}

export interface GithubProjectV2ItemAddResult {
  itemNodeId: string;
}

export interface GithubProjectV2ItemStatusUpdateRequest
  extends GithubProjectV2UserAccessTokenRequest {
  projectNodeId: string;
  itemNodeId: string;
  fieldNodeId: string;
  singleSelectOptionId: string | null;
}

export interface GithubProjectV2DiscoveryRequest
  extends GithubAppInstallationTokenRequest,
    GithubProjectV2UserAccessTokenRequest {
  accountLogin: string;
  accountType: "User" | "Organization";
}

export interface GithubInstallationRepositoryApiItem {
  id: number;
  node_id: string;
  owner: {
    login: string;
  };
  name: string;
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch?: string | null;
  html_url: string;
  created_at?: string | null;
  updated_at?: string | null;
  pushed_at?: string | null;
}

export interface GithubIssueApiItem {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  state_reason?: string | null;
  user?: {
    login?: string | null;
    avatar_url?: string | null;
  } | null;
  html_url: string;
  labels?: unknown[];
  assignees?: unknown[];
  milestone?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
}

export interface GithubIssueAssigneeApiItem {
  login: string;
  avatar_url?: string | null;
}

export interface GithubPullRequestApiItem {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body?: string | null;
  user?: {
    login?: string | null;
    avatar_url?: string | null;
  } | null;
  head?: {
    ref?: string | null;
    sha?: string | null;
    repo?: {
      name?: string | null;
      full_name?: string | null;
      owner?: {
        login?: string | null;
      } | null;
    } | null;
  } | null;
  base?: {
    ref?: string | null;
    sha?: string | null;
  } | null;
  changed_files?: number;
  additions?: number;
  deletions?: number;
  commits?: number;
  comments?: number;
  review_comments?: number;
  html_url: string;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  merged_at?: string | null;
  draft?: boolean;
  mergeable?: boolean | null;
  state?: string;
}

export interface GithubPullRequestFileApiItem {
  filename: string;
  previous_filename?: string | null;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  blob_url?: string | null;
  raw_url?: string | null;
  contents_url?: string | null;
  sha?: string | null;
  patch?: string | null;
}

export interface GithubPullRequestApiDetails {
  state: "open" | "closed";
  changed_files: number;
  additions: number;
  deletions: number;
  commits: number;
  draft: boolean;
  mergeable: boolean | null;
  htmlUrl: string;
  updatedAt: string | null;
  closedAt: string | null;
  mergedAt: string | null;
  head?: GithubPullRequestApiItem["head"];
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  headRepositoryOwner: string;
  headRepositoryName: string;
  headRepositoryFullName: string;
}

export interface GithubRepositoryMergeBaseApiDetails {
  mergeBaseSha: string;
}

export interface GithubRepositoryFileContentApiDetails {
  path: string;
  sha: string;
  size: number;
  content: string;
}

export interface GithubProjectV2ApiItem {
  id: string;
  databaseId: number | null;
  ownerLogin: string;
  ownerType: "User" | "Organization";
  number: number;
  title: string;
  shortDescription: string | null;
  readme: string | null;
  url: string;
  resourcePath: string | null;
  public: boolean;
  closed: boolean;
  template: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  raw: Record<string, unknown>;
}

export interface GithubProjectV2DiscoveryApiItem extends GithubProjectV2ApiItem {
  repositoryNodeIds: string[];
}

export interface GithubProjectV2FieldOptionApiItem {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  position: number;
}

export interface GithubProjectV2FieldApiItem {
  id: string;
  name: string;
  dataType: string;
  createdAt: string | null;
  updatedAt: string | null;
  options: GithubProjectV2FieldOptionApiItem[];
  raw: Record<string, unknown>;
}

export interface GithubProjectV2ItemFieldValueApiItem {
  id: string | null;
  fieldNodeId: string | null;
  fieldName: string;
  fieldDataType: string | null;
  textValue: string | null;
  numberValue: number | null;
  dateValue: string | null;
  singleSelectOptionId: string | null;
  singleSelectName: string | null;
  iterationId: string | null;
  iterationTitle: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw: Record<string, unknown>;
}

export interface GithubProjectV2ItemApiItem {
  id: string;
  databaseId: number | null;
  contentType: "ISSUE" | "PULL_REQUEST" | "DRAFT_ISSUE" | "UNKNOWN";
  contentNodeId: string | null;
  isArchived: boolean;
  statusFieldNodeId: string | null;
  statusOptionId: string | null;
  statusName: string | null;
  position: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  fieldValues: GithubProjectV2ItemFieldValueApiItem[];
  raw: Record<string, unknown>;
}

export interface GithubProjectV2ItemReconcileApiItem {
  item: GithubProjectV2ItemApiItem;
  issue: GithubIssueApiItem | null;
  pullRequest: GithubPullRequestApiItem | null;
  repositoryNodeId: string | null;
}

interface GithubInstallationApiPayload {
  id: number;
  account?: {
    login?: string;
    type?: string;
  } | null;
  repository_selection?: string | null;
  permissions?: unknown;
  created_at?: string | null;
  suspended_at?: string | null;
}

interface GithubInstallationTokenApiPayload {
  token?: unknown;
  expires_at?: unknown;
}

interface GithubInstallationRepositoriesApiPayload {
  repositories?: unknown;
}

interface GithubRepositoryCompareApiPayload {
  merge_base_commit?: {
    sha?: unknown;
  } | null;
}

interface GithubRepositoryContentApiPayload {
  type?: unknown;
  path?: unknown;
  sha?: unknown;
  size?: unknown;
  encoding?: unknown;
  content?: unknown;
}

type GithubProjectV2GraphqlTokenSource = "user" | "installation";

interface GithubProjectV2GraphqlAuth {
  token: string;
  source: GithubProjectV2GraphqlTokenSource;
  accountType?: "User" | "Organization";
}

interface GithubProjectV2GraphqlErrorContext {
  tokenSource: GithubProjectV2GraphqlTokenSource;
  accountType?: "User" | "Organization";
  writePermissionMessage?: string;
}

const GITHUB_SYNC_PER_PAGE = 100;
const GITHUB_SYNC_MAX_PAGES = 100;
const GITHUB_ASSIGNEE_LOOKUP_TIMEOUT_MS = 30_000;
const GITHUB_PROJECT_V2_OAUTH_SCOPE_ERROR_MESSAGE =
  "GitHub ProjectV2 OAuth connection must be reconnected with project scope";
const GITHUB_PROJECT_V2_OWNER_RESOLUTION_ERROR_MESSAGE =
  "GitHub ProjectV2 owner could not be resolved";
const GITHUB_PROJECT_V2_PERSONAL_USER_PERMISSION_ERROR_MESSAGE =
  "GitHub ProjectV2 OAuth token lacks permission to read personal ProjectV2";
const GITHUB_PROJECT_V2_PERSONAL_INSTALLATION_ACCESS_ERROR_MESSAGE =
  "GitHub App installation token cannot access personal ProjectV2";
const GITHUB_PROJECT_V2_ORGANIZATION_INSTALLATION_ACCESS_ERROR_MESSAGE =
  "GitHub App installation token cannot access organization ProjectV2";
const GITHUB_PROJECT_V2_USER_ACCESS_ERROR_MESSAGE =
  "GitHub ProjectV2 OAuth token cannot access this ProjectV2";
const GITHUB_ISSUE_WRITE_PERMISSION_ERROR_MESSAGE =
  "GitHub Issue write permission is required";
const GITHUB_PROJECT_V2_WRITE_PERMISSION_ERROR_MESSAGE =
  "GitHub ProjectV2 write permission is required";
const GITHUB_PROJECT_V2_SUPPORTED_ITEM_FIELD_VALUE_TYPENAMES: ReadonlySet<string> =
  new Set([
    "ProjectV2ItemFieldTextValue",
    "ProjectV2ItemFieldNumberValue",
    "ProjectV2ItemFieldDateValue",
    "ProjectV2ItemFieldSingleSelectValue",
    "ProjectV2ItemFieldIterationValue"
  ]);
const GITHUB_PROJECT_V2_DISCOVERY_FRAGMENT = `
  fragment PiloProjectV2DiscoveryFields on ProjectV2 {
    id
    databaseId
    owner {
      __typename
      ... on Organization {
        login
      }
      ... on User {
        login
      }
    }
    number
    title
    shortDescription
    readme
    url
    resourcePath
    public
    closed
    template
    createdAt
    updatedAt
    closedAt
    repositories(first: 100) {
      nodes {
        id
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
const GITHUB_ORGANIZATION_PROJECT_V2S_QUERY = `
  query PiloOrganizationProjectV2s($login: String!, $cursor: String) {
    organization(login: $login) {
      projectsV2(first: 100, after: $cursor) {
        nodes {
          ...PiloProjectV2DiscoveryFields
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  ${GITHUB_PROJECT_V2_DISCOVERY_FRAGMENT}
`;
const GITHUB_USER_PROJECT_V2S_QUERY = `
  query PiloUserProjectV2s($login: String!, $cursor: String) {
    user(login: $login) {
      projectsV2(first: 100, after: $cursor) {
        nodes {
          ...PiloProjectV2DiscoveryFields
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  ${GITHUB_PROJECT_V2_DISCOVERY_FRAGMENT}
`;
const GITHUB_PROJECT_V2_REPOSITORIES_QUERY = `
  query PiloProjectV2Repositories($projectId: ID!, $cursor: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        id
        repositories(first: 100, after: $cursor) {
          nodes {
            id
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;
const GITHUB_PROJECT_V2_QUERY = `
  query PiloProjectV2($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        id
        databaseId
        owner {
          __typename
          ... on Organization {
            login
          }
          ... on User {
            login
          }
        }
        number
        title
        shortDescription
        readme
        url
        resourcePath
        public
        closed
        template
        createdAt
        updatedAt
        closedAt
      }
    }
  }
`;
const GITHUB_PROJECT_V2_ORGANIZATION_PERMISSION_QUERY = `
  query PiloOrganizationProjectV2Permission(
    $login: String!,
    $cursor: String,
    $minPermissionLevel: ProjectV2PermissionLevel!
  ) {
    organization(login: $login) {
      projectsV2(
        first: 100,
        after: $cursor,
        minPermissionLevel: $minPermissionLevel
      ) {
        nodes {
          id
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;
const GITHUB_PROJECT_V2_USER_PERMISSION_QUERY = `
  query PiloUserProjectV2Permission(
    $login: String!,
    $cursor: String,
    $minPermissionLevel: ProjectV2PermissionLevel!
  ) {
    user(login: $login) {
      projectsV2(
        first: 100,
        after: $cursor,
        minPermissionLevel: $minPermissionLevel
      ) {
        nodes {
          id
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;
const GITHUB_PROJECT_V2_FIELDS_QUERY = `
  query PiloProjectV2Fields($projectId: ID!, $cursor: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 100, after: $cursor) {
          nodes {
            __typename
            ... on ProjectV2Field {
              id
              name
              dataType
              createdAt
              updatedAt
            }
            ... on ProjectV2IterationField {
              id
              name
              dataType
              createdAt
              updatedAt
            }
            ... on ProjectV2SingleSelectField {
              id
              name
              dataType
              createdAt
              updatedAt
              options {
                id
                name
                color
                description
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;
const GITHUB_PROJECT_V2_ITEM_FIELD_VALUE_SELECTION = `
  __typename
  ... on ProjectV2ItemFieldTextValue {
    id
    text
    createdAt
    updatedAt
    field {
      ... on ProjectV2Field {
        id
        name
        dataType
      }
      ... on ProjectV2SingleSelectField {
        id
        name
        dataType
      }
      ... on ProjectV2IterationField {
        id
        name
        dataType
      }
    }
  }
  ... on ProjectV2ItemFieldNumberValue {
    id
    number
    createdAt
    updatedAt
    field {
      ... on ProjectV2Field {
        id
        name
        dataType
      }
      ... on ProjectV2SingleSelectField {
        id
        name
        dataType
      }
      ... on ProjectV2IterationField {
        id
        name
        dataType
      }
    }
  }
  ... on ProjectV2ItemFieldDateValue {
    id
    date
    createdAt
    updatedAt
    field {
      ... on ProjectV2Field {
        id
        name
        dataType
      }
      ... on ProjectV2SingleSelectField {
        id
        name
        dataType
      }
      ... on ProjectV2IterationField {
        id
        name
        dataType
      }
    }
  }
  ... on ProjectV2ItemFieldSingleSelectValue {
    id
    name
    optionId
    createdAt
    updatedAt
    field {
      ... on ProjectV2Field {
        id
        name
        dataType
      }
      ... on ProjectV2SingleSelectField {
        id
        name
        dataType
      }
      ... on ProjectV2IterationField {
        id
        name
        dataType
      }
    }
  }
  ... on ProjectV2ItemFieldIterationValue {
    id
    title
    iterationId
    createdAt
    updatedAt
    field {
      ... on ProjectV2Field {
        id
        name
        dataType
      }
      ... on ProjectV2SingleSelectField {
        id
        name
        dataType
      }
      ... on ProjectV2IterationField {
        id
        name
        dataType
      }
    }
  }
`;
const GITHUB_PROJECT_V2_ITEMS_QUERY = `
  query PiloProjectV2Items($projectId: ID!, $cursor: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100, after: $cursor) {
          nodes {
            id
            databaseId
            type
            isArchived
            createdAt
            updatedAt
            content {
              __typename
              ... on Issue {
                id
                number
                title
                state
                url
              }
              ... on PullRequest {
                id
                number
                title
                state
                url
              }
              ... on DraftIssue {
                title
                body
              }
            }
            fieldValues(first: 100) {
              nodes {
                ${GITHUB_PROJECT_V2_ITEM_FIELD_VALUE_SELECTION}
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;
const GITHUB_PROJECT_V2_ITEM_LOOKUP_QUERY = `
  query PiloProjectV2Item($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        id
        databaseId
        type
        isArchived
        createdAt
        updatedAt
        content {
          __typename
          ... on Issue {
            id
            databaseId
            number
            title
            body
            state
            stateReason
            url
            author {
              login
              avatarUrl
            }
            labels(first: 100) {
              nodes {
                id
                name
                color
                description
              }
            }
            assignees(first: 100) {
              nodes {
                login
                avatarUrl
              }
            }
            milestone {
              id
              title
              description
              dueOn
              createdAt
              updatedAt
            }
            createdAt
            updatedAt
            closedAt
            repository {
              id
            }
          }
          ... on PullRequest {
            id
            databaseId
            number
            title
            body
            state
            url
            author {
              login
              avatarUrl
            }
            headRefName
            headRefOid
            headRepository {
              name
              nameWithOwner
              owner {
                login
              }
            }
            baseRefName
            baseRefOid
            changedFiles
            additions
            deletions
            commits {
              totalCount
            }
            comments {
              totalCount
            }
            reviews {
              totalCount
            }
            isDraft
            mergeable
            createdAt
            updatedAt
            closedAt
            mergedAt
            repository {
              id
            }
          }
          ... on DraftIssue {
            title
            body
          }
        }
        fieldValues(first: 100) {
          nodes {
            ${GITHUB_PROJECT_V2_ITEM_FIELD_VALUE_SELECTION}
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;
const GITHUB_PROJECT_V2_ITEM_FIELD_VALUES_QUERY = `
  query PiloProjectV2ItemFieldValues($itemId: ID!, $cursor: String) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        id
        fieldValues(first: 100, after: $cursor) {
          nodes {
            ${GITHUB_PROJECT_V2_ITEM_FIELD_VALUE_SELECTION}
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;
const GITHUB_PROJECT_V2_ADD_ITEM_BY_ID_MUTATION = `
  mutation PiloAddProjectV2ItemById($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(
      input: {
        projectId: $projectId
        contentId: $contentId
      }
    ) {
      item {
        id
      }
    }
  }
`;
const GITHUB_PROJECT_V2_UPDATE_ITEM_STATUS_MUTATION = `
  mutation PiloUpdateProjectV2ItemStatus(
    $projectId: ID!
    $itemId: ID!
    $fieldId: ID!
    $singleSelectOptionId: String!
  ) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $singleSelectOptionId }
      }
    ) {
      projectV2Item {
        id
      }
    }
  }
`;
const GITHUB_PROJECT_V2_CLEAR_ITEM_STATUS_MUTATION = `
  mutation PiloClearProjectV2ItemStatus(
    $projectId: ID!
    $itemId: ID!
    $fieldId: ID!
  ) {
    clearProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
      }
    ) {
      projectV2Item {
        id
      }
    }
  }
`;

@Injectable()
export class GithubAppClient {
  async getInstallation(
    input: GithubAppInstallationLookupRequest
  ): Promise<GithubAppInstallationDetails> {
    const appJwt = this.createAppJwt(input);
    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/app/installations/${input.installationId}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${appJwt}`,
            "X-GitHub-Api-Version": GITHUB_API_VERSION
          }
        }
      );
    } catch {
      throw badRequest("GitHub App installation lookup failed");
    }

    if (!response.ok) {
      throw badRequest("GitHub App installation lookup failed");
    }

    const payload = await this.readJson(
      response,
      "GitHub App installation lookup failed"
    );
    if (!this.isInstallationPayload(payload)) {
      throw badRequest("GitHub App installation lookup failed");
    }

    return {
      githubInstallationId: payload.id,
      accountLogin: payload.account.login,
      accountType: payload.account.type,
      repositorySelection: payload.repository_selection ?? null,
      permissions: this.toObject(payload.permissions),
      installedAt: payload.created_at ?? null,
      suspendedAt: payload.suspended_at ?? null
    };
  }

  async deleteInstallation(
    input: GithubAppInstallationLookupRequest
  ): Promise<GithubAppInstallationDeleteResult> {
    const appJwt = this.createAppJwt(input);
    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/app/installations/${input.installationId}`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${appJwt}`,
            "X-GitHub-Api-Version": GITHUB_API_VERSION
          }
        }
      );
    } catch {
      throw badRequest("GitHub App installation uninstall failed");
    }

    if (response.status === 404) {
      return {
        deleted: true,
        alreadyDeleted: true
      };
    }

    if (!response.ok) {
      throw badRequest("GitHub App installation uninstall failed");
    }

    return {
      deleted: true,
      alreadyDeleted: false
    };
  }

  async createInstallationAccessToken(
    input: GithubAppInstallationTokenRequest
  ): Promise<{ token: string; expiresAt: string | null }> {
    const appJwt = this.createAppJwt(input);
    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/app/installations/${input.installationId}/access_tokens`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${appJwt}`,
            "X-GitHub-Api-Version": GITHUB_API_VERSION
          }
        }
      );
    } catch {
      throw badRequest("GitHub App installation token lookup failed");
    }

    if (!response.ok) {
      throw badRequest("GitHub App installation token lookup failed");
    }

    const payload = await this.readJson(
      response,
      "GitHub App installation token lookup failed"
    );
    if (!this.isInstallationTokenPayload(payload)) {
      throw badRequest("GitHub App installation token lookup failed");
    }

    return {
      token: payload.token,
      expiresAt: typeof payload.expires_at === "string" ? payload.expires_at : null
    };
  }

  async listInstallationRepositories(
    input: GithubInstallationRepositoriesRequest
  ): Promise<GithubInstallationRepositoryApiItem[]> {
    const installationToken = await this.createInstallationAccessToken(input);
    const repositories: GithubInstallationRepositoryApiItem[] = [];

    for (let page = 1; page <= GITHUB_SYNC_MAX_PAGES; page += 1) {
      const url = new URL("https://api.github.com/installation/repositories");
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(GITHUB_SYNC_PER_PAGE));

      const payload = await this.fetchJsonWithToken(
        url,
        installationToken.token,
        "GitHub repositories sync failed"
      );
      if (!this.isInstallationRepositoriesPayload(payload)) {
        throw badRequest("GitHub repositories sync failed");
      }

      repositories.push(...payload.repositories);
      if (payload.repositories.length < GITHUB_SYNC_PER_PAGE) {
        break;
      }
    }

    return repositories;
  }

  async listRepositoryIssues(
    input: GithubRepositoryIssuesRequest
  ): Promise<GithubIssueApiItem[]> {
    const installationToken = await this.createInstallationAccessToken(input);
    const issues: GithubIssueApiItem[] = [];

    for (let page = 1; page <= GITHUB_SYNC_MAX_PAGES; page += 1) {
      const url = new URL(
        `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues`
      );
      url.searchParams.set("state", "all");
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(GITHUB_SYNC_PER_PAGE));

      const payload = await this.fetchJsonWithToken(
        url,
        installationToken.token,
        "GitHub issues sync failed"
      );
      if (!Array.isArray(payload)) {
        throw badRequest("GitHub issues sync failed");
      }

      const issuePayloads = payload.filter((item) => !this.isPullRequestIssue(item));
      if (!issuePayloads.every((item) => this.isIssuePayload(item))) {
        throw badRequest("GitHub issues sync failed");
      }

      issues.push(...issuePayloads);
      if (payload.length < GITHUB_SYNC_PER_PAGE) {
        break;
      }
    }

    return issues;
  }

  async updateRepositoryIssue(
    input: GithubRepositoryIssueUpdateRequest
  ): Promise<GithubIssueApiItem> {
    if (!input.userAccessToken) {
      throw badRequest("GitHub OAuth connection is required");
    }

    const body: Record<string, unknown> = {};
    if (input.assignees !== undefined) {
      body.assignees = input.assignees;
    }
    if (input.title !== undefined) {
      body.title = input.title;
    }
    if (input.body !== undefined) {
      body.body = input.body;
    }
    if (input.state !== undefined) {
      body.state = input.state;
    }

    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.issueNumber}`,
        {
          method: "PATCH",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${input.userAccessToken}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION
          },
          body: JSON.stringify(body)
        }
      );
    } catch {
      throw badRequest("GitHub issue update failed");
    }

    if (response.status === 403) {
      throw forbidden(GITHUB_ISSUE_WRITE_PERMISSION_ERROR_MESSAGE);
    }

    if (!response.ok) {
      throw badRequest("GitHub issue update failed");
    }

    const payload = await this.readJson(response, "GitHub issue update failed");
    if (!this.isIssuePayload(payload) || this.isPullRequestIssue(payload)) {
      throw badRequest("GitHub issue update failed");
    }

    return payload;
  }

  async listRepositoryAssignees(
    input: GithubRepositoryAssigneesRequest
  ): Promise<GithubIssueAssigneeApiItem[]> {
    if (!input.userAccessToken) {
      throw badRequest("GitHub OAuth connection is required");
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      GITHUB_ASSIGNEE_LOOKUP_TIMEOUT_MS
    );

    try {
      const assignees: GithubIssueAssigneeApiItem[] = [];
      for (let page = 1; page <= GITHUB_SYNC_MAX_PAGES; page += 1) {
        const url = new URL(
          `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/assignees`
        );
        url.searchParams.set("page", String(page));
        url.searchParams.set("per_page", String(GITHUB_SYNC_PER_PAGE));

        const payload = await this.fetchJsonWithToken(
          url,
          input.userAccessToken,
          "GitHub issue assignee lookup failed",
          controller.signal
        );
        if (
          !Array.isArray(payload) ||
          !payload.every((item) => this.isIssueAssigneePayload(item))
        ) {
          throw badRequest("GitHub issue assignee lookup failed");
        }

        assignees.push(...payload);
        if (payload.length < GITHUB_SYNC_PER_PAGE) {
          break;
        }
      }

      return assignees;
    } finally {
      clearTimeout(timeout);
    }
  }

  async createRepositoryIssue(
    input: GithubRepositoryIssueCreateRequest
  ): Promise<GithubIssueApiItem> {
    if (!input.userAccessToken) {
      throw badRequest("GitHub OAuth connection is required");
    }

    const body: Record<string, unknown> = {
      title: input.title
    };
    if (input.body !== undefined) {
      body.body = input.body;
    }

    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${input.userAccessToken}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION
          },
          body: JSON.stringify(body)
        }
      );
    } catch {
      throw badRequest("GitHub issue create failed");
    }

    if (response.status === 403) {
      throw forbidden(GITHUB_ISSUE_WRITE_PERMISSION_ERROR_MESSAGE);
    }

    if (!response.ok) {
      throw badRequest("GitHub issue create failed");
    }

    const payload = await this.readJson(response, "GitHub issue create failed");
    if (!this.isIssuePayload(payload) || this.isPullRequestIssue(payload)) {
      throw badRequest("GitHub issue create failed");
    }

    return payload;
  }

  async listRepositoryPullRequests(
    input: GithubRepositoryPullRequestsRequest
  ): Promise<GithubPullRequestApiItem[]> {
    const installationToken = await this.createInstallationAccessToken(input);
    const pullRequests: GithubPullRequestApiItem[] = [];

    for (let page = 1; page <= GITHUB_SYNC_MAX_PAGES; page += 1) {
      const url = new URL(
        `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`
      );
      url.searchParams.set("state", "all");
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(GITHUB_SYNC_PER_PAGE));

      const payload = await this.fetchJsonWithToken(
        url,
        installationToken.token,
        "GitHub pull requests sync failed"
      );
      if (!Array.isArray(payload) || !payload.every((item) => this.isPullRequestPayload(item))) {
        throw badRequest("GitHub pull requests sync failed");
      }

      pullRequests.push(...payload);
      if (payload.length < GITHUB_SYNC_PER_PAGE) {
        break;
      }
    }

    return pullRequests;
  }

  async listProjectV2s(
    input: GithubProjectV2DiscoveryRequest
  ): Promise<GithubProjectV2DiscoveryApiItem[]> {
    const graphqlAuth = await this.getProjectV2GraphqlAuth(input);
    const projects: GithubProjectV2DiscoveryApiItem[] = [];
    let cursor: string | null = null;
    const query =
      input.accountType === "Organization"
        ? GITHUB_ORGANIZATION_PROJECT_V2S_QUERY
        : GITHUB_USER_PROJECT_V2S_QUERY;

    do {
      const data = await this.fetchGraphqlWithToken(
        graphqlAuth.token,
        query,
        {
          login: input.accountLogin,
          cursor
        },
        "GitHub ProjectV2 discovery failed",
        {
          tokenSource: graphqlAuth.source,
          accountType: graphqlAuth.accountType
        }
      );
      const connection = this.readProjectV2OwnerConnection(
        data,
        input.accountType,
        "GitHub ProjectV2 discovery failed"
      );

      for (const projectNode of connection.nodes) {
        const firstRepositoryPage = this.readProjectV2RepositoryPage(
          projectNode,
          "GitHub ProjectV2 discovery failed"
        );
        const repositoryNodeIds = [
          ...firstRepositoryPage.nodeIds,
          ...(await this.listRemainingProjectV2RepositoryNodeIds(
            graphqlAuth,
            this.readString(projectNode.id, "GitHub ProjectV2 discovery failed"),
            firstRepositoryPage.endCursor,
            firstRepositoryPage.hasNextPage
          ))
        ];

        projects.push({
          ...this.mapProjectV2(projectNode),
          repositoryNodeIds: this.uniqueStrings(repositoryNodeIds)
        });
      }

      cursor = connection.hasNextPage ? connection.endCursor : null;
    } while (cursor);

    return projects;
  }

  async getProjectV2(
    input: GithubProjectV2LookupRequest
  ): Promise<GithubProjectV2ApiItem> {
    const graphqlAuth = await this.getProjectV2GraphqlAuth(input);
    const data = await this.fetchGraphqlWithToken(
      graphqlAuth.token,
      GITHUB_PROJECT_V2_QUERY,
      {
        projectId: input.projectNodeId
      },
      "GitHub ProjectV2 sync failed",
      {
        tokenSource: graphqlAuth.source,
        accountType: graphqlAuth.accountType
      }
    );
    const project = this.readProjectV2Node(data, "GitHub ProjectV2 sync failed");

    return this.mapProjectV2(project);
  }

  async getProjectV2PermissionLevel(
    input: GithubProjectV2PermissionLookupRequest
  ): Promise<GithubProjectV2PermissionLookupResult> {
    const levels: GithubProjectV2PermissionLevel[] = ["ADMIN", "WRITE", "READ"];

    for (const level of levels) {
      if (await this.hasProjectV2PermissionLevel(input, level)) {
        return {
          permission: level
        };
      }
    }

    return {
      permission: null
    };
  }

  async listProjectV2Fields(
    input: GithubProjectV2LookupRequest
  ): Promise<GithubProjectV2FieldApiItem[]> {
    const graphqlAuth = await this.getProjectV2GraphqlAuth(input);
    const fields: GithubProjectV2FieldApiItem[] = [];
    let cursor: string | null = null;

    do {
      const data = await this.fetchGraphqlWithToken(
        graphqlAuth.token,
        GITHUB_PROJECT_V2_FIELDS_QUERY,
        {
          projectId: input.projectNodeId,
          cursor
        },
        "GitHub ProjectV2 fields sync failed",
        {
          tokenSource: graphqlAuth.source,
          accountType: graphqlAuth.accountType
        }
      );
      const connection = this.readProjectV2Connection(
        data,
        "fields",
        "GitHub ProjectV2 fields sync failed"
      );
      fields.push(...connection.nodes.map((node) => this.mapProjectV2Field(node)));
      cursor = connection.hasNextPage ? connection.endCursor : null;
    } while (cursor);

    return fields;
  }

  async listProjectV2Items(
    input: GithubProjectV2LookupRequest
  ): Promise<GithubProjectV2ItemApiItem[]> {
    const graphqlAuth = await this.getProjectV2GraphqlAuth(input);
    const items: GithubProjectV2ItemApiItem[] = [];
    let cursor: string | null = null;

    do {
      const data = await this.fetchGraphqlWithToken(
        graphqlAuth.token,
        GITHUB_PROJECT_V2_ITEMS_QUERY,
        {
          projectId: input.projectNodeId,
          cursor
        },
        "GitHub ProjectV2 items sync failed",
        {
          tokenSource: graphqlAuth.source,
          accountType: graphqlAuth.accountType
        }
      );
      const connection = this.readProjectV2Connection(
        data,
        "items",
        "GitHub ProjectV2 items sync failed"
      );

      for (const node of connection.nodes) {
        const itemId = this.readString(node.id, "GitHub ProjectV2 items sync failed");
        const fieldValuePage = this.readProjectV2ItemFieldValuePage(
          node,
          "GitHub ProjectV2 items sync failed"
        );
        const remainingFieldValues =
          await this.listRemainingProjectV2ItemFieldValues(
            graphqlAuth,
            itemId,
            fieldValuePage.endCursor,
            fieldValuePage.hasNextPage
          );
        items.push(
          this.mapProjectV2Item(node, [
            ...fieldValuePage.nodes,
            ...remainingFieldValues
          ])
        );
      }

      cursor = connection.hasNextPage ? connection.endCursor : null;
    } while (cursor);

    return items;
  }

  async getProjectV2Item(
    input: GithubProjectV2ItemLookupRequest
  ): Promise<GithubProjectV2ItemReconcileApiItem | null> {
    const graphqlAuth = await this.getProjectV2GraphqlAuth(input);
    const errorMessage = "GitHub ProjectV2 item lookup failed";
    const data = await this.fetchGraphqlWithToken(
      graphqlAuth.token,
      GITHUB_PROJECT_V2_ITEM_LOOKUP_QUERY,
      { itemId: input.projectItemNodeId },
      errorMessage,
      {
        tokenSource: graphqlAuth.source,
        accountType: graphqlAuth.accountType
      }
    );
    if (this.toObject(data).node === null) {
      return null;
    }

    const node = this.readProjectV2ItemNode(data, errorMessage);
    const itemId = this.readString(node.id, errorMessage);
    const fieldValuePage = this.readProjectV2ItemFieldValuePage(node, errorMessage);
    const remainingFieldValues = await this.listRemainingProjectV2ItemFieldValues(
      graphqlAuth,
      itemId,
      fieldValuePage.endCursor,
      fieldValuePage.hasNextPage
    );

    return this.mapProjectV2ItemReconcile(
      node,
      [...fieldValuePage.nodes, ...remainingFieldValues]
    );
  }

  async updateProjectV2ItemStatus(
    input: GithubProjectV2ItemStatusUpdateRequest
  ): Promise<void> {
    if (!input.userAccessToken) {
      throw badRequest("GitHub OAuth connection is required");
    }

    const errorMessage = "GitHub ProjectV2 status update failed";
    const mutation = input.singleSelectOptionId
      ? GITHUB_PROJECT_V2_UPDATE_ITEM_STATUS_MUTATION
      : GITHUB_PROJECT_V2_CLEAR_ITEM_STATUS_MUTATION;
    const mutationName = input.singleSelectOptionId
      ? "updateProjectV2ItemFieldValue"
      : "clearProjectV2ItemFieldValue";
    const variables: Record<string, unknown> = {
      projectId: input.projectNodeId,
      itemId: input.itemNodeId,
      fieldId: input.fieldNodeId
    };

    if (input.singleSelectOptionId) {
      variables.singleSelectOptionId = input.singleSelectOptionId;
    }

    const data = await this.fetchGraphqlWithToken(
      input.userAccessToken,
      mutation,
      variables,
      errorMessage,
      {
        tokenSource: "user",
        writePermissionMessage: GITHUB_PROJECT_V2_WRITE_PERMISSION_ERROR_MESSAGE
      }
    );

    this.readProjectV2ItemMutation(data, mutationName, errorMessage);
  }

  async addProjectV2ItemByContentId(
    input: GithubProjectV2ItemAddRequest
  ): Promise<GithubProjectV2ItemAddResult> {
    if (!input.userAccessToken) {
      throw badRequest("GitHub OAuth connection is required");
    }

    const errorMessage = "GitHub ProjectV2 item add failed";
    const data = await this.fetchGraphqlWithToken(
      input.userAccessToken,
      GITHUB_PROJECT_V2_ADD_ITEM_BY_ID_MUTATION,
      {
        contentId: input.contentNodeId,
        projectId: input.projectNodeId
      },
      errorMessage,
      {
        tokenSource: "user",
        writePermissionMessage: GITHUB_PROJECT_V2_WRITE_PERMISSION_ERROR_MESSAGE
      }
    );

    return this.readProjectV2ItemAddMutation(data, errorMessage);
  }

  async listPullRequestFiles(
    input: GithubPullRequestFileLookupRequest
  ): Promise<GithubPullRequestFileApiItem[]> {
    const installationToken = await this.createInstallationAccessToken(input);
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.pullNumber}/files`
    );
    url.searchParams.set("page", String(input.page));
    url.searchParams.set("per_page", String(input.perPage));

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${installationToken.token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        }
      });
    } catch {
      throw badRequest("GitHub pull request files lookup failed");
    }

    if (!response.ok) {
      throw badRequest("GitHub pull request files lookup failed");
    }

    const payload = await this.readJson(
      response,
      "GitHub pull request files lookup failed"
    );
    if (!Array.isArray(payload) || !payload.every((item) => this.isFilePayload(item))) {
      throw badRequest("GitHub pull request files lookup failed");
    }

    return payload;
  }

  async getPullRequest(
    input: GithubPullRequestLookupRequest
  ): Promise<GithubPullRequestApiDetails> {
    const installationToken = await this.createInstallationAccessToken(input);
    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.pullNumber}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${installationToken.token}`,
            "X-GitHub-Api-Version": GITHUB_API_VERSION
          }
        }
      );
    } catch {
      throw badRequest("GitHub pull request lookup failed");
    }

    if (!response.ok) {
      throw badRequest("GitHub pull request lookup failed");
    }

    const payload = await this.readJson(response, "GitHub pull request lookup failed");
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw badRequest("GitHub pull request lookup failed");
    }

    const pullRequest = payload as GithubPullRequestApiItem;
    if (
      typeof pullRequest.changed_files !== "number" ||
      typeof pullRequest.additions !== "number" ||
      typeof pullRequest.deletions !== "number" ||
      typeof pullRequest.commits !== "number"
    ) {
      throw badRequest("GitHub pull request lookup failed");
    }

    const state = pullRequest.state;
    if (state !== "open" && state !== "closed") {
      throw badRequest("GitHub pull request lookup failed");
    }

    const mergeable = pullRequest.mergeable;
    if (mergeable !== true && mergeable !== false && mergeable !== null) {
      throw badRequest("GitHub pull request lookup failed");
    }

    const headRef = pullRequest.head?.ref;
    const headSha = pullRequest.head?.sha;
    const baseRef = pullRequest.base?.ref;
    const baseSha = pullRequest.base?.sha;
    const headRepositoryOwner = pullRequest.head?.repo?.owner?.login;
    const headRepositoryName = pullRequest.head?.repo?.name;
    const headRepositoryFullName = pullRequest.head?.repo?.full_name;
    if (
      typeof headRef !== "string" ||
      headRef.length === 0 ||
      typeof headSha !== "string" ||
      headSha.length === 0 ||
      typeof baseRef !== "string" ||
      baseRef.length === 0 ||
      typeof baseSha !== "string" ||
      baseSha.length === 0 ||
      typeof headRepositoryOwner !== "string" ||
      headRepositoryOwner.length === 0 ||
      typeof headRepositoryName !== "string" ||
      headRepositoryName.length === 0 ||
      typeof headRepositoryFullName !== "string" ||
      headRepositoryFullName.length === 0
    ) {
      throw badRequest("GitHub pull request lookup failed");
    }

    return {
      state,
      changed_files: pullRequest.changed_files,
      additions: pullRequest.additions,
      deletions: pullRequest.deletions,
      commits: pullRequest.commits,
      draft: pullRequest.draft ?? false,
      mergeable,
      htmlUrl: pullRequest.html_url,
      updatedAt: pullRequest.updated_at ?? null,
      closedAt: pullRequest.closed_at ?? null,
      mergedAt: pullRequest.merged_at ?? null,
      headRef,
      headSha,
      baseRef,
      baseSha,
      headRepositoryOwner,
      headRepositoryName,
      headRepositoryFullName
    };
  }

  async getRepositoryMergeBase(
    input: GithubRepositoryCompareRequest
  ): Promise<GithubRepositoryMergeBaseApiDetails> {
    const installationToken = await this.resolveInstallationAccessToken(input);
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/compare/${encodeURIComponent(input.baseRef)}...${encodeURIComponent(input.headRef)}`
    );
    const payload = await this.fetchJsonWithToken(
      url,
      installationToken,
      "GitHub repository compare lookup failed"
    );

    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw badRequest("GitHub repository compare lookup failed");
    }

    const compare = payload as GithubRepositoryCompareApiPayload;
    const mergeBaseSha = compare.merge_base_commit?.sha;
    if (typeof mergeBaseSha !== "string" || !mergeBaseSha.trim()) {
      throw badRequest("GitHub repository compare lookup failed");
    }

    return {
      mergeBaseSha
    };
  }

  async getRepositoryFileContent(
    input: GithubRepositoryFileContentRequest
  ): Promise<GithubRepositoryFileContentApiDetails | null> {
    const installationToken = await this.resolveInstallationAccessToken(input);
    const encodedPath = input.path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${encodedPath}`
    );
    url.searchParams.set("ref", input.ref);

    const response = await this.fetchRepositoryFileContentWithRetry(
      url,
      installationToken
    );

    if (response.status === 404) {
      return null;
    }

    if (response.status === 401) {
      throw badRequest("GitHub App installation token is invalid");
    }

    if (
      (response.status === 403 && this.shouldRetryRepositoryRead(response)) ||
      response.status === 429 ||
      response.status === 500 ||
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504
    ) {
      throw badRequest("GitHub repository file lookup is temporarily unavailable");
    }

    if (response.status === 403) {
      throw forbidden("GitHub App Contents read permission is required");
    }

    if (!response.ok) {
      throw badRequest("GitHub repository file content lookup failed");
    }

    const payload = await this.readJson(
      response,
      "GitHub repository file content lookup failed"
    );
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw badRequest("GitHub repository file content lookup failed");
    }

    const contentPayload = payload as GithubRepositoryContentApiPayload;
    if (contentPayload.type !== "file") {
      return null;
    }

    if (
      typeof contentPayload.path !== "string" ||
      typeof contentPayload.sha !== "string" ||
      typeof contentPayload.size !== "number" ||
      contentPayload.encoding !== "base64" ||
      typeof contentPayload.content !== "string"
    ) {
      throw badRequest("GitHub repository file content lookup failed");
    }

    return {
      path: contentPayload.path,
      sha: contentPayload.sha,
      size: contentPayload.size,
      content: Buffer.from(
        contentPayload.content.replace(/\s/g, ""),
        "base64"
      ).toString("utf8")
    };
  }

  private async resolveInstallationAccessToken(
    input: GithubAppInstallationTokenRequest
  ): Promise<string> {
    if (input.installationAccessToken) {
      return input.installationAccessToken;
    }

    return (await this.createInstallationAccessToken(input)).token;
  }

  private async fetchRepositoryFileContentWithRetry(
    url: URL,
    accessToken: string
  ): Promise<Response> {
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${accessToken}`,
            "X-GitHub-Api-Version": GITHUB_API_VERSION
          }
        });
      } catch {
        if (attempt === maxAttempts) {
          throw badRequest("GitHub repository file lookup is temporarily unavailable");
        }

        await this.waitForRepositoryReadRetry(attempt);
        continue;
      }

      if (!this.shouldRetryRepositoryRead(response) || attempt === maxAttempts) {
        return response;
      }

      await this.waitForRepositoryReadRetry(attempt);
    }

    throw badRequest("GitHub repository file lookup is temporarily unavailable");
  }

  private shouldRetryRepositoryRead(response: Response): boolean {
    if (
      response.status === 429 ||
      response.status === 500 ||
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504
    ) {
      return true;
    }

    return (
      response.status === 403 &&
      (response.headers.get("retry-after") !== null ||
        response.headers.get("x-ratelimit-remaining") === "0")
    );
  }

  private async waitForRepositoryReadRetry(attempt: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, attempt * 100));
  }

  private async getProjectV2GraphqlAuth(
    input:
      | GithubProjectV2LookupRequest
      | GithubProjectV2ItemLookupRequest
      | GithubProjectV2DiscoveryRequest
  ): Promise<GithubProjectV2GraphqlAuth> {
    if (input.userAccessToken) {
      return {
        token: input.userAccessToken,
        source: "user",
        accountType: input.accountType
      };
    }

    if (input.accountType === "User") {
      throw badRequest(GITHUB_PROJECT_V2_PERSONAL_INSTALLATION_ACCESS_ERROR_MESSAGE);
    }

    const installationToken = await this.createInstallationAccessToken(input);
    return {
      token: installationToken.token,
      source: "installation",
      accountType: input.accountType
    };
  }

  private async fetchGraphqlWithToken(
    token: string,
    query: string,
    variables: Record<string, unknown>,
    errorMessage: string,
    context?: GithubProjectV2GraphqlErrorContext
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        },
        body: JSON.stringify({
          query,
          variables
        })
      });
    } catch {
      throw badRequest(errorMessage);
    }

    if (this.isGraphqlRateLimitedResponse(response)) {
      throw new GithubGraphqlRateLimitError(errorMessage);
    }

    if (response.status === 403 && context?.writePermissionMessage) {
      throw forbidden(context.writePermissionMessage);
    }

    if (!response.ok) {
      throw badRequest(
        this.mapGraphqlHttpErrorMessage(response.status, errorMessage, context)
      );
    }

    const payload = await this.readJson(response, errorMessage);
    const record = this.toObject(payload);
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      if (this.hasGraphqlRateLimitError(record.errors)) {
        throw new GithubGraphqlRateLimitError(errorMessage);
      }

      if (
        context?.writePermissionMessage &&
        record.errors.some((error) => this.isProjectV2WritePermissionError(error))
      ) {
        throw forbidden(context.writePermissionMessage);
      }

      throw badRequest(
        this.mapGraphqlErrorMessage(record.errors, errorMessage, context)
      );
    }

    const data = record.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw badRequest(errorMessage);
    }

    return data;
  }

  private isGraphqlRateLimitedResponse(response: Response): boolean {
    return response.status === 429 || (
      response.status === 403 &&
      response.headers?.get?.("x-ratelimit-remaining") === "0"
    );
  }

  private hasGraphqlRateLimitError(errors: unknown[]): boolean {
    return errors.some((error) => {
      const record = this.toObject(error);
      const type = typeof record.type === "string" ? record.type : "";
      const message = typeof record.message === "string" ? record.message : "";
      return type === "RATE_LIMITED" || /\brate limit\b/i.test(message);
    });
  }

  private async listRemainingProjectV2RepositoryNodeIds(
    graphqlAuth: GithubProjectV2GraphqlAuth,
    projectNodeId: string,
    cursor: string | null,
    hasNextPage: boolean
  ): Promise<string[]> {
    const repositoryNodeIds: string[] = [];
    let nextCursor = hasNextPage ? cursor : null;

    while (nextCursor) {
      const data = await this.fetchGraphqlWithToken(
        graphqlAuth.token,
        GITHUB_PROJECT_V2_REPOSITORIES_QUERY,
        {
          projectId: projectNodeId,
          cursor: nextCursor
        },
        "GitHub ProjectV2 discovery failed",
        {
          tokenSource: graphqlAuth.source,
          accountType: graphqlAuth.accountType
        }
      );
      const page = this.readProjectV2RepositoryConnection(
        data,
        "GitHub ProjectV2 discovery failed"
      );
      repositoryNodeIds.push(...page.nodeIds);
      nextCursor = page.hasNextPage ? page.endCursor : null;
    }

    return repositoryNodeIds;
  }

  private async hasProjectV2PermissionLevel(
    input: GithubProjectV2PermissionLookupRequest,
    permission: GithubProjectV2PermissionLevel
  ): Promise<boolean> {
    const query =
      input.ownerType === "Organization"
        ? GITHUB_PROJECT_V2_ORGANIZATION_PERMISSION_QUERY
        : GITHUB_PROJECT_V2_USER_PERMISSION_QUERY;
    let cursor: string | null = null;

    do {
      const data = await this.fetchGraphqlWithToken(
        input.userAccessToken,
        query,
        {
          cursor,
          login: input.ownerLogin,
          minPermissionLevel: permission
        },
        "GitHub ProjectV2 permission lookup failed",
        {
          accountType: input.ownerType,
          tokenSource: "user"
        }
      );
      const page = this.readProjectV2PermissionPage(
        data,
        input.ownerType,
        "GitHub ProjectV2 permission lookup failed"
      );

      if (page.nodeIds.includes(input.projectNodeId)) {
        return true;
      }

      cursor = page.hasNextPage ? page.endCursor : null;
    } while (cursor);

    return false;
  }

  private async listRemainingProjectV2ItemFieldValues(
    graphqlAuth: GithubProjectV2GraphqlAuth,
    itemNodeId: string,
    cursor: string | null,
    hasNextPage: boolean
  ): Promise<GithubProjectV2ItemFieldValueApiItem[]> {
    const fieldValues: GithubProjectV2ItemFieldValueApiItem[] = [];
    let nextCursor = hasNextPage ? cursor : null;

    while (nextCursor) {
      const data = await this.fetchGraphqlWithToken(
        graphqlAuth.token,
        GITHUB_PROJECT_V2_ITEM_FIELD_VALUES_QUERY,
        {
          itemId: itemNodeId,
          cursor: nextCursor
        },
        "GitHub ProjectV2 items sync failed",
        {
          tokenSource: graphqlAuth.source,
          accountType: graphqlAuth.accountType
        }
      );
      const item = this.readProjectV2ItemNode(
        data,
        "GitHub ProjectV2 items sync failed"
      );
      const page = this.readProjectV2ItemFieldValuePage(
        item,
        "GitHub ProjectV2 items sync failed"
      );
      fieldValues.push(...page.nodes);
      nextCursor = page.hasNextPage ? page.endCursor : null;
    }

    return fieldValues;
  }

  private readProjectV2ItemMutation(
    data: unknown,
    mutationName: string,
    errorMessage: string
  ): void {
    const payload = this.toObject(this.toObject(data)[mutationName]);
    const projectV2Item = this.toObject(payload.projectV2Item);

    if (typeof projectV2Item.id !== "string" || !projectV2Item.id) {
      throw badRequest(errorMessage);
    }
  }

  private readProjectV2ItemAddMutation(
    data: unknown,
    errorMessage: string
  ): GithubProjectV2ItemAddResult {
    const payload = this.toObject(this.toObject(data).addProjectV2ItemById);
    const item = this.toObject(payload.item);
    const itemNodeId = this.toNullableString(item.id);

    if (!itemNodeId) {
      throw badRequest(errorMessage);
    }

    return { itemNodeId };
  }

  private mapGraphqlErrorMessage(
    errors: unknown[],
    fallbackMessage: string,
    context?: GithubProjectV2GraphqlErrorContext
  ): string {
    if (
      fallbackMessage.includes("ProjectV2") &&
      errors.some((error) => this.isProjectV2AccessError(error))
    ) {
      return this.getProjectV2AccessErrorMessage(errors, context);
    }

    return fallbackMessage;
  }

  private mapGraphqlHttpErrorMessage(
    status: number,
    fallbackMessage: string,
    context?: GithubProjectV2GraphqlErrorContext
  ): string {
    if (
      fallbackMessage.includes("ProjectV2") &&
      (status === 401 || status === 403 || status === 404)
    ) {
      return this.getProjectV2AccessErrorMessage([], context);
    }

    return fallbackMessage;
  }

  private getProjectV2AccessErrorMessage(
    errors: unknown[],
    context?: GithubProjectV2GraphqlErrorContext
  ): string {
    if (
      context?.tokenSource === "user" &&
      errors.some((error) => this.isProjectV2ScopeError(error))
    ) {
      return GITHUB_PROJECT_V2_OAUTH_SCOPE_ERROR_MESSAGE;
    }

    if (errors.some((error) => this.isProjectV2OwnerResolutionError(error))) {
      return GITHUB_PROJECT_V2_OWNER_RESOLUTION_ERROR_MESSAGE;
    }

    if (context?.tokenSource === "user" && context.accountType === "User") {
      return GITHUB_PROJECT_V2_PERSONAL_USER_PERMISSION_ERROR_MESSAGE;
    }

    if (context?.tokenSource === "user") {
      return GITHUB_PROJECT_V2_USER_ACCESS_ERROR_MESSAGE;
    }

    if (context?.accountType === "User") {
      return GITHUB_PROJECT_V2_PERSONAL_INSTALLATION_ACCESS_ERROR_MESSAGE;
    }

    return GITHUB_PROJECT_V2_ORGANIZATION_INSTALLATION_ACCESS_ERROR_MESSAGE;
  }

  private isProjectV2AccessError(error: unknown): boolean {
    if (!this.isRecord(error)) {
      return false;
    }

    const message = this.toNullableString(error.message)?.toLowerCase();
    if (!message) {
      return false;
    }

    return (
      this.isProjectV2ScopeError(error) ||
      message.includes("resource not accessible") ||
      message.includes("permission") ||
      message.includes("could not resolve to a user") ||
      message.includes("could not resolve to an organization")
    );
  }

  private isProjectV2WritePermissionError(error: unknown): boolean {
    if (
      !this.isRecord(error) ||
      this.isProjectV2ScopeError(error) ||
      this.isProjectV2OwnerResolutionError(error)
    ) {
      return false;
    }

    const message = this.toNullableString(error.message)?.toLowerCase();
    return Boolean(
      message &&
        (message.includes("resource not accessible") ||
          message.includes("permission"))
    );
  }

  private isProjectV2ScopeError(error: unknown): boolean {
    if (!this.isRecord(error)) {
      return false;
    }

    const message = this.toNullableString(error.message)?.toLowerCase();
    if (!message) {
      return false;
    }

    return message.includes("read:project") || message.includes("scope");
  }

  private isProjectV2OwnerResolutionError(error: unknown): boolean {
    if (!this.isRecord(error)) {
      return false;
    }

    const message = this.toNullableString(error.message)?.toLowerCase();
    if (!message) {
      return false;
    }

    return (
      message.includes("could not resolve to a user") ||
      message.includes("could not resolve to an organization")
    );
  }

  private readProjectV2OwnerConnection(
    data: unknown,
    accountType: "User" | "Organization",
    errorMessage: string
  ): {
    nodes: Record<string, unknown>[];
    hasNextPage: boolean;
    endCursor: string | null;
  } {
    const ownerField = accountType === "Organization" ? "organization" : "user";
    const owner = this.toObject(this.toObject(data)[ownerField]);
    const connection = this.toObject(owner.projectsV2);
    const nodes = Array.isArray(connection.nodes)
      ? connection.nodes.filter((node): node is Record<string, unknown> =>
          this.isRecord(node)
        )
      : null;
    const pageInfo = this.toObject(connection.pageInfo);

    if (!nodes || typeof pageInfo.hasNextPage !== "boolean") {
      throw badRequest(errorMessage);
    }

    return {
      nodes,
      hasNextPage: pageInfo.hasNextPage,
      endCursor:
        typeof pageInfo.endCursor === "string" && pageInfo.endCursor
          ? pageInfo.endCursor
          : null
    };
  }

  private readProjectV2PermissionPage(
    data: unknown,
    accountType: "User" | "Organization",
    errorMessage: string
  ): {
    nodeIds: string[];
    hasNextPage: boolean;
    endCursor: string | null;
  } {
    const ownerField = accountType === "Organization" ? "organization" : "user";
    const owner = this.toObject(this.toObject(data)[ownerField]);
    const connection = this.toObject(owner.projectsV2);
    const nodes = Array.isArray(connection.nodes)
      ? connection.nodes.filter((node): node is Record<string, unknown> =>
          this.isRecord(node)
        )
      : null;
    const pageInfo = this.toObject(connection.pageInfo);

    if (!nodes || typeof pageInfo.hasNextPage !== "boolean") {
      throw badRequest(errorMessage);
    }

    return {
      nodeIds: nodes
        .map((node) => node.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
      hasNextPage: pageInfo.hasNextPage,
      endCursor:
        typeof pageInfo.endCursor === "string" && pageInfo.endCursor
          ? pageInfo.endCursor
          : null
    };
  }

  private readProjectV2Node(data: unknown, errorMessage: string): Record<string, unknown> {
    const node = this.toObject(this.toObject(data).node);
    if (node.__typename && node.__typename !== "ProjectV2") {
      throw badRequest(errorMessage);
    }

    if (typeof node.id !== "string") {
      throw badRequest(errorMessage);
    }

    return node;
  }

  private readProjectV2RepositoryConnection(
    data: unknown,
    errorMessage: string
  ): {
    nodeIds: string[];
    hasNextPage: boolean;
    endCursor: string | null;
  } {
    return this.readProjectV2RepositoryPage(
      this.readProjectV2Node(data, errorMessage),
      errorMessage
    );
  }

  private readProjectV2RepositoryPage(
    project: Record<string, unknown>,
    errorMessage: string
  ): {
    nodeIds: string[];
    hasNextPage: boolean;
    endCursor: string | null;
  } {
    const connection = this.toObject(project.repositories);
    const nodes = Array.isArray(connection.nodes)
      ? connection.nodes.filter((node): node is Record<string, unknown> =>
          this.isRecord(node)
        )
      : null;
    const pageInfo = this.toObject(connection.pageInfo);

    if (!nodes || typeof pageInfo.hasNextPage !== "boolean") {
      throw badRequest(errorMessage);
    }

    return {
      nodeIds: nodes
        .map((node) => this.toNullableString(node.id))
        .filter((id): id is string => Boolean(id)),
      hasNextPage: pageInfo.hasNextPage,
      endCursor:
        typeof pageInfo.endCursor === "string" && pageInfo.endCursor
          ? pageInfo.endCursor
          : null
    };
  }

  private readProjectV2Connection(
    data: unknown,
    fieldName: "fields" | "items",
    errorMessage: string
  ): {
    nodes: Record<string, unknown>[];
    hasNextPage: boolean;
    endCursor: string | null;
  } {
    const project = this.readProjectV2ConnectionNode(data, errorMessage);
    const connection = this.toObject(project[fieldName]);
    const nodes = Array.isArray(connection.nodes)
      ? connection.nodes.filter((node): node is Record<string, unknown> =>
          this.isRecord(node)
        )
      : null;
    const pageInfo = this.toObject(connection.pageInfo);

    if (!nodes || typeof pageInfo.hasNextPage !== "boolean") {
      throw badRequest(errorMessage);
    }

    return {
      nodes,
      hasNextPage: pageInfo.hasNextPage,
      endCursor:
        typeof pageInfo.endCursor === "string" && pageInfo.endCursor
          ? pageInfo.endCursor
          : null
    };
  }

  private readProjectV2ConnectionNode(
    data: unknown,
    errorMessage: string
  ): Record<string, unknown> {
    const node = this.toObject(this.toObject(data).node);
    if (node.__typename && node.__typename !== "ProjectV2") {
      throw badRequest(errorMessage);
    }

    return node;
  }

  private readProjectV2ItemNode(
    data: unknown,
    errorMessage: string
  ): Record<string, unknown> {
    const node = this.toObject(this.toObject(data).node);
    if (node.__typename && node.__typename !== "ProjectV2Item") {
      throw badRequest(errorMessage);
    }

    return node;
  }

  private mapProjectV2(project: Record<string, unknown>): GithubProjectV2ApiItem {
    const owner = this.toObject(project.owner);
    const ownerLogin = this.readString(owner.login, "GitHub ProjectV2 sync failed");
    const ownerType = owner.__typename === "User" ? "User" : "Organization";

    return {
      id: this.readString(project.id, "GitHub ProjectV2 sync failed"),
      databaseId: this.toNullableNumber(project.databaseId),
      ownerLogin,
      ownerType,
      number: this.readNumber(project.number, "GitHub ProjectV2 sync failed"),
      title: this.readString(project.title, "GitHub ProjectV2 sync failed"),
      shortDescription: this.toNullableString(project.shortDescription),
      readme: this.toNullableString(project.readme),
      url: this.readString(project.url, "GitHub ProjectV2 sync failed"),
      resourcePath: this.toNullableString(project.resourcePath),
      public: this.toBoolean(project.public),
      closed: this.toBoolean(project.closed),
      template: this.toBoolean(project.template),
      createdAt: this.toNullableString(project.createdAt),
      updatedAt: this.toNullableString(project.updatedAt),
      closedAt: this.toNullableString(project.closedAt),
      raw: project
    };
  }

  private mapProjectV2Field(
    field: Record<string, unknown>
  ): GithubProjectV2FieldApiItem {
    const options = Array.isArray(field.options)
      ? field.options
          .filter((option): option is Record<string, unknown> => this.isRecord(option))
          .map((option, index) => this.mapProjectV2FieldOption(option, index))
      : [];

    return {
      id: this.readString(field.id, "GitHub ProjectV2 fields sync failed"),
      name: this.readString(field.name, "GitHub ProjectV2 fields sync failed"),
      dataType: this.readString(
        field.dataType,
        "GitHub ProjectV2 fields sync failed"
      ),
      createdAt: this.toNullableString(field.createdAt),
      updatedAt: this.toNullableString(field.updatedAt),
      options,
      raw: field
    };
  }

  private mapProjectV2FieldOption(
    option: Record<string, unknown>,
    index: number
  ): GithubProjectV2FieldOptionApiItem {
    return {
      id: this.readString(option.id, "GitHub ProjectV2 fields sync failed"),
      name: this.readString(option.name, "GitHub ProjectV2 fields sync failed"),
      color: this.toNullableString(option.color),
      description: this.toNullableString(option.description),
      position: index + 1
    };
  }

  private mapProjectV2Item(
    item: Record<string, unknown>,
    fieldValuesOverride?: GithubProjectV2ItemFieldValueApiItem[]
  ): GithubProjectV2ItemApiItem {
    const content = this.toObject(item.content);
    const fieldValues = fieldValuesOverride ?? this.readProjectV2ItemFieldValues(item);
    const status = this.findProjectV2StatusValue(fieldValues);

    return {
      id: this.readString(item.id, "GitHub ProjectV2 items sync failed"),
      databaseId: this.toNullableNumber(item.databaseId),
      contentType: this.mapProjectV2ItemContentType(content.__typename),
      contentNodeId: this.toNullableString(content.id),
      isArchived: this.toBoolean(item.isArchived),
      statusFieldNodeId: status?.fieldNodeId ?? null,
      statusOptionId: status?.singleSelectOptionId ?? null,
      statusName: status?.singleSelectName ?? null,
      position: null,
      createdAt: this.toNullableString(item.createdAt),
      updatedAt: this.toNullableString(item.updatedAt),
      fieldValues,
      raw: item
    };
  }

  private mapProjectV2ItemReconcile(
    item: Record<string, unknown>,
    fieldValues: GithubProjectV2ItemFieldValueApiItem[]
  ): GithubProjectV2ItemReconcileApiItem {
    const content = this.toObject(item.content);

    return {
      item: this.mapProjectV2Item(item, fieldValues),
      issue:
        content.__typename === "Issue"
          ? this.mapProjectV2ItemIssue(content)
          : null,
      pullRequest:
        content.__typename === "PullRequest"
          ? this.mapProjectV2ItemPullRequest(content)
          : null,
      repositoryNodeId: this.toNullableString(this.toObject(content.repository).id)
    };
  }

  private mapProjectV2ItemIssue(
    content: Record<string, unknown>
  ): GithubIssueApiItem | null {
    const id = this.toNullableNumber(content.databaseId);
    const nodeId = this.toNullableString(content.id);
    const number = this.toNullableNumber(content.number);
    const title = this.toNullableString(content.title);
    const state = this.mapProjectV2ItemIssueState(content.state);
    const htmlUrl = this.toNullableString(content.url);
    if (id === null || !nodeId || number === null || !title || !state || !htmlUrl) {
      return null;
    }

    const author = this.toObject(content.author);
    return {
      id,
      node_id: nodeId,
      number,
      title,
      body: this.toNullableString(content.body),
      state,
      state_reason: this.toNullableString(content.stateReason),
      user: {
        login: this.toNullableString(author.login),
        avatar_url: this.toNullableString(author.avatarUrl)
      },
      html_url: htmlUrl,
      labels: this.readProjectV2ItemSourceNodes(content.labels),
      assignees: this.readProjectV2ItemSourceNodes(content.assignees),
      milestone: this.isRecord(content.milestone) ? content.milestone : null,
      created_at: this.toNullableString(content.createdAt),
      updated_at: this.toNullableString(content.updatedAt),
      closed_at: this.toNullableString(content.closedAt)
    };
  }

  private mapProjectV2ItemPullRequest(
    content: Record<string, unknown>
  ): GithubPullRequestApiItem | null {
    const id = this.toNullableNumber(content.databaseId);
    const nodeId = this.toNullableString(content.id);
    const number = this.toNullableNumber(content.number);
    const title = this.toNullableString(content.title);
    const htmlUrl = this.toNullableString(content.url);
    if (id === null || !nodeId || number === null || !title || !htmlUrl) {
      return null;
    }

    const author = this.toObject(content.author);
    const headRepository = this.toObject(content.headRepository);
    const headRepositoryOwner = this.toObject(headRepository.owner);
    return {
      id,
      node_id: nodeId,
      number,
      title,
      body: this.toNullableString(content.body),
      user: {
        login: this.toNullableString(author.login),
        avatar_url: this.toNullableString(author.avatarUrl)
      },
      head: {
        ref: this.toNullableString(content.headRefName),
        sha: this.toNullableString(content.headRefOid),
        repo: {
          name: this.toNullableString(headRepository.name),
          full_name: this.toNullableString(headRepository.nameWithOwner),
          owner: {
            login: this.toNullableString(headRepositoryOwner.login)
          }
        }
      },
      base: {
        ref: this.toNullableString(content.baseRefName),
        sha: this.toNullableString(content.baseRefOid)
      },
      changed_files: this.toNullableNumber(content.changedFiles) ?? 0,
      additions: this.toNullableNumber(content.additions) ?? 0,
      deletions: this.toNullableNumber(content.deletions) ?? 0,
      commits: this.toNullableNumber(this.toObject(content.commits).totalCount) ?? 0,
      comments: this.toNullableNumber(this.toObject(content.comments).totalCount) ?? 0,
      review_comments:
        this.toNullableNumber(this.toObject(content.reviews).totalCount) ?? 0,
      html_url: htmlUrl,
      created_at: this.toNullableString(content.createdAt),
      updated_at: this.toNullableString(content.updatedAt),
      closed_at: this.toNullableString(content.closedAt),
      merged_at: this.toNullableString(content.mergedAt),
      draft: this.toBoolean(content.isDraft),
      mergeable: this.mapProjectV2ItemPullRequestMergeable(content.mergeable),
      state: this.toNullableString(content.state)?.toLowerCase()
    };
  }

  private readProjectV2ItemSourceNodes(value: unknown): Record<string, unknown>[] {
    const nodes = this.toObject(value).nodes;
    return Array.isArray(nodes)
      ? nodes.filter((node): node is Record<string, unknown> => this.isRecord(node))
      : [];
  }

  private mapProjectV2ItemIssueState(
    value: unknown
  ): GithubIssueApiItem["state"] | null {
    if (value === "OPEN") {
      return "open";
    }

    if (value === "CLOSED") {
      return "closed";
    }

    return null;
  }

  private mapProjectV2ItemPullRequestMergeable(value: unknown): boolean | null {
    if (value === "MERGEABLE") {
      return true;
    }

    if (value === "CONFLICTING") {
      return false;
    }

    return null;
  }

  private readProjectV2ItemFieldValues(
    item: Record<string, unknown>
  ): GithubProjectV2ItemFieldValueApiItem[] {
    return this.readProjectV2ItemFieldValuePage(
      item,
      "GitHub ProjectV2 items sync failed"
    ).nodes;
  }

  private readProjectV2ItemFieldValuePage(
    item: Record<string, unknown>,
    _errorMessage: string
  ): {
    nodes: GithubProjectV2ItemFieldValueApiItem[];
    hasNextPage: boolean;
    endCursor: string | null;
  } {
    const fieldValueConnection = this.toObject(item.fieldValues);
    if (!Array.isArray(fieldValueConnection.nodes)) {
      return {
        nodes: [],
        hasNextPage: false,
        endCursor: null
      };
    }
    const pageInfo = this.toObject(fieldValueConnection.pageInfo);

    return {
      nodes: fieldValueConnection.nodes
        .filter((fieldValue): fieldValue is Record<string, unknown> =>
          this.isRecord(fieldValue)
        )
        .filter((fieldValue) => this.isSupportedProjectV2ItemFieldValue(fieldValue))
        .map((fieldValue) => this.mapProjectV2ItemFieldValue(fieldValue)),
      hasNextPage: pageInfo.hasNextPage === true,
      endCursor:
        typeof pageInfo.endCursor === "string" && pageInfo.endCursor
          ? pageInfo.endCursor
          : null
    };
  }

  private isSupportedProjectV2ItemFieldValue(
    fieldValue: Record<string, unknown>
  ): boolean {
    return (
      typeof fieldValue.__typename === "string" &&
      GITHUB_PROJECT_V2_SUPPORTED_ITEM_FIELD_VALUE_TYPENAMES.has(
        fieldValue.__typename
      )
    );
  }

  private mapProjectV2ItemFieldValue(
    fieldValue: Record<string, unknown>
  ): GithubProjectV2ItemFieldValueApiItem {
    const field = this.toObject(fieldValue.field);
    const fieldName = this.toNullableString(field.name) ?? "Unknown";

    return {
      id: this.toNullableString(fieldValue.id),
      fieldNodeId: this.toNullableString(field.id),
      fieldName,
      fieldDataType: this.toNullableString(field.dataType),
      textValue: this.toNullableString(fieldValue.text),
      numberValue: this.toNullableNumber(fieldValue.number),
      dateValue: this.toNullableString(fieldValue.date),
      singleSelectOptionId: this.toNullableString(fieldValue.optionId),
      singleSelectName: this.toNullableString(fieldValue.name),
      iterationId: this.toNullableString(fieldValue.iterationId),
      iterationTitle: this.toNullableString(fieldValue.title),
      createdAt: this.toNullableString(fieldValue.createdAt),
      updatedAt: this.toNullableString(fieldValue.updatedAt),
      raw: fieldValue
    };
  }

  private findProjectV2StatusValue(
    fieldValues: GithubProjectV2ItemFieldValueApiItem[]
  ): GithubProjectV2ItemFieldValueApiItem | null {
    return (
      fieldValues.find(
        (fieldValue) =>
          fieldValue.singleSelectOptionId &&
          fieldValue.fieldName.toLowerCase() === "status"
      ) ?? null
    );
  }

  private mapProjectV2ItemContentType(
    value: unknown
  ): GithubProjectV2ItemApiItem["contentType"] {
    switch (value) {
      case "Issue":
        return "ISSUE";
      case "PullRequest":
        return "PULL_REQUEST";
      case "DraftIssue":
        return "DRAFT_ISSUE";
      default:
        return "UNKNOWN";
    }
  }

  private async readJson(response: Response, errorMessage: string): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw badRequest(errorMessage);
    }
  }

  private async fetchJsonWithToken(
    url: URL,
    token: string,
    errorMessage: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        },
        ...(signal ? { signal } : {})
      });
    } catch {
      throw badRequest(errorMessage);
    }

    if (!response.ok) {
      throw badRequest(errorMessage);
    }

    return this.readJson(response, errorMessage);
  }

  private createAppJwt(input: GithubAppInstallationLookupRequest): string {
    try {
      const nowSeconds = Math.floor(
        (input.now ? input.now() : new Date()).getTime() / 1000
      );
      const header = this.encodeJson({
        alg: "RS256",
        typ: "JWT"
      });
      const payload = this.encodeJson({
        iat: nowSeconds - 60,
        exp: nowSeconds + 540,
        iss: input.appId
      });
      const body = `${header}.${payload}`;
      const signature = createSign("RSA-SHA256")
        .update(body)
        .end()
        .sign(input.privateKey, "base64url");

      return `${body}.${signature}`;
    } catch {
      throw badRequest("GitHub App is not configured");
    }
  }

  private encodeJson(value: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  }

  private isInstallationPayload(value: unknown): value is GithubInstallationApiPayload & {
    account: { login: string; type: "User" | "Organization" };
  } {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const payload = value as GithubInstallationApiPayload;
    return (
      typeof payload.id === "number" &&
      typeof payload.account?.login === "string" &&
      payload.account.login.length > 0 &&
      (payload.account.type === "User" || payload.account.type === "Organization")
    );
  }

  private isInstallationTokenPayload(
    value: unknown
  ): value is GithubInstallationTokenApiPayload & { token: string } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubInstallationTokenApiPayload;
    return typeof payload.token === "string" && payload.token.length > 0;
  }

  private isInstallationRepositoriesPayload(
    value: unknown
  ): value is { repositories: GithubInstallationRepositoryApiItem[] } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubInstallationRepositoriesApiPayload;
    return (
      Array.isArray(payload.repositories) &&
      payload.repositories.every((item) => this.isRepositoryPayload(item))
    );
  }

  private isRepositoryPayload(
    value: unknown
  ): value is GithubInstallationRepositoryApiItem {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubInstallationRepositoryApiItem;
    return (
      typeof payload.id === "number" &&
      typeof payload.node_id === "string" &&
      payload.node_id.length > 0 &&
      typeof payload.owner?.login === "string" &&
      payload.owner.login.length > 0 &&
      typeof payload.name === "string" &&
      payload.name.length > 0 &&
      typeof payload.full_name === "string" &&
      payload.full_name.length > 0 &&
      typeof payload.private === "boolean" &&
      typeof payload.archived === "boolean" &&
      typeof payload.html_url === "string" &&
      payload.html_url.length > 0 &&
      this.isOptionalString(payload.default_branch) &&
      this.isOptionalString(payload.created_at) &&
      this.isOptionalString(payload.updated_at) &&
      this.isOptionalString(payload.pushed_at)
    );
  }

  private isIssuePayload(value: unknown): value is GithubIssueApiItem {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubIssueApiItem;
    return (
      typeof payload.id === "number" &&
      typeof payload.node_id === "string" &&
      payload.node_id.length > 0 &&
      typeof payload.number === "number" &&
      typeof payload.title === "string" &&
      payload.title.length > 0 &&
      (payload.state === "open" || payload.state === "closed") &&
      typeof payload.html_url === "string" &&
      payload.html_url.length > 0 &&
      this.isOptionalString(payload.body) &&
      this.isOptionalString(payload.state_reason) &&
      this.isOptionalUserPayload(payload.user) &&
      (payload.labels === undefined || Array.isArray(payload.labels)) &&
      (payload.assignees === undefined || Array.isArray(payload.assignees)) &&
      this.isOptionalObject(payload.milestone) &&
      this.isOptionalString(payload.created_at) &&
      this.isOptionalString(payload.updated_at) &&
      this.isOptionalString(payload.closed_at)
    );
  }

  private isIssueAssigneePayload(
    value: unknown
  ): value is GithubIssueAssigneeApiItem {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubIssueAssigneeApiItem;
    return (
      typeof payload.login === "string" &&
      payload.login.length > 0 &&
      this.isOptionalString(payload.avatar_url)
    );
  }

  private isPullRequestPayload(value: unknown): value is GithubPullRequestApiItem {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubPullRequestApiItem;
    return (
      typeof payload.id === "number" &&
      typeof payload.node_id === "string" &&
      payload.node_id.length > 0 &&
      typeof payload.number === "number" &&
      typeof payload.title === "string" &&
      payload.title.length > 0 &&
      typeof payload.html_url === "string" &&
      payload.html_url.length > 0 &&
      this.isOptionalString(payload.body) &&
      this.isOptionalUserPayload(payload.user) &&
      this.isOptionalRefPayload(payload.head) &&
      this.isOptionalRefPayload(payload.base) &&
      this.isOptionalNumber(payload.changed_files) &&
      this.isOptionalNumber(payload.additions) &&
      this.isOptionalNumber(payload.deletions) &&
      this.isOptionalNumber(payload.commits) &&
      this.isOptionalNumber(payload.comments) &&
      this.isOptionalNumber(payload.review_comments) &&
      this.isOptionalString(payload.created_at) &&
      this.isOptionalString(payload.updated_at) &&
      this.isOptionalString(payload.closed_at) &&
      this.isOptionalString(payload.merged_at) &&
      this.isOptionalBoolean(payload.draft) &&
      this.isOptionalBoolean(payload.mergeable, true) &&
      this.isOptionalString(payload.state)
    );
  }

  private isFilePayload(value: unknown): value is GithubPullRequestFileApiItem {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const payload = value as GithubPullRequestFileApiItem;
    return (
      typeof payload.filename === "string" &&
      payload.filename.length > 0 &&
      typeof payload.status === "string" &&
      typeof payload.additions === "number" &&
      typeof payload.deletions === "number" &&
      typeof payload.changes === "number" &&
      this.isOptionalString(payload.previous_filename) &&
      this.isOptionalString(payload.blob_url) &&
      this.isOptionalString(payload.raw_url) &&
      this.isOptionalString(payload.contents_url) &&
      this.isOptionalString(payload.sha) &&
      this.isOptionalString(payload.patch)
    );
  }

  private isOptionalString(value: unknown): boolean {
    return value === undefined || value === null || typeof value === "string";
  }

  private isOptionalNumber(value: unknown): boolean {
    return value === undefined || typeof value === "number";
  }

  private isOptionalBoolean(value: unknown, allowNull = false): boolean {
    return (
      value === undefined ||
      typeof value === "boolean" ||
      (allowNull && value === null)
    );
  }

  private isOptionalObject(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      (typeof value === "object" && !Array.isArray(value))
    );
  }

  private isOptionalUserPayload(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const payload = value as { login?: unknown; avatar_url?: unknown };
    return (
      this.isOptionalString(payload.login) &&
      this.isOptionalString(payload.avatar_url)
    );
  }

  private isOptionalRefPayload(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const payload = value as { ref?: unknown; sha?: unknown };
    return this.isOptionalString(payload.ref) && this.isOptionalString(payload.sha);
  }

  private isPullRequestIssue(value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as { pull_request?: unknown }).pull_request === "object" &&
      (value as { pull_request?: unknown }).pull_request !== null
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private readString(value: unknown, errorMessage: string): string {
    if (typeof value !== "string" || !value) {
      throw badRequest(errorMessage);
    }

    return value;
  }

  private readNumber(value: unknown, errorMessage: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      throw badRequest(errorMessage);
    }

    return value;
  }

  private toNullableString(value: unknown): string | null {
    return typeof value === "string" && value ? value : null;
  }

  private toNullableNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  }

  private toBoolean(value: unknown): boolean {
    return typeof value === "boolean" ? value : false;
  }

  private uniqueStrings(values: string[]): string[] {
    return [...new Set(values)];
  }

  private toObject(value: unknown): Record<string, unknown> {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }
}
