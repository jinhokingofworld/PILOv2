import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { GithubAppClient } = require("../../dist/modules/github-integration/github-app.client.js");

const fixedNow = new Date("2026-07-04T12:00:00.000Z");

function createPrivateKeyPem() {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });

  return privateKey.export({
    type: "pkcs8",
    format: "pem"
  });
}

function projectNode(overrides = {}) {
  return {
    id: "PVT_kwDOExample",
    databaseId: 42,
    owner: {
      __typename: "Organization",
      login: "my-team"
    },
    number: 1,
    title: "PILO MVP",
    shortDescription: "MVP project board",
    readme: "Project readme",
    url: "https://github.com/orgs/my-team/projects/1",
    resourcePath: "/orgs/my-team/projects/1",
    public: false,
    closed: false,
    template: false,
    createdAt: "2026-06-20T03:00:00.000Z",
    updatedAt: "2026-07-01T14:30:00.000Z",
    closedAt: null,
    repositories: {
      nodes: [{ id: "R_kgDOExample" }],
      pageInfo: {
        hasNextPage: true,
        endCursor: "repo-cursor-1"
      }
    },
    ...overrides
  };
}

function githubIssuePayload(overrides = {}) {
  return {
    id: 9999,
    node_id: "I_kwDOExample",
    number: 609,
    title: "Board issue 담당자 변경",
    body: "본문",
    state: "open",
    html_url: "https://github.com/Developer-EJ/PILO/issues/609",
    labels: [],
    assignees: [],
    milestone: null,
    ...overrides
  };
}

