import { AiAgentsSettings } from "@/app/tenants/[tenantId]/settings/ai-agents/ai-agents-settings";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TenantAiAgentsPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <StaffScreen
      title="AI & Agents"
      subtitle="Which QOS agents this business can use. QOS approves each agent; administrators decide whether it is on."
    >
      <AiAgentsSettings tenantId={tenantId} />
    </StaffScreen>
  );
}
