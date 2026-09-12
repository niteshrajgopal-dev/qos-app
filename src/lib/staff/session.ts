import { getStaffAuth } from "@/lib/staff/auth-server";

export class StaffAuthError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 401, field?: string) {
    super(message);
    this.name = "StaffAuthError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export async function getStaffSessionFromRequest(request: Request) {
  const auth = getStaffAuth();
  return auth.api.getSession({ headers: request.headers });
}

export async function requireVerifiedStaffSession(request: Request) {
  const session = await getStaffSessionFromRequest(request);

  if (!session?.user) {
    throw new StaffAuthError("Staff sign-in is required.", 401, "session");
  }

  if (!session.user.emailVerified) {
    throw new StaffAuthError(
      "Verified staff email is required.",
      401,
      "emailVerified",
    );
  }

  return session;
}

export function staffPrivateCacheControl() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  };
}
