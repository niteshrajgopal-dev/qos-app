"use client";

import Link from "next/link";
import React from "react";

import { Grid } from "@/components/platform/layout";
import { useStaffResource } from "@/components/staff/use-staff-resource";
import { Alert, Avatar, Badge, Button, Card, Chip, ConfirmDialog, DataTable, Drawer, EmptyState, Icon, PageHeader, SearchInput, Select, SkeletonText, StatusBadge, TableToolbar, Tabs, Timeline, Toast, ToastStack } from "@/design-system";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type Role = "administrator" | "user";

type Member = {
  membershipId: string;
  email: string;
  role: Role;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
  locations: { publicId: string; name: string }[];
};

type AccessRequest = { id: string; requesterEmail: string; status: "pending" | "approved" | "rejected" };

type AuditEvent = {
  id: string;
  actorSubject: string;
  action: string;
  entityPublicId: string;
  changeSummary: Record<string, unknown>;
  occurredAt: string;
};

const ROLE_LABEL: Record<Role, string> = { administrator: "Administrator", user: "User" };

const ROLES: { id: Role; body: string }[] = [
  { id: "administrator", body: "Everything a user can do, plus team, access requests, audit log, location administration and storefront publishing." },
  { id: "user", body: "Day-to-day operations: catalogue, menus, availability and stop-sales for the business." },
];

const ROLE_MATRIX: [string, boolean, boolean][] = [
  ["Edit catalogue and menus", true, true],
  ["Manage hours, exceptions and stop-sales", true, true],
  ["Edit storefront theme and content", true, false],
  ["Publish and roll back storefront releases", true, false],
  ["Approve or reject access requests", true, false],
  ["Change roles and remove access", true, false],
  ["View the audit log", true, false],
];

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function displayName(email: string) {
  return email.split("@")[0].replace(/[._-]+/g, " ");
}

function actorLabel(subject: string) {
  return subject.includes("@") ? subject : "An administrator";
}

type Filter = "all" | "administrator" | "revoked";

