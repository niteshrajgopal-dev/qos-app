import { SettingsScreen } from "@/components/platform/team-settings-screen";
import { SampleDataNotice } from "@/components/staff/sample-data-notice";

export default function TenantSettingsPage() {
  return (
    <>
      <SampleDataNotice />
      <SettingsScreen />
    </>
  );
}
