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
import { GithubOAuthConnectionService } from "./github-oauth-connection.service";
import { GithubIssueAssigneeValidationError } from "./github-issue-assignee.error";

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

export interface UpdateGithubIssueAssigneesDeltaInput {
  currentUserId: string;
  owner: string;
  repo: string;
  issueNumber: number;
  add: string[];
  remove: string[];
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
    private readonly configService: GithubIntegrationConfigService,
    private readonly connectionService: GithubOAuthConnectionService = new GithubOAuthConnectionService(database, tokenEncryptionService, configService)
  ) {}

  async updateIssue(input: UpdateGithubIssueInput): Promise<UpdateGithubIssueResult> {
    const connection = await this.connectionService.getActiveConnection(input.currentUserId, "app_user");
    const accessToken = connection.accessToken;

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

  async updateIssueAssigneesDelta(
    input: UpdateGithubIssueAssigneesDeltaInput
  ): Promise<UpdateGithubIssueResult> {
    if (input.add.length === 0 && input.remove.length === 0) {
      throw badRequest("At least one assignee addition or removal is required");
    }

    const connection = await this.connectionService.getActiveConnection(
      input.currentUserId,
      "app_user"
    );
    const accessToken = connection.accessToken;

    if (input.add.length > 0) {
      const assignableUsers = await this.githubAppClient.listRepositoryAssignees({
        owner: input.owner,
        repo: input.repo,
        userAccessToken: accessToken
      });
      const assignableLogins = new Set(
        assignableUsers.map((assignee) => assignee.login.toLowerCase())
      );
      if (input.add.some((login) => !assignableLogins.has(login.toLowerCase()))) {
        throw new GithubIssueAssigneeValidationError();
      }
    }

    let issue: GithubIssueApiItem;
    if (input.remove.length > 0) {
      issue = await this.githubAppClient.removeRepositoryIssueAssignees({
        assignees: input.remove,
        issueNumber: input.issueNumber,
        owner: input.owner,
        repo: input.repo,
        userAccessToken: accessToken
      });
    }
    if (input.add.length > 0) {
      issue = await this.githubAppClient.addRepositoryIssueAssignees({
        assignees: input.add,
        issueNumber: input.issueNumber,
        owner: input.owner,
        repo: input.repo,
        userAccessToken: accessToken
      });
    }

    return {
      assigneesApplied: this.isAssigneeDeltaApplied(
        input.add,
        input.remove,
        issue!.assignees
      ),
      issue: issue!
    };
  }

  async listAssignableUsers(
    input: ListGithubIssueAssigneesInput
  ): Promise<GithubIssueAssigneeApiItem[]> {
    const connection = await this.connectionService.getActiveConnection(input.currentUserId, "app_user");
    const accessToken = connection.accessToken;

    return this.githubAppClient.listRepositoryAssignees({
      owner: input.owner,
      repo: input.repo,
      userAccessToken: accessToken
    });
  }

  async createIssue(input: CreateGithubIssueInput): Promise<GithubIssueApiItem> {
    const connection = await this.connectionService.getActiveConnection(input.currentUserId, "app_user");
    const accessToken = connection.accessToken;

    return this.githubAppClient.createRepositoryIssue({
      body: input.body,
      owner: input.owner,
      repo: input.repo,
      title: input.title,
      userAccessToken: accessToken
    });
  }

  private isAssigneeDeltaApplied(
    added: string[],
    removed: string[],
    actual: unknown[] | undefined
  ): boolean {
    if (!Array.isArray(actual)) {
      return false;
    }

    const actualLogins = new Set(
      actual
        .map((assignee) => {
          if (!assignee || typeof assignee !== "object" || Array.isArray(assignee)) {
            return null;
          }
          const login = (assignee as { login?: unknown }).login;
          return typeof login === "string" ? login.toLowerCase() : null;
        })
        .filter((login): login is string => login !== null)
    );

    return (
      added.every((login) => actualLogins.has(login.toLowerCase())) &&
      removed.every((login) => !actualLogins.has(login.toLowerCase()))
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
