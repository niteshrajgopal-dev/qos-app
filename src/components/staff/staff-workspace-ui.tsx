"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Alert } from "@/components/Alert";
import { Drawer } from "@/components/Drawer";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { qosStateFromDb } from "@/components/map-db-status";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { formatMinorCurrency } from "@/lib/staff/workspace-view";

export function useStaffWorkspaceSection(tenantId: string, section: string) {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    staffApiFetch(
      `/api/tenants/${tenantId}/staff/workspace?section=${section}`,
    ).then(async (response) => {
      const body = (await response.json()) as Record<string, unknown> & {
        error?: string;
      };

      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setError(body.error ?? "Unable to load this workspace.");
        return;
      }

      setPayload(body);
    });

    return () => {
      cancelled = true;
    };
  }, [section, tenantId]);

  return { payload, error };
}

function WorkspaceTable({
  columns,
  children,
}: {
  columns: string[];
  children: ReactNode;
}) {
  return (
    <div className="qos-card" data-padding="none">
      <div className="qos-table-wrap">
        <table className="qos-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

type OrderRow = {
  publicId: string;
  status:
    | "pending"
    | "provider_handoff"
    | "unknown"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "expired";
  amountMinor: number;
  currency: string;
  provider: string;
  createdAt: string;
  customerEmail: string;
  customerName: string;
};

export function StaffOrdersPanel({ tenantId }: { tenantId: string }) {
  const { payload, error } = useStaffWorkspaceSection(tenantId, "orders");
  const data = (payload?.orders ?? null) as OrderRow[] | null;
  const [selected, setSelected] = useState<OrderRow | null>(null);

  if (error) {
    return <Alert tone="error">{error}</Alert>;
  }

  if (!payload) {
    return <p className="qos-pagesub">Loading checkout attempts…</p>;
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon="receipt"
        title="No checkout attempts"
        body="Authenticated Stripe sandbox checkouts for this tenant will appear here."
      />
    );
  }

  return (
    <>
      <WorkspaceTable
        columns={["Reference", "Customer", "Amount", "Provider", "When", "Status"]}
      >
        {data.map((order) => (
          <tr
            key={order.publicId}
            data-exception={
              order.status === "failed" || order.status === "unknown"
                ? "true"
                : undefined
            }
            style={{ cursor: "pointer" }}
            onClick={() => setSelected(order)}
          >
            <td>{order.publicId}</td>
            <td>
              {order.customerName}
              <div className="qos-card-sub">{order.customerEmail}</div>
            </td>
            <td data-numeric="true">
              {formatMinorCurrency(order.amountMinor, order.currency)}
            </td>
            <td>{order.provider}</td>
            <td>{new Date(order.createdAt).toLocaleString()}</td>
            <td>
              <StatusBadge
                state={qosStateFromDb(
                  "checkout_payment_attempt_status",
                  order.status,
                )}
              />
            </td>
          </tr>
        ))}
      </WorkspaceTable>
      <Drawer
        open={Boolean(selected)}
        title={selected?.publicId}
        description={
          selected
            ? `${selected.provider} · ${selected.customerEmail}`
            : undefined
        }
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <div className="qos-card-sub">Customer</div>
              <div>
                {selected.customerName}
                <div className="qos-card-sub">{selected.customerEmail}</div>
              </div>
            </div>
            <div>
              <div className="qos-card-sub">Amount</div>
              <div>
                {formatMinorCurrency(selected.amountMinor, selected.currency)}
              </div>
            </div>
            <div>
              <div className="qos-card-sub">When</div>
              <div>{new Date(selected.createdAt).toLocaleString()}</div>
            </div>
            <div>
              <div className="qos-card-sub">Status</div>
              <StatusBadge
                state={qosStateFromDb(
                  "checkout_payment_attempt_status",
                  selected.status,
                )}
              />
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

type CustomerRow = {
  customerUserId: string;
  status: "active" | "suspended";
  createdAt: string;
  email: string;
  name: string;
  emailVerified: boolean;
  storefrontName: string;
};

export function StaffCustomersPanel({ tenantId }: { tenantId: string }) {
  const { payload, error } = useStaffWorkspaceSection(tenantId, "customers");
  const data = (payload?.customers ?? null) as CustomerRow[] | null;

  if (error) {
    return <Alert tone="error">{error}</Alert>;
  }

  if (!payload) {
    return <p className="qos-pagesub">Loading customers…</p>;
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="No storefront customers"
        body="Customers who register on this tenant’s storefront will appear here."
      />
    );
  }

  return (
    <WorkspaceTable
      columns={["Customer", "Storefront", "Verified", "Joined", "Status"]}
    >
      {data.map((customer) => (
        <tr key={`${customer.customerUserId}-${customer.storefrontName}`}>
          <td>
            {customer.name}
            <div className="qos-card-sub">{customer.email}</div>
          </td>
          <td>{customer.storefrontName}</td>
          <td>{customer.emailVerified ? "Yes" : "No"}</td>
          <td>{new Date(customer.createdAt).toLocaleString()}</td>
          <td>
            <StatusBadge
              state={qosStateFromDb("customer_association_status", customer.status)}
            />
          </td>
        </tr>
      ))}
    </WorkspaceTable>
  );
}

type IntegrationRow = {
  id: string;
  name: string;
  provider: string;
  mode: string;
  currency: string;
  status: "connected" | "config_required";
};

export function StaffIntegrationsPanel({ tenantId }: { tenantId: string }) {
  const { payload, error } = useStaffWorkspaceSection(tenantId, "integrations");
  const data = (payload?.integrations ?? []) as IntegrationRow[];

  if (error) {
    return <Alert tone="error">{error}</Alert>;
  }

  if (!payload) {
    return <p className="qos-pagesub">Loading integrations…</p>;
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {data.map((integration) => (
        <div key={integration.id} className="qos-card" data-padding="md">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div>
              <div className="qos-card-title">{integration.name}</div>
              <p className="qos-card-sub">
                {integration.provider} · {integration.mode} ·{" "}
                {integration.currency}
              </p>
            </div>
            <StatusBadge state={integration.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

type AnalyticsView = {
  paymentAttempts: number;
  succeededPayments: number;
  failedPayments: number;
  customers: number;
  menus: number;
  liveMenus: number;
};

export function StaffAnalyticsPanel({ tenantId }: { tenantId: string }) {
  const { payload, error } = useStaffWorkspaceSection(tenantId, "analytics");
  const data = (payload?.analytics ?? null) as AnalyticsView | null;

  if (error) {
    return <Alert tone="error">{error}</Alert>;
  }

  if (!data) {
    return <p className="qos-pagesub">Loading counts…</p>;
  }

  const cards = [
    ["Checkout attempts", data.paymentAttempts],
    ["Succeeded payments", data.succeededPayments],
    ["Failed payments", data.failedPayments],
    ["Storefront customers", data.customers],
    ["Menus", data.menus],
    ["Published menus", data.liveMenus],
  ] as const;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 16,
      }}
    >
      {cards.map(([label, value]) => (
        <div key={label} className="qos-card" data-padding="md">
          <div className="qos-kpi-label">{label}</div>
          <div className="qos-kpi-value">{value}</div>
        </div>
      ))}
    </div>
  );
}

type SettingsView = {
  publicId: string;
  name: string;
  status: string;
  businessProfile: string;
  baseCurrency: string;
  defaultLocale: string;
  defaultTimezone: string;
  supportedLocales: string[];
};

export function StaffSettingsPanel({ tenantId }: { tenantId: string }) {
  const { payload, error } = useStaffWorkspaceSection(tenantId, "settings");
  const data = (payload?.settings ?? null) as SettingsView | null;

  if (error) {
    return <Alert tone="error">{error}</Alert>;
  }

  if (!data) {
    return <p className="qos-pagesub">Loading business settings…</p>;
  }

  const rows = [
    ["Business", data.name],
    ["Public ID", data.publicId],
    ["Profile", data.businessProfile],
    ["Currency", data.baseCurrency],
    ["Default locale", data.defaultLocale],
    ["Supported locales", data.supportedLocales.join(", ")],
    ["Timezone", data.defaultTimezone],
  ] as const;

  return (
    <div className="qos-card" data-padding="md">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div className="qos-card-title">Business profile</div>
        <StatusBadge state={data.status} />
      </div>
      <dl style={{ display: "grid", gap: 12, margin: 0 }}>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="qos-field-label">{label}</dt>
            <dd style={{ margin: 0 }}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
