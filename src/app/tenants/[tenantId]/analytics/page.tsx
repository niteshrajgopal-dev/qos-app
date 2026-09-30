import { AnalyticsScreen } from "@/components/platform/analytics-screen";
import { SampleDataNotice } from "@/components/staff/sample-data-notice";

export default function TenantAnalyticsPage() {
  return (
    <>
      <SampleDataNotice />
      <AnalyticsScreen />
    </>
  );
}
