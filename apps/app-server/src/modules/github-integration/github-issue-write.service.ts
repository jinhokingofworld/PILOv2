import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import {
  GithubAppClient,
  type GithubIssueAssigneeApiItem,
  type GithubIssueApiItem
} from "./github-app.client";
import {
  GithubIntegrationConfigService,
  type GithubOAuthRuntimeConfig
} from "./github-integration-config.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import { GithubIssueAssigneeValidationError } from "./github-issue-assignee.error";

interface GithubOAuthConnectionRow extends QueryResultRow {
  github_login: string | null;
  github_access_token_encrypted: string | null;
  github_connected_at: Date | string | null;
  github_revoked_at: Date | string | null;
}

export interface UpdateGithubIssueInput {
  currentUserId: string;
  owner: string;
  repo: string;
  issueNumber: number;
  assignees?: string[];
  title?: string;
  body?: string;
  state?: "open" | "closed";
}

export interface UpdateGithubIssueResult {
  issue: GithubIssueApiItem;
  assigneesApplied: boolean;
}

export interface ListGithubIssueAssigneesInput {
  currentUserId: string;
  owner: string;
  repo: string;
}

export interface CreateGithubIssueInput {
  currentUserId: string;
  owner: string;
  repo: string;
  title: string;
  body?: string;
}

@Injectable()
export class GithubIssueWriteService {
  constructor(
    private readonly database: DatabaseService,
    private readonly githubAppClient: GithubAppClient,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService
  ) {}

  async updateIssue(input: UpdateGithubIssueInput): Promise<UpdateGithubIssueResult> {
    const oauthConfig = this.configService.getGithubOAuthConfig();
    const connection = await this.getGithubOAuthConnectionRow(input.currentUserId);
    const accessToken = this.getConnectedGithubOAuthAccess(connection, oauthConfig);

    if (input.assignees !== undefined) {
      const assignableUsers = await this.githubAppClient.listRepositoryAssignees({
        owner: input.owner,
        repo: input.repo,
        userAccessToken: accessToken
      });
      const assignableLogins = new Set(
        assignableUsers.map((assignee) => assignee.login.toLowerCase())
      );
      if (
        input.assignees.some((login) => !assignableLogins.has(login.toLowerCase()))
      ) {
        throw new GithubIssueAssigneeValidationError();
      }
    }

    const issue = await this.githubAppClient.updateRepositoryIssue({
      assignees: input.assignees,
      body: input.body,
      issueNumber: input.issueNumber,
      owner: input.owner,
      repo: input.repo,
      state: input.state,
      title: input.title,
      userAccessToken: accessToken
    });

    return {
      assigneesApplied:
        input.assignees === undefined ||
        this.haveSameAssignees(input.assignees, issue.assignees),
      issue
    };
  }

  async listAssignableUsers(
    input: ListGithubIssueAssigneesInput
  ): Promise<GithubIssueAssigneeApiItem[]> {
    const oauthConfig = this.configService.getGithubOAuthConfig();
    const connection = await this.getGithubOAuthConnectionRow(input.currentUserId);
    const accessToken = this.getConnectedGithubOAuthAccess(connection, oauthConfig);

    return this.githubAppClient.listRepositoryAssignees({
      owner: input.owner,
      repo: input.repo,
      userAccessToken: accessToken
    });
  }

  async createIssue(input: CreateGithubIssueInput): Promise<GithubIssueApiItem> {
    const oauthConfig = this.configService.getGithubOAuthConfig();
    const connection = await this.getGithubOAuthConnectionRow(input.currentUserId);
    const accessToken = this.getConnectedGithubOAuthAccess(connection, oauthConfig);

    return this.githubAppClient.createRepositoryIssue({
      body: input.body,
      owner: input.owner,
      repo: input.repo,
      title: input.title,
      userAccessToken: accessToken
    });
  }

  private async getGithubOAuthConnectionRow(
    currentUserId: string
  ): Promise<GithubOAuthConnectionRow> {
    const row = await this.database.queryOne<GithubOAuthConnectionRow>(
      `
        SELECT
          github_login,
          github_access_token_encrypted,
          github_connected_at,
          github_revoked_at
        FROM users
        WHERE id = $1
      `,
      [currentUserId]
    );

    if (!row) {
      throw unauthorized("Current user not found");
    }

    return row;
  }

  private getConnectedGithubOAuthAccess(
    row: GithubOAuthConnectionRow,
    config: GithubOAuthRuntimeConfig
  ): string {
    if (!this.isActiveGithubOAuthConnection(row)) {
      throw badRequest("GitHub OAuth connection is required");
    }

    return this.tokenEncryptionService.decryptToken(
      row.github_access_token_encrypted,
      config
    );
  }

  private isActiveGithubOAuthConnection(
    row: GithubOAuthConnectionRow
  ): row is GithubOAuthConnectionRow & {
    github_access_token_encrypted: string;
  } {
    return Boolean(
      row.github_login &&
        row.github_access_token_encrypted &&
        row.github_connected_at &&
        !row.github_revoked_at
    );
  }

  private haveSameAssignees(
    expected: string[],
    actual: unknown[] | undefined
  ): boolean {
    if (!Array.isArray(actual)) {
      return false;
    }

    const expectedLogins = expected.map((login) => login.toLowerCase()).sort();
    const actualLogins = actual
      .map((assignee) => {
        if (!assignee || typeof assignee !== "object" || Array.isArray(assignee)) {
          return null;
        }

        const login = (assignee as { login?: unknown }).login;
        return typeof login === "string" ? login.toLowerCase() : null;
      })
      .filter((login): login is string => login !== null)
      .sort();

    return (
      expectedLogins.length === actualLogins.length &&
      expectedLogins.every((login, index) => login === actualLogins[index])
    );
  }
}