export function TeamScreen({ tenantId }: { tenantId: string }) {
  const base = `/api/tenants/${tenantId}`;
  const team = useStaffResource<{ members: Member[]; currentMembershipId: string }>(`${base}/staff/memberships`, "Unable to load the team.");
  const locations = useStaffResource<{ locations: { publicId: string }[] }>(`${base}/staff/locations`, "Unable to load locations.");
  const requests = useStaffResource<{ requests: AccessRequest[] }>(`${base}/staff/access-requests`, "Unable to load access requests.");

  const [tab, setTab] = React.useState("members");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<Member | null>(null);
  const [role, setRole] = React.useState<Role>("user");
  const [remove, setRemove] = React.useState<Member | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const members = team.data?.members ?? [];
  const currentMembershipId = team.data?.currentMembershipId ?? null;
  const activeMembers = members.filter((m) => m.status === "active");
  const locationCount = locations.data?.locations.length ?? 0;
  const pendingRequests = (requests.data?.requests ?? []).filter((r) => r.status === "pending").length;
  const needle = query.trim().toLowerCase();
  const rows = members.filter(
    (m) =>
      (filter === "all" ? m.status === "active" : filter === "revoked" ? m.status === "revoked" : m.status === "active" && m.role === "administrator") &&
      (!needle || m.email.toLowerCase().includes(needle)),
  );

  function scopeLabel(member: Member) {
    if (member.locations.length === 0) return "No locations";
    if (locationCount > 0 && member.locations.length >= locationCount) return "All locations";
    return member.locations.map((l) => l.name).join(", ");
  }

  function openMember(member: Member) {
    setOpen(member);
    setRole(member.role);
    setActionError(null);
  }

  async function postMembershipAction(membershipId: string, action: "role" | "revoke", body?: object) {
    const response = await staffApiFetch(`${base}/staff/memberships/${membershipId}/${action}`, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "The change could not be saved.");
    }
  }

  async function saveRole() {
    if (!open) return;
    if (role === open.role) {
      setOpen(null);
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await postMembershipAction(open.membershipId, "role", { role });
      setToast(`${open.email} is now ${ROLE_LABEL[role] === "Administrator" ? "an" : "a"} ${ROLE_LABEL[role]}`);
      setOpen(null);
      team.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The change could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmRemove() {
    if (!remove) return;
    const target = remove;
    setRemove(null);
    setSaving(true);
    setActionError(null);
    try {
      await postMembershipAction(target.membershipId, "revoke");
      setToast(`${target.email} no longer has access`);
      setOpen(null);
      team.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Access could not be removed.");
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: "email", header: "Member", render: (r: Member) => (
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar name={displayName(r.email)} size="sm" />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 500, textTransform: "capitalize" }}>{displayName(r.email)}{r.membershipId === currentMembershipId ? <Badge tone="neutral" style={{ marginLeft: 8, textTransform: "none" }}>You</Badge> : null}</span>
          <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{r.email}</span>
        </span>
      </span>
    ) },
    { key: "role", header: "Role", render: (r: Member) => ROLE_LABEL[r.role] },
    { key: "scope", header: "Scope", render: (r: Member) => scopeLabel(r) },
    { key: "status", header: "Status", render: (r: Member) => r.status === "active" ? <StatusBadge state="active" /> : <StatusBadge state="inactive" label="Removed" /> },
    { key: "createdAt", header: "Member since", numeric: true, render: (r: Member) => DATE_FORMAT.format(new Date(r.createdAt)) },
  ];

  const inviteAction = (
    <Link href={`/tenants/${tenantId}/staff/access-requests`} className="qos-btn" data-variant="primary">
      <Icon name="user-plus" size={15} />
      Access requests
      {pendingRequests > 0 ? <Badge tone="warning" style={{ marginLeft: 4 }}>{pendingRequests} pending</Badge> : null}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={team.data ? `${activeMembers.length} ${activeMembers.length === 1 ? "person has" : "people have"} access. Roles decide what they can change; scope decides where.` : "Roles decide what people can change; scope decides where."}
        actions={inviteAction}
      />

      {team.error ? (
        <Alert tone="error" title="Team unavailable" style={{ marginTop: 20 }}>{team.error}</Alert>
      ) : (
        <>
          <div style={{ marginTop: 20 }}>
            <Tabs tabs={[{ id: "members", label: "Members", count: activeMembers.length }, { id: "roles", label: "Roles" }, { id: "log", label: "Access log" }]} value={tab} onChange={setTab} />
          </div>

          {tab === "members" ? (
            <Card padding="none" style={{ marginTop: 16 }}>
              <TableToolbar>
                <SearchInput placeholder="Email" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 240 }} />
                <Chip selected={filter === "all"} onClick={() => setFilter("all")}>Active</Chip>
                <Chip selected={filter === "administrator"} onClick={() => setFilter("administrator")}>Administrators</Chip>
                <Chip selected={filter === "revoked"} count={members.length - activeMembers.length} onClick={() => setFilter("revoked")}>Removed</Chip>
              </TableToolbar>
              {team.loading ? (
                <div style={{ padding: "var(--card-padding)" }}><SkeletonText lines={4} /></div>
              ) : rows.length === 0 ? (
                <EmptyState icon="users" title="No members match" body="Try a different search or filter." />
              ) : (
                <DataTable columns={columns} rows={rows} rowKey="membershipId" density="dense" onRowClick={openMember} />
              )}
            </Card>
          ) : null}

          {tab === "roles" ? (
            <>
              <Grid cols={2} style={{ marginTop: 16 }}>
                {ROLES.map((r) => {
                  const count = activeMembers.filter((m) => m.role === r.id).length;
                  return (
                    <Card key={r.id} padding="sm">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <strong style={{ fontSize: 14, fontWeight: 600 }}>{ROLE_LABEL[r.id]}</strong>
                        <Badge tone="neutral">{count} {count === 1 ? "member" : "members"}</Badge>
                      </div>
                      <p style={{ marginTop: 8, fontSize: 13, lineHeight: "18px", color: "var(--text-secondary)" }}>{r.body}</p>
                    </Card>
                  );
                })}
              </Grid>
              <Card header="Permissions by role" subtitle="Roles are fixed on the QOS platform. Scope is set per member." padding="none" style={{ marginTop: 16 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "var(--text-secondary)", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 600 }}>
                      <th style={{ textAlign: "left", padding: "10px 20px", borderBottom: "1px solid var(--border-subtle)" }}>Permission</th>
                      {ROLES.map((r) => <th key={r.id} style={{ textAlign: "center", padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)" }}>{ROLE_LABEL[r.id]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ROLE_MATRIX.map(([label, ...cells]) => (
                      <tr key={label}>
                        <td style={{ padding: "10px 20px", borderBottom: "1px solid var(--border-subtle)" }}>{label}</td>
                        {cells.map((v, i) => (
                          <td key={i} style={{ textAlign: "center", padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)", color: v ? "var(--status-success-fg)" : "var(--text-disabled)" }}>
                            <Icon name={v ? "check" : "minus"} size={14} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          ) : null}

          {tab === "log" ? <AccessLog base={base} members={members} requests={requests.data?.requests ?? []} /> : null}
        </>
      )}

      {open ? (
        <Drawer
          title={<span style={{ display: "flex", alignItems: "center", gap: 10, textTransform: "capitalize" }}><Avatar name={displayName(open.email)} size="sm" />{displayName(open.email)}{open.status === "active" ? <StatusBadge state="active" /> : <StatusBadge state="inactive" label="Removed" />}</span>}
          description={open.email}
          onClose={() => setOpen(null)}
          footer={open.status === "active" && open.membershipId !== currentMembershipId ? <>
            <Button variant="ghost" disabled={saving} onClick={() => setRemove(open)}>Remove access</Button>
            <Button loading={saving} disabled={saving} onClick={() => void saveRole()}>Save changes</Button>
          </> : <Button variant="ghost" onClick={() => setOpen(null)}>Close</Button>}
        >
          <div style={{ display: "grid", gap: 16 }}>
            {actionError ? <Alert tone="error" title="Not saved">{actionError}</Alert> : null}
            {open.membershipId === currentMembershipId ? <Alert tone="info" title="This is you">Administrators cannot change their own role or remove their own access.</Alert> : null}
            <Select
              label="Role"
              value={role}
              options={ROLES.map((r) => ({ value: r.id, label: ROLE_LABEL[r.id] }))}
              disabled={open.status !== "active" || open.membershipId === currentMembershipId || saving}
              onChange={(e) => setRole(e.target.value as Role)}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Location scope</div>
              {open.locations.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>No locations assigned.</p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {open.locations.map((l) => <Badge key={l.publicId} tone="neutral" icon="map-pin">{l.name}</Badge>)}
                </div>
              )}
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-tertiary)" }}>Scope is set when an access request is approved.</p>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Member since {DATE_FORMAT.format(new Date(open.createdAt))} · last changed {DATE_FORMAT.format(new Date(open.updatedAt))}
            </div>
          </div>
        </Drawer>
      ) : null}

      {remove ? (
        <ConfirmDialog
          tone="danger"
          title={`Remove ${remove.email}'s access?`}
          description={`${remove.email} will lose access to this business immediately. Their actions stay in the access log. Nothing else is deleted.`}
          confirmLabel="Remove access"
          onClose={() => setRemove(null)}
          onConfirm={() => void confirmRemove()}
        />
      ) : null}
      {toast ? <ToastStack><Toast tone="success" title="Team" onDismiss={() => setToast(null)}>{toast}</Toast></ToastStack> : null}
    </>
  );
}

function AccessLog({ base, members, requests }: { base: string; members: Member[]; requests: AccessRequest[] }) {
  const memberships = useStaffResource<{ events: AuditEvent[] }>(`${base}/audit-events?entityType=staff_membership&limit=50`, "Unable to load the access log.");
  const decisions = useStaffResource<{ events: AuditEvent[] }>(`${base}/audit-events?entityType=staff_access_request&limit=50`, "Unable to load the access log.");

  const error = memberships.error ?? decisions.error;
  if (error) return <Alert tone="error" title="Access log unavailable" style={{ marginTop: 16 }}>{error}</Alert>;
  if (memberships.loading || decisions.loading) return <Card style={{ marginTop: 16 }}><SkeletonText lines={5} /></Card>;

  const emailByMembership = new Map(members.map((m) => [m.membershipId, m.email]));
  const emailByRequest = new Map(requests.map((r) => [r.id, r.requesterEmail]));
  const events = [...(memberships.data?.events ?? []), ...(decisions.data?.events ?? [])]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 50);

  if (events.length === 0) {
    return <Card style={{ marginTop: 16 }}><EmptyState icon="history" title="No access changes yet" body="Approvals, role changes and removals will appear here." /></Card>;
  }

  const items = events.map((event) => {
    const meta = `${DATE_TIME_FORMAT.format(new Date(event.occurredAt))} · ${actorLabel(event.actorSubject)}`;
    if (event.action === "staff.access_request.approve") {
      const email = emailByMembership.get(String(event.changeSummary.membershipId ?? "")) ?? emailByRequest.get(event.entityPublicId) ?? "A requester";
      const role = event.changeSummary.role as Role | undefined;
      return { id: event.id, title: `${email} approved${role ? ` as ${ROLE_LABEL[role]}` : ""}`, meta, tone: "success" as const, icon: "user-plus" };
    }
    if (event.action === "staff.access_request.reject") {
      return { id: event.id, title: `${emailByRequest.get(event.entityPublicId) ?? "A requester"}'s access request rejected`, meta, tone: "neutral" as const, icon: "x" };
    }
    const email = emailByMembership.get(event.entityPublicId) ?? "A member";
    if (event.action === "staff.membership.role_change") {
      const after = (event.changeSummary.after as { role?: Role } | undefined)?.role;
      return { id: event.id, title: `${email} changed to ${after ? ROLE_LABEL[after] : "a new role"}`, meta, tone: "neutral" as const, icon: "shield-check" };
    }
    if (event.action === "staff.membership.revoke") {
      return { id: event.id, title: `${email}'s access removed`, meta, tone: "error" as const, icon: "user-x" };
    }
    return { id: event.id, title: event.action, meta, tone: "neutral" as const, icon: "history" };
  });

  return (
    <Card style={{ marginTop: 16 }}>
      <Timeline items={items} />
    </Card>
  );
}
