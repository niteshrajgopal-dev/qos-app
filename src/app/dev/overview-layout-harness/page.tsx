import { notFound } from "next/navigation";
import { Suspense } from "react";

import { OverviewLayoutHarnessClient } from "@/app/dev/overview-layout-harness/overview-layout-harness-client";

function harnessEnabled() {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  return process.env.QOS_ENABLE_OVERVIEW_LAYOUT_HARNESS === "1";
}

export default function OverviewLayoutHarnessPage() {
  if (!harnessEnabled()) {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <OverviewLayoutHarnessClient />
    </Suspense>
  );
}
