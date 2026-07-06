import { badRequest } from "../../common/api-error";

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

  if (value.startsWith("/") && !value.startsWith("//")) {
    return new URL(value, frontendUrl).toString();
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported returnUrl protocol");
    }
    if (url.origin !== frontendUrl) {
      throw new Error("Unsupported returnUrl origin");
    }

    return url.toString();
  } catch {
    throw badRequest("Invalid returnUrl");
  }
}
