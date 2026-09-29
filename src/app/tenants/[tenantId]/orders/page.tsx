import { OrdersScreen } from "@/components/platform/orders-screen";
import { SampleDataNotice } from "@/components/staff/sample-data-notice";

export default function TenantOrdersPage() {
  return (
    <>
      <SampleDataNotice />
      <OrdersScreen />
    </>
  );
}
