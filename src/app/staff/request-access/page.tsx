import Link from "next/link";

import { RequestAccessForm } from "@/app/staff/request-access/request-access-form";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffAuthFrame } from "@/components/staff/StaffAuthFrame";

export default function RequestAccessPage() {
  return (
    <StaffAuthFrame
      title="Request access"
      subtitle="Submit a request to join an existing business. You cannot see business data until an Administrator approves you."
      actions={
        <ButtonLink href="/staff/sign-in" variant="ghost">
          Back to sign-in
        </ButtonLink>
      }
    >
      <RequestAccessForm />
      <p className="qos-pagesub" style={{ marginTop: 16 }}>
        <Link href="/">Platform home</Link>
      </p>
    </StaffAuthFrame>
  );
}
