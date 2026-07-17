import { pathToFileURL } from "node:url";

export async function inspectCorsPreflight({
  fetchImpl = fetch,
  origin,
  requestHeaders = ["authorization", "content-type"],
  requestMethod = "POST",
  url
}) {
  const normalizedMethod = requestMethod.trim().toUpperCase();
  const normalizedHeaders = requestHeaders
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  const response = await fetchImpl(url, {
    headers: {
      Origin: origin,
      "Access-Control-Request-Headers": normalizedHeaders.join(","),
      "Access-Control-Request-Method": normalizedMethod
    },
    method: "OPTIONS",
    redirect: "manual"
  });
  const allowCredentials =
    response.headers.get("access-control-allow-credentials");
  const allowHeaders = response.headers.get("access-control-allow-headers");
  const allowMethods = response.headers.get("access-control-allow-methods");
  const allowOrigin = response.headers.get("access-control-allow-origin");
  const allowedHeaderNames = splitHeaderValues(allowHeaders);
  const allowedMethods = splitHeaderValues(allowMethods).map((value) =>
    value.toUpperCase()
  );
  const originAllowed =
    allowOrigin === origin ||
    (allowOrigin === "*" && allowCredentials?.toLowerCase() !== "true");
  const methodAllowed = allowedMethods.includes(normalizedMethod);
  const headersAllowed =
    allowedHeaderNames.includes("*") ||
    normalizedHeaders.every((header) => allowedHeaderNames.includes(header));

  return {
    allowCredentials,
    allowHeaders,
    allowMethods,
    allowOrigin,
    ok:
      response.status >= 200 &&
      response.status < 300 &&
      originAllowed &&
      methodAllowed &&
      headersAllowed,
    status: response.status
  };
}

function splitHeaderValues(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function readCliOptions(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];

    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(
        "Usage: node cors-preflight-smoke.mjs --url <url> --origin <origin> [--method POST] [--headers authorization,content-type]"
      );
    }
    values.set(name.slice(2), value);
  }

  const url = values.get("url");
  const origin = values.get("origin");

  if (!url || !origin) {
    throw new Error("--url and --origin are required");
  }

  new URL(url);
  new URL(origin);

  return {
    origin,
    requestHeaders: (values.get("headers") ?? "authorization,content-type")
      .split(","),
    requestMethod: values.get("method") ?? "POST",
    url
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await inspectCorsPreflight(
      readCliOptions(process.argv.slice(2))
    );
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