{
  const originalFetch = globalThis.fetch;
  const privateKeyPem = createPrivateKeyPem();
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = url.toString();
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({
      url: requestUrl,
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body
    });

    if (requestUrl.endsWith("/app/installations/12345678/access_tokens")) {
      return {
        ok: true,
        async json() {
          return {
            token: "installation-token",
            expires_at: "2026-07-04T13:00:00.000Z"
          };
        }
      };
    }

    assert.equal(requestUrl, "https://api.github.com/graphql");
    assert.equal(options.headers?.Authorization, "Bearer installation-token");

    if (body.variables.projectId === "PVT_kwDOExample") {
      return {
        ok: true,
        async json() {
          return {
            data: {
              node: {
                __typename: "ProjectV2",
                id: "PVT_kwDOExample",
                repositories: {
                  nodes: [{ id: "R_kgDOSecond" }, { id: "R_kgDOExample" }],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null
                  }
                }
              }
            }
          };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          data: {
            organization: {
              projectsV2: {
                nodes: [projectNode()],
                pageInfo: {
                  hasNextPage: false,
                  endCursor: null
                }
              }
            }
          }
        };
      }
    };
  };

  try {
    const projects = await new GithubAppClient().listProjectV2s({
      installationId: 12345678,
      appId: "12345",
      privateKey: privateKeyPem,
      accountLogin: "my-team",
      accountType: "Organization",
      now: () => fixedNow
    });

    assert.equal(requests.length, 3);
    assert.equal(requests[0].method, "POST");
    assert.match(requests[0].headers.Authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
    assert.match(requests[1].body.query, /organization\(login: \$login\)/);
    assert.deepEqual(requests[1].body.variables, {
      login: "my-team",
      cursor: null
    });
    assert.match(requests[2].body.query, /node\(id: \$projectId\)/);
    assert.deepEqual(requests[2].body.variables, {
      projectId: "PVT_kwDOExample",
      cursor: "repo-cursor-1"
    });
    assert.deepEqual(projects, [
      {
        id: "PVT_kwDOExample",
        databaseId: 42,
        ownerLogin: "my-team",
        ownerType: "Organization",
        number: 1,
        title: "PILO MVP",
        shortDescription: "MVP project board",
        readme: "Project readme",
        url: "https://github.com/orgs/my-team/projects/1",
        resourcePath: "/orgs/my-team/projects/1",
        public: false,
        closed: false,
        template: false,
        createdAt: "2026-06-20T03:00:00.000Z",
        updatedAt: "2026-07-01T14:30:00.000Z",
        closedAt: null,
        raw: projectNode(),
        repositoryNodeIds: ["R_kgDOExample", "R_kgDOSecond"]
      }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const requests = [];
  const timeoutHandle = Symbol("assignee lookup timeout");
  let timeoutCallback;
  let clearedTimeoutHandle;

  globalThis.setTimeout = (callback, delay) => {
    timeoutCallback = callback;
    assert.equal(delay, 30_000);
    return timeoutHandle;
  };
  globalThis.clearTimeout = (handle) => {
    clearedTimeoutHandle = handle;
  };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: url.toString(), options });
    return {
      ok: true,
      status: 200,
      async json() {
        if (requests.length === 1) {
          return Array.from({ length: 100 }, (_value, index) => ({
            login: `user-${index}`,
            avatar_url: `https://avatar.test/user-${index}`
          }));
        }

        return [{ login: "last-user", avatar_url: null }];
      }
    };
  };

  try {
    const assignees = await new GithubAppClient().listRepositoryAssignees({
      owner: "Developer-EJ",
      repo: "PILO",
      userAccessToken: "user-oauth-token"
    });

    assert.equal(assignees.length, 101);
    assert.equal(assignees.at(-1)?.login, "last-user");
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0].url,
      "https://api.github.com/repos/Developer-EJ/PILO/assignees?page=1&per_page=100"
    );
    assert.equal(
      requests[1].url,
      "https://api.github.com/repos/Developer-EJ/PILO/assignees?page=2&per_page=100"
    );
    assert.equal(
      requests[0].options.headers.Authorization,
      "Bearer user-oauth-token"
    );
    assert.ok(requests[0].options.signal instanceof AbortSignal);
    assert.equal(requests[0].options.signal, requests[1].options.signal);
    assert.equal(requests[0].options.signal.aborted, false);
    assert.equal(typeof timeoutCallback, "function");
    assert.equal(clearedTimeoutHandle, timeoutHandle);
    timeoutCallback();
    assert.equal(requests[0].options.signal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return [{ login: "alice", avatar_url: 42 }];
    }
  });

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().listRepositoryAssignees({
          owner: "Developer-EJ",
          repo: "PILO",
          userAccessToken: "user-oauth-token"
        }),
      (error) => {
        assert.equal(error?.getStatus?.(), 400);
        assert.equal(
          error?.response?.error?.message,
          "GitHub issue assignee lookup failed"
        );
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timeoutHandle = Symbol("ProjectV2 status update timeout");
  let timeoutCallback;
  let clearedTimeoutHandle;
  let requestSignal;

  globalThis.setTimeout = (callback, delay) => {
    timeoutCallback = callback;
    assert.equal(delay, 30_000);
    return timeoutHandle;
  };
  globalThis.clearTimeout = (handle) => {
    clearedTimeoutHandle = handle;
  };
  globalThis.fetch = async (_url, options = {}) => {
    requestSignal = options.signal;
    timeoutCallback();
    assert.equal(requestSignal.aborted, true);
    throw new DOMException("The operation was aborted", "AbortError");
  };

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().updateProjectV2ItemStatus({
          fieldNodeId: "PVTSSF_lADOExample",
          itemNodeId: "PVTI_lADOExample",
          projectNodeId: "PVT_kwDOExample",
          singleSelectOptionId: "option-todo",
          userAccessToken: "user-oauth-token"
        }),
      (error) => {
        assert.equal(error?.getStatus?.(), 400);
        assert.equal(
          error?.response?.error?.message,
          "GitHub ProjectV2 status update failed"
        );
        return true;
      }
    );
    assert.ok(requestSignal instanceof AbortSignal);
    assert.equal(clearedTimeoutHandle, timeoutHandle);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

