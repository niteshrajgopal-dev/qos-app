"use client";

import { StorefrontApp } from "@/components/platform/storefront-screen";

export default function StorefrontPage() {
  return (
    <div style={{ height: "100vh", overflowY: "auto" }}>
      <StorefrontApp onExit={() => undefined} />
    </div>
  );
}
