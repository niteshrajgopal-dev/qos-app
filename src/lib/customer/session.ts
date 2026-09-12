import { getCustomerAuth } from "@/lib/customer/auth-server";

export class CustomerAuthError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 401, field?: string) {
    super(message);
    this.name = "CustomerAuthError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export async function getCustomerSessionFromRequest(request: Request) {
  const auth = getCustomerAuth();
  return auth.api.getSession({ headers: request.headers });
}

export async function requireVerifiedCustomerSession(request: Request) {
  const session = await getCustomerSessionFromRequest(request);

  if (!session?.user) {
    throw new CustomerAuthError(
      "Verified customer sign-in is required.",
      401,
      "session",
    );
  }

  if (!session.user.emailVerified) {
    throw new CustomerAuthError(
      "Verified email is required before checkout.",
      401,
      "emailVerified",
    );
  }

  return session;
}

export function customerPrivateCacheControl() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  };
}
