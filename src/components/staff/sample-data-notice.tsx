"use client";

import { Alert } from "@/design-system";

export function SampleDataNotice() {
  return (
    <Alert tone="warning" icon="flask-conical" title="Sample data" style={{ marginBottom: 16 }}>
      This screen shows illustrative data from the design prototype. It is not connected to your business yet, and changes here are not saved.
    </Alert>
  );
}
