import { readCustomerAuthConfig } from "@/lib/customer/config";

export class CustomerReturnUrlError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "CustomerReturnUrlError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export function assertTrustedCustomerReturnUrl(
  returnUrl: string | null | undefined,
) {
  if (!returnUrl?.trim()) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(returnUrl);
  } catch {
    throw new CustomerReturnUrlError("Return URL is invalid.", 400, "returnUrl");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CustomerReturnUrlError(
      "Return URL must use http or https.",
      400,
      "returnUrl",
    );
  }

  const trustedOrigins = readCustomerAuthConfig().trustedOrigins;
  if (trustedOrigins.length === 0) {
    throw new CustomerReturnUrlError(
      "Return URL validation is not configured.",
      400,
      "returnUrl",
    );
  }

  const origin = parsed.origin;
  const allowed = trustedOrigins.some((trusted) => {
    if (trusted === origin) {
      return true;
    }

    if (trusted.endsWith("*")) {
      const prefix = trusted.slice(0, -1);
      return origin.startsWith(prefix);
    }

    return false;
  });

  if (!allowed) {
    throw new CustomerReturnUrlError(
      "Return URL origin is not trusted.",
      403,
      "returnUrl",
    );
  }

  return parsed.toString();
}
