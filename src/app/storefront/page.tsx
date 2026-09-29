"use client";

import { StorefrontApp } from "@/components/platform/storefront-screen";
import { SampleDataNotice } from "@/components/staff/sample-data-notice";

export default function StorefrontPage() {
  return (
    <div style={{ height: "100vh", overflowY: "auto" }}>
      <SampleDataNotice />
      <StorefrontApp onExit={() => undefined} />
    </div>
  );
}
