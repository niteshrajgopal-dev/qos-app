import { OnboardingForm } from "@/app/platform/onboarding/onboarding-form";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffAuthFrame } from "@/components/staff/StaffAuthFrame";

export default function PlatformOnboardingPage() {
  return (
    <StaffAuthFrame
      title="Create a business"
      subtitle="Operator-managed onboarding for Quotes, a retail tenant, or another Phase 1 business."
      actions={
        <ButtonLink href="/" variant="ghost">
          Platform home
        </ButtonLink>
      }
    >
      <OnboardingForm />
    </StaffAuthFrame>
  );
}
