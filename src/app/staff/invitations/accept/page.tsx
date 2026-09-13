import { InvitationAcceptForm } from "@/app/staff/invitations/accept/invitation-accept-form";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffAuthFrame } from "@/components/staff/StaffAuthFrame";

type InvitationAcceptPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function InvitationAcceptPage({
  searchParams,
}: InvitationAcceptPageProps) {
  const params = await searchParams;

  return (
    <StaffAuthFrame
      title="Accept invitation"
      subtitle="Redeem an operator invitation after signing in with the invited email address."
      actions={
        <ButtonLink href="/staff/sign-in" variant="ghost">
          Back to sign-in
        </ButtonLink>
      }
    >
      <InvitationAcceptForm initialToken={params.token ?? ""} />
    </StaffAuthFrame>
  );
}