{
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return githubIssuePayload({
          assignees: [{ login: "alice", avatar_url: "https://avatar.test/alice" }]
        });
      }
    };
  };

  try {
    const issue = await new GithubAppClient().updateRepositoryIssue({
      assignees: ["alice"],
      issueNumber: 609,
      owner: "Developer-EJ",
      repo: "PILO",
      userAccessToken: "user-oauth-token"
    });

    assert.deepEqual(requestBody.assignees, ["alice"]);
    assert.deepEqual(issue.assignees, [
      { login: "alice", avatar_url: "https://avatar.test/alice" }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const rawProviderMessage = "provider permission details should not leak";
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    async json() {
      return { message: rawProviderMessage };
    }
  });

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().createRepositoryIssue({
          owner: "Developer-EJ",
          repo: "PILO",
          title: "Permission test issue",
          userAccessToken: "user-oauth-token"
        }),
      (error) => {
        assert.equal(error?.getStatus?.(), 403);
        assert.equal(error?.response?.error?.code, "FORBIDDEN");
        assert.equal(
          error?.response?.error?.message,
          "GitHub Issue write permission is required"
        );
        assert.doesNotMatch(JSON.stringify(error?.response), /provider permission/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    async json() {
      return { message: "provider permission details should not leak" };
    }
  });

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().updateRepositoryIssue({
          issueNumber: 544,
          owner: "Developer-EJ",
          repo: "PILO",
          title: "Updated title",
          userAccessToken: "user-oauth-token"
        }),
      (error) => {
        assert.equal(error?.getStatus?.(), 403);
        assert.equal(error?.response?.error?.code, "FORBIDDEN");
        assert.equal(
          error?.response?.error?.message,
          "GitHub Issue write permission is required"
        );
        assert.doesNotMatch(JSON.stringify(error?.response), /provider permission/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    async json() {
      return { message: "provider permission details should not leak" };
    }
  });

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().updateProjectV2ItemStatus({
          fieldNodeId: "PVTSSF_lADOExample",
          itemNodeId: "PVTI_lADOExample",
          projectNodeId: "PVT_kwDOExample",
          singleSelectOptionId: "option-todo",
          userAccessToken: "user-oauth-token"
        }),
      (error) => {
        assert.equal(error?.getStatus?.(), 403);
        assert.equal(error?.response?.error?.code, "FORBIDDEN");
        assert.equal(
          error?.response?.error?.message,
          "GitHub ProjectV2 write permission is required"
        );
        assert.doesNotMatch(JSON.stringify(error?.response), /provider permission/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        errors: [{ message: "Resource not accessible by integration" }]
      };
    }
  });

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().addProjectV2ItemByContentId({
          contentNodeId: "I_kwDOExample",
          projectNodeId: "PVT_kwDOExample",
          userAccessToken: "user-oauth-token"
        }),
      (error) => {
        assert.equal(error?.getStatus?.(), 403);
        assert.equal(error?.response?.error?.code, "FORBIDDEN");
        assert.equal(
          error?.response?.error?.message,
          "GitHub ProjectV2 write permission is required"
        );
        assert.doesNotMatch(
          JSON.stringify(error?.response),
          /Resource not accessible/
        );
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const privateKeyPem = createPrivateKeyPem();
  let graphqlRequestCount = 0;

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = url.toString();

    if (requestUrl.endsWith("/app/installations/12345678/access_tokens")) {
      return {
        ok: true,
        async json() {
          return {
            token: "installation-token",
            expires_at: "2026-07-04T13:00:00.000Z"
          };
        }
      };
    }

    assert.equal(requestUrl, "https://api.github.com/graphql");
    assert.equal(options.headers?.Authorization, "Bearer installation-token");
    graphqlRequestCount += 1;
    return {
      ok: true,
      async json() {
        return {
          errors: [
            {
              message: "Resource not accessible by integration"
            }
          ]
        };
      }
    };
  };

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().listProjectV2s({
          installationId: 12345678,
          appId: "12345",
          privateKey: privateKeyPem,
          accountLogin: "my-team",
          accountType: "Organization",
          now: () => fixedNow
        }),
      (error) =>
        error?.response?.error?.message ===
        "GitHub App installation token cannot access organization ProjectV2"
    );
    assert.equal(graphqlRequestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    assert.equal(url.toString(), "https://api.github.com/graphql");
    assert.equal(options.headers?.Authorization, "Bearer user-oauth-token");
    const body = JSON.parse(options.body);
    requests.push(body);

    if (body.query.includes("query PiloProjectV2Items(")) {
      assert.deepEqual(body.variables, {
        projectId: "PVT_kwDOExample",
        cursor: null
      });

      return {
        ok: true,
        async json() {
          return {
            data: {
              node: {
                __typename: "ProjectV2",
                items: {
                  nodes: [
                    {
                      id: "PVTI_lADOExample",
                      databaseId: 9001,
                      type: "ISSUE",
                      isArchived: false,
                      createdAt: "2026-07-05T09:00:00.000Z",
                      updatedAt: "2026-07-05T09:00:00.000Z",
                      content: {
                        __typename: "Issue",
                        id: "I_kwDOExample",
                        number: 24,
                        title: "Sync item",
                        state: "OPEN",
                        url: "https://github.com/org/repo/issues/24"
                      },
                      fieldValues: {
                        nodes: [
                          {
                            __typename: "ProjectV2ItemFieldTextValue",
                            id: "PVTFV_text",
                            text: "first page",
                            createdAt: "2026-07-05T09:00:00.000Z",
                            updatedAt: "2026-07-05T09:00:00.000Z",
                            field: {
                              id: "PVTF_text",
                              name: "Notes",
                              dataType: "TEXT"
                            }
                          },
                          {
                            __typename: "ProjectV2ItemFieldRepositoryValue"
                          }
                        ],
                        pageInfo: {
                          hasNextPage: true,
                          endCursor: "field-value-cursor-1"
                        }
                      }
                    }
                  ],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null
                  }
                }
              }
            }
          };
        }
      };
    }

    if (body.query.includes("query PiloProjectV2ItemFieldValues(")) {
      assert.deepEqual(body.variables, {
        itemId: "PVTI_lADOExample",
        cursor: "field-value-cursor-1"
      });

      return {
        ok: true,
        async json() {
          return {
            data: {
              node: {
                __typename: "ProjectV2Item",
                fieldValues: {
                  nodes: [
                    {
                      __typename: "ProjectV2ItemFieldSingleSelectValue",
                      id: "PVTFV_status",
                      name: "In Progress",
                      optionId: "status-in-progress",
                      createdAt: "2026-07-05T09:00:00.000Z",
                      updatedAt: "2026-07-05T09:00:00.000Z",
                      field: {
                        id: "PVTSSF_status",
                        name: "Status",
                        dataType: "SINGLE_SELECT"
                      }
                    }
                  ],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null
                  }
                }
              }
            }
          };
        }
      };
    }

    throw new Error("Unexpected GraphQL query");
  };

  try {
    const items = await new GithubAppClient().listProjectV2Items({
      installationId: 12345678,
      appId: "12345",
      privateKey: "unused",
      projectNodeId: "PVT_kwDOExample",
      userAccessToken: "user-oauth-token",
      now: () => fixedNow
    });

    assert.equal(requests.length, 2);
    assert.equal(items[0].statusOptionId, "status-in-progress");
    assert.equal(items[0].statusName, "In Progress");
    assert.equal(items[0].fieldValues.length, 2);
    assert.deepEqual(
      items[0].fieldValues.map((fieldValue) => fieldValue.fieldName),
      ["Notes", "Status"]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem"
  });
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestOptions = {};
  globalThis.fetch = async (url, options = {}) => {
    requestUrl = url.toString();
    requestOptions = options;
    return {
      ok: true,
      status: 202,
      async json() {
        throw new Error("GitHub delete installation should not require JSON");
      }
    };
  };

  try {
    const result = await new GithubAppClient().deleteInstallation({
      installationId: 12345678,
      appId: "12345",
      privateKey: privateKeyPem,
      now: () => fixedNow
    });

    assert.equal(
      requestUrl,
      "https://api.github.com/app/installations/12345678"
    );
    assert.equal(requestOptions.method, "DELETE");
    assert.match(requestOptions.headers.Authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
    assert.equal(requestOptions.headers["X-GitHub-Api-Version"], "2026-03-10");
    assert.deepEqual(result, {
      deleted: true,
      alreadyDeleted: false
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem"
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404
  });

  try {
    const result = await new GithubAppClient().deleteInstallation({
      installationId: 12345678,
      appId: "12345",
      privateKey: privateKeyPem,
      now: () => fixedNow
    });

    assert.deepEqual(result, {
      deleted: true,
      alreadyDeleted: true
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem"
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 403
  });

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().deleteInstallation({
          installationId: 12345678,
          appId: "12345",
          privateKey: privateKeyPem,
          now: () => fixedNow
        }),
      (error) =>
        error?.response?.error?.message ===
        "GitHub App installation uninstall failed"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const privateKeyPem = createPrivateKeyPem();
  let fetchCalled = false;

  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("installation token fallback should not be attempted");
  };

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().listProjectV2s({
          installationId: 12345678,
          appId: "12345",
          privateKey: privateKeyPem,
          accountLogin: "Developer-EJ",
          accountType: "User",
          now: () => fixedNow
        }),
      (error) =>
        error?.response?.error?.message ===
        "GitHub App installation token cannot access personal ProjectV2"
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const privateKeyPem = createPrivateKeyPem();
  const requests = [];
  const userProject = projectNode({
    owner: {
      __typename: "User",
      login: "Developer-EJ"
    },
    title: "PILO_Project",
    url: "https://github.com/users/Developer-EJ/projects/34",
    resourcePath: "/users/Developer-EJ/projects/34",
    repositories: {
      nodes: [{ id: "R_kgDOExample" }],
      pageInfo: {
        hasNextPage: false,
        endCursor: null
      }
    }
  });

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = url.toString();
    assert.doesNotMatch(requestUrl, /access_tokens/);
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({
      url: requestUrl,
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body
    });

    assert.equal(requestUrl, "https://api.github.com/graphql");
    assert.equal(options.headers?.Authorization, "Bearer user-oauth-token");

    if (body.query.includes("user(login: $login)")) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              user: {
                projectsV2: {
                  nodes: [userProject],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null
                  }
                }
              }
            }
          };
        }
      };
    }

    if (body.query.includes("query PiloProjectV2(")) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              node: userProject
            }
          };
        }
      };
    }

    if (body.query.includes("query PiloProjectV2Fields(")) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              node: {
                __typename: "ProjectV2",
                fields: {
                  nodes: [],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null
                  }
                }
              }
            }
          };
        }
      };
    }

    if (body.query.includes("query PiloProjectV2Items(")) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              node: {
                __typename: "ProjectV2",
                items: {
                  nodes: [],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null
                  }
                }
              }
            }
          };
        }
      };
    }

    throw new Error("Unexpected GraphQL query");
  };

  try {
    const client = new GithubAppClient();
    const baseInput = {
      installationId: 12345678,
      appId: "12345",
      privateKey: privateKeyPem,
      userAccessToken: "user-oauth-token",
      now: () => fixedNow
    };

    const projects = await client.listProjectV2s({
      ...baseInput,
      accountLogin: "Developer-EJ",
      accountType: "User"
    });
    const project = await client.getProjectV2({
      ...baseInput,
      projectNodeId: "PVT_kwDOExample"
    });
    const fields = await client.listProjectV2Fields({
      ...baseInput,
      projectNodeId: "PVT_kwDOExample"
    });
    const items = await client.listProjectV2Items({
      ...baseInput,
      projectNodeId: "PVT_kwDOExample"
    });

    assert.equal(requests.length, 4);
    assert.equal(projects[0].ownerType, "User");
    assert.equal(projects[0].title, "PILO_Project");
    assert.equal(project.ownerLogin, "Developer-EJ");
    assert.deepEqual(fields, []);
    assert.deepEqual(items, []);
    assert.ok(
      requests.every(
        (request) => request.headers.Authorization === "Bearer user-oauth-token"
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const privateKeyPem = createPrivateKeyPem();
  let graphqlRequestCount = 0;

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = url.toString();
    assert.doesNotMatch(requestUrl, /access_tokens/);
    assert.equal(requestUrl, "https://api.github.com/graphql");
    assert.equal(options.headers?.Authorization, "Bearer user-oauth-token");
    graphqlRequestCount += 1;

    return {
      ok: true,
      async json() {
        return {
          errors: [
            {
              message: "Resource not accessible by integration"
            }
          ]
        };
      }
    };
  };

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().listProjectV2s({
          installationId: 12345678,
          appId: "12345",
          privateKey: privateKeyPem,
          accountLogin: "Developer-EJ",
          accountType: "User",
          userAccessToken: "user-oauth-token",
          now: () => fixedNow
        }),
      (error) =>
        error?.response?.error?.message ===
        "GitHub ProjectV2 OAuth token lacks permission to read personal ProjectV2"
    );
    assert.equal(graphqlRequestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const privateKeyPem = createPrivateKeyPem();

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = url.toString();
    assert.equal(requestUrl, "https://api.github.com/graphql");
    assert.equal(options.headers?.Authorization, "Bearer user-oauth-token");

    return {
      ok: true,
      async json() {
        return {
          errors: [
            {
              message: "Could not resolve to a User with the login of 'missing-user'."
            }
          ]
        };
      }
    };
  };

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().listProjectV2s({
          installationId: 12345678,
          appId: "12345",
          privateKey: privateKeyPem,
          accountLogin: "missing-user",
          accountType: "User",
          userAccessToken: "user-oauth-token",
          now: () => fixedNow
        }),
      (error) =>
        error?.response?.error?.message ===
        "GitHub ProjectV2 owner could not be resolved"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const privateKeyPem = createPrivateKeyPem();

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = url.toString();
    assert.equal(requestUrl, "https://api.github.com/graphql");
    assert.equal(options.headers?.Authorization, "Bearer user-oauth-token");

    return {
      ok: true,
      async json() {
        return {
          errors: [
            {
              message:
                "Your token has not been granted the required scopes: ['read:project']"
            }
          ]
        };
      }
    };
  };

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().listProjectV2s({
          installationId: 12345678,
          appId: "12345",
          privateKey: privateKeyPem,
          accountLogin: "Developer-EJ",
          accountType: "User",
          userAccessToken: "user-oauth-token",
          now: () => fixedNow
        }),
      (error) =>
        error?.response?.error?.message ===
        "GitHub ProjectV2 OAuth connection must be reconnected with project scope"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
