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
  const graphqlRequests = [];

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

    const body = JSON.parse(options.body);
    graphqlRequests.push(body);
    const isSecondPage = body.variables.cursor === "projects-page-2";
    return {
      ok: true,
      async json() {
        return {
          data: {
            repository: {
              projectsV2: {
                nodes: [
                  projectNode({
                    id: isSecondPage ? "PVT_kwDOSecond" : "PVT_kwDOExample",
                    number: isSecondPage ? 2 : 1
                  })
                ],
                pageInfo: {
                  hasNextPage: !isSecondPage,
                  endCursor: isSecondPage ? null : "projects-page-2"
                }
              }
            }
          }
        };
      }
    };
  };

  try {
    const projects = await new GithubAppClient().listRepositoryProjectV2s({
      installationId: 12345678,
      appId: "12345",
      privateKey: privateKeyPem,
      owner: "my-team",
      repo: "pilo",
      accountType: "Organization",
      now: () => fixedNow
    });

    assert.deepEqual(
      graphqlRequests.map((request) => request.variables),
      [
        { owner: "my-team", name: "pilo", cursor: null },
        { owner: "my-team", name: "pilo", cursor: "projects-page-2" }
      ]
    );
    assert.deepEqual(projects.map((project) => project.id), [
      "PVT_kwDOExample",
      "PVT_kwDOSecond"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

    return {
      ok: true,
      async json() {
        return {
          data: {
            repository: {
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
    const projects = await new GithubAppClient().listRepositoryProjectV2s({
      installationId: 12345678,
      appId: "12345",
      privateKey: privateKeyPem,
      owner: "my-team",
      repo: "pilo",
      accountType: "Organization",
      now: () => fixedNow
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, "POST");
    assert.match(requests[0].headers.Authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
    assert.match(requests[1].body.query, /repository\(owner: \$owner, name: \$name\)/);
    assert.deepEqual(requests[1].body.variables, {
      owner: "my-team",
      name: "pilo",
      cursor: null
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
        repositoryNodeIds: []
      }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  let requestSignal;
  globalThis.fetch = async (_url, options = {}) => {
    requestSignal = options.signal;
    return {
      ok: true,
      async json() {
        return {
          data: {
            addProjectV2ItemById: {
              item: {
                id: "PVTI_lADOExample"
              }
            }
          }
        };
      }
    };
  };

  try {
    assert.deepEqual(
      await new GithubAppClient().addProjectV2ItemByContentId({
        contentNodeId: "I_kwDOExample",
        projectNodeId: "PVT_kwDOExample",
        userAccessToken: "user-oauth-token"
      }),
      {
        itemNodeId: "PVTI_lADOExample"
      }
    );
    assert.equal(requestSignal, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const privateKeyPem = createPrivateKeyPem();
  const timeoutHandle = Symbol("ProjectV2 GraphQL timeout");
  let timeoutCallback;
  let clearedTimeoutHandle;
  let requestSignal;
  let markGraphqlRequestStarted;
  let markJsonReadStarted;
  const graphqlRequestStarted = new Promise((resolve) => {
    markGraphqlRequestStarted = resolve;
  });
  const jsonReadStarted = new Promise((resolve) => {
    markJsonReadStarted = resolve;
  });

  globalThis.setTimeout = (callback, delay) => {
    timeoutCallback = callback;
    assert.equal(delay, 30_000);
    return timeoutHandle;
  };
  globalThis.clearTimeout = (handle) => {
    clearedTimeoutHandle = handle;
  };
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
    requestSignal = options.signal;
    markGraphqlRequestStarted();

    return {
      ok: true,
      async json() {
        markJsonReadStarted();
        return new Promise((_resolve, reject) => {
          requestSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted", "AbortError")),
            { once: true }
          );
        });
      }
    };
  };

  try {
    const sync = new GithubAppClient().listRepositoryProjectV2s({
      installationId: 12345678,
      appId: "12345",
      privateKey: privateKeyPem,
      owner: "my-team",
      repo: "pilo",
      accountType: "Organization",
      now: () => fixedNow
    });

    await graphqlRequestStarted;
    await jsonReadStarted;
    assert.ok(requestSignal instanceof AbortSignal);
    assert.equal(typeof timeoutCallback, "function");
    assert.equal(clearedTimeoutHandle, undefined);
    timeoutCallback();

    await assert.rejects(
      () => sync,
      (error) => {
        assert.equal(error?.getStatus?.(), 400);
        assert.equal(
          error?.response?.error?.message,
          "GitHub ProjectV2 discovery timed out"
        );
        assert.doesNotMatch(
          JSON.stringify(error?.response),
          /installation-token|api\.github\.com|operation was aborted/i
        );
        return true;
      }
    );
    assert.equal(requestSignal.aborted, true);
    assert.equal(clearedTimeoutHandle, timeoutHandle);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
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
        new GithubAppClient().listRepositoryProjectV2s({
          installationId: 12345678,
          appId: "12345",
          privateKey: privateKeyPem,
          owner: "my-team",
          repo: "pilo",
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
        new GithubAppClient().listRepositoryProjectV2s({
          installationId: 12345678,
          appId: "12345",
          privateKey: privateKeyPem,
          owner: "Developer-EJ",
          repo: "PILO",
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

    if (body.query.includes("repository(owner: $owner, name: $name)")) {
      return {
        ok: true,
        async json() {
          return {
            data: {
              repository: {
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

    const projects = await client.listRepositoryProjectV2s({
      ...baseInput,
      owner: "Developer-EJ",
      repo: "PILO",
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
        new GithubAppClient().listRepositoryProjectV2s({
          installationId: 12345678,
          appId: "12345",
          privateKey: privateKeyPem,
          owner: "Developer-EJ",
          repo: "PILO",
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
        new GithubAppClient().listRepositoryProjectV2s({
          installationId: 12345678,
          appId: "12345",
          privateKey: privateKeyPem,
          owner: "missing-user",
          repo: "PILO",
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
        new GithubAppClient().listRepositoryProjectV2s({
          installationId: 12345678,
          appId: "12345",
          privateKey: privateKeyPem,
          owner: "Developer-EJ",
          repo: "PILO",
          accountType: "User",
          userAccessToken: "user-oauth-token",
          now: () => fixedNow
        }),
      (error) =>
        error?.response?.error?.message ===
        "GitHub ProjectV2 OAuth connection must be reconnected with project and repo scopes"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
{
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: url.toString(),
      method: options.method,
      body: JSON.parse(options.body)
    });
    return {
      ok: true,
      status: 200,
      async json() {
        return githubIssuePayload({
          assignees: [{ login: "alice" }]
        });
      }
    };
  };

  try {
    const client = new GithubAppClient();
    await client.removeRepositoryIssueAssignees({
      assignees: ["bob"],
      issueNumber: 609,
      owner: "Developer-EJ",
      repo: "PILO",
      userAccessToken: "user-token"
    });
    await client.addRepositoryIssueAssignees({
      assignees: ["carol"],
      issueNumber: 609,
      owner: "Developer-EJ",
      repo: "PILO",
      userAccessToken: "user-token"
    });

    assert.deepEqual(requests, [
      {
        url:
          "https://api.github.com/repos/Developer-EJ/PILO/issues/609/assignees",
        method: "DELETE",
        body: { assignees: ["bob"] }
      },
      {
        url:
          "https://api.github.com/repos/Developer-EJ/PILO/issues/609/assignees",
        method: "POST",
        body: { assignees: ["carol"] }
      }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
