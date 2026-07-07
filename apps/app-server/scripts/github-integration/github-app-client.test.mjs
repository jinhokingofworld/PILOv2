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
                id: "PVT_kwDOExample",
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
                id: "PVT_kwDOExample",
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
        "GitHub user OAuth token lacks permission to read personal ProjectV2"
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
        "GitHub OAuth connection must be reconnected with read:project scope"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
