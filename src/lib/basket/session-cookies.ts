export const ANON_SESSION_COOKIE = "qos_anon_session";
export const ANON_CSRF_COOKIE = "qos_anon_csrf";

export function parseCookieHeader(cookieHeader: string | null) {
  const cookies = new Map<string, string>();

  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    if (!rawName) {
      continue;
    }

    cookies.set(rawName, decodeURIComponent(rawValueParts.join("=")));
  }

  return cookies;
}

export function readAnonymousSessionCookies(request: Request) {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return {
    sessionToken: cookies.get(ANON_SESSION_COOKIE) ?? null,
    csrfToken: cookies.get(ANON_CSRF_COOKIE) ?? null,
  };
}

export function buildAnonymousSessionCookieHeaders(input: {
  sessionToken: string;
  csrfToken: string;
  maxAgeSeconds: number;
}) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return [
    `${ANON_SESSION_COOKIE}=${encodeURIComponent(input.sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${input.maxAgeSeconds}${secure}`,
    `${ANON_CSRF_COOKIE}=${encodeURIComponent(input.csrfToken)}; Path=/; SameSite=Lax; Max-Age=${input.maxAgeSeconds}${secure}`,
  ];
}

export function buildAnonymousSessionClearCookieHeaders() {
  return [
    `${ANON_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${ANON_CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`,
  ];
}

export function assertCsrfProtection(request: Request, expectedCsrfToken: string) {
  const headerToken = request.headers.get("x-qos-csrf-token")?.trim();
  const { csrfToken: cookieToken } = readAnonymousSessionCookies(request);

  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    throw new AnonymousBasketAuthError("CSRF validation failed.", 403, "csrfToken");
  }

  if (headerToken !== expectedCsrfToken) {
    throw new AnonymousBasketAuthError("CSRF validation failed.", 403, "csrfToken");
  }
}

export class AnonymousBasketAuthError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 401, field?: string) {
    super(message);
    this.name = "AnonymousBasketAuthError";
    this.statusCode = statusCode;
    this.field = field;
  }
}
