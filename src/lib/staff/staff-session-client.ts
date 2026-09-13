import type { ActiveStaffMembershipSummary } from "@/lib/staff/memberships";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

export type StaffSessionPayload = {
  subject: string;
  email: string;
  memberships: ActiveStaffMembershipSummary[];
};

export async function fetchStaffSession(): Promise<
  | { ok: true; data: StaffSessionPayload }
  | { ok: false; status: number; error: string }
> {
  const response = await staffApiFetch("/api/staff/me/memberships");
  const payload = (await response.json()) as StaffSessionPayload & {
    error?: string;
  };

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.error ?? "Staff session is required.",
    };
  }

  return {
    ok: true,
    data: {
      subject: payload.subject,
      email: payload.email,
      memberships: payload.memberships ?? [],
    },
  };
}

export async function signOutStaff() {
  await staffApiFetch("/api/staff-auth/sign-out", { method: "POST" });
}
