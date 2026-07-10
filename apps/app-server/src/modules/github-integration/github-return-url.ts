import { badRequest } from "../../common/api-error";

const ENCODED_PATH_SEPARATOR_PATTERN = /%(?:2f|5c)/i;

export function validateGithubCallbackReturnUrl(
  value: unknown,
  frontendUrl: string
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || value.length > 2048) {
    throw badRequest("Invalid returnUrl");
  }

  try {
    const url =
      value.startsWith("/") && !value.startsWith("//")
        ? new URL(value, frontendUrl)
        : new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported returnUrl protocol");
    }
    if (url.origin !== frontendUrl) {
      throw new Error("Unsupported returnUrl origin");
    }
    if (ENCODED_PATH_SEPARATOR_PATTERN.test(url.pathname)) {
      throw new Error("Unsupported encoded returnUrl path separator");
    }

    return url.toString();
  } catch {
    throw badRequest("Invalid returnUrl");
  }
}
