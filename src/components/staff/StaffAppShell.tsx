"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { PortalScene } from "@/components/portal/PortalScene";
import {
  PortalShellProvider,
  type PortalBranchState,
} from "@/components/portal/portal-shell-context";
import { PortalTopBar } from "@/components/portal/PortalTopBar";
import { useAmbientMotion } from "@/components/portal/use-ambient-motion";
import { CommandPalette } from "@/design-system";
import { BranchChangeDialog } from "@/components/staff/branch-change-guard";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { BranchChangeGuard } from "@/lib/staff/branch-change-guard-state";
import {
  fetchBranchContext,
  readBranchSearchParam,
  readStoredBranchPreference,
  replaceBranchSearchParam,
  writeStoredBranchPreference,
} from "@/lib/staff/branch-context-client";
import { branchSelectionName, isolateText } from "@/lib/staff/branch-copy";
import {
  BRANCH_SEARCH_PARAM,
  type BranchSelection,
  isPermittedBranchSelection,
  resolveBranchSelection,
  withBranchParam,
} from "@/lib/staff/branch-selection";
import {
  staffCopyWith,
  staffRoleLabel,
  staffUiCopy,
} from "@/lib/staff/locale";
import type { ActiveStaffMembershipSummary } from "@/lib/staff/memberships";
import {
  activeStaffNavIdFromPath,
  staffNavHref,
  STAFF_NAV_GROUPS,
} from "@/lib/staff/nav";
import {
  buildStaffCommandGroups,
  filterCommandGroups,
} from "@/lib/staff/overlay";
import {
  fetchStaffSession,
  signOutStaff,
} from "@/lib/staff/staff-session-client";

type PortalShellRegister = (
  registration: Parameters<BranchChangeGuard["register"]>[0],
) => () => void;

type StaffAppShellProps = {
  tenantId: string;
  children: ReactNode;
};

const IDLE_BRANCH_STATE: PortalBranchState = {
  status: "idle",
  selection: null,
  branches: [],
  allBranchesAllowed: false,
  baseCurrency: null,
  role: null,
  requestedBusinessLabels: [],
};

function personName(email: string) {
  const local = email.split("@")[0] ?? "";
  if (!local) return "Staff";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

/* The staff portal shell: the approved 94px header over the fixed portal scene.
   The Overview and Storefronts show the scene at full strength; other screens
   render on a blurred, quieted version so dense data stays legible. */
export function StaffAppShell({ tenantId, children }: StaffAppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { locale, setLocale } = useStaffLocale();
  const { motion, toggleMotion } = useAmbientMotion();
  const [email, setEmail] = useState("");
  const [memberships, setMemberships] = useState<ActiveStaffMembershipSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState<PortalBranchState>(IDLE_BRANCH_STATE);
  /** Branch shown instead of a requested one that is not permitted. */
  const [branchFallback, setBranchFallback] = useState<BranchSelection | null>(null);

  const activeId = useMemo(
    () => activeStaffNavIdFromPath(pathname ?? ""),
    [pathname],
  );
  const isOverview = activeId === "home";
  const membership = memberships.find((entry) => entry.tenantId === tenantId);
  const name = personName(email);
  const roleLabel = staffRoleLabel(locale, membership?.role ?? null);
  const tenantName = membership?.tenantName ?? "QOS";
  const hasMembership = Boolean(membership);

  const applyBranch = useCallback((selection: BranchSelection) => {
    setBranch((current) => ({ ...current, selection }));
    setBranchFallback(null);
  }, []);
  const [guard] = useState(() => new BranchChangeGuard(() => undefined));
  useEffect(() => {
    guard.setApply(applyBranch);
  }, [guard, applyBranch]);
  const requestBranchChange = useCallback(
    (selection: BranchSelection) => {
      guard.request(selection);
    },
    [guard],
  );
  const registerUnsavedWork = useCallback<PortalShellRegister>(
    (registration) => guard.register(registration),
    [guard],
  );

  useEffect(() => {
    let cancelled = false;
    fetchStaffSession().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) {
          router.replace("/staff/sign-in");
          return;
        }
        setError(result.error);
        setReady(true);
        return;
      }
      setEmail(result.data.email);
      setMemberships(result.data.memberships);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  /* Branch context comes from the server after the session. The URL parameter
     and then the stored preference are tried in order, and only a value in the
     server's list is used; anything else falls back with a visible notice. */
  useEffect(() => {
    if (!ready || !hasMembership) {
      return;
    }

    let cancelled = false;
    fetchBranchContext(tenantId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setBranch({ ...IDLE_BRANCH_STATE, status: "error" });
        return;
      }

      const { selection, rejected } = resolveBranchSelection(
        [readBranchSearchParam(), readStoredBranchPreference(tenantId)],
        result.data,
      );
      setBranch({
        status: "ready",
        selection,
        branches: result.data.branches,
        allBranchesAllowed: result.data.allBranchesAllowed,
        baseCurrency: result.data.baseCurrency,
        role: result.data.role,
        requestedBusinessLabels: result.data.requestedBusinessLabels,
      });
      setBranchFallback(rejected !== null ? selection : null);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, hasMembership, tenantId]);

  /* Keep the branch across navigation. The URL is read as a request: another
     permitted branch (a link or a history entry) switches to it; a forbidden
     one keeps the current branch and says so. Adjusted during render so the
     page never renders with a stale branch. */
  const urlBranch = searchParams?.get(BRANCH_SEARCH_PARAM) ?? null;
  const [seenUrlBranch, setSeenUrlBranch] = useState<string | null>(null);
  if (branch.status === "ready" && urlBranch !== seenUrlBranch) {
    setSeenUrlBranch(urlBranch);
    if (urlBranch !== null && branch.selection !== null && urlBranch !== branch.selection) {
      if (isPermittedBranchSelection(urlBranch, branch.branches, branch.allBranchesAllowed)) {
        setBranch({ ...branch, selection: urlBranch });
        setBranchFallback(null);
      } else {
        setBranchFallback(branch.selection);
      }
    }
  }

  /* The selection is remembered per business and kept in the address bar,
     including after a link that did not carry it. */
  useEffect(() => {
    if (branch.status !== "ready" || branch.selection === null) {
      return;
    }
    writeStoredBranchPreference(tenantId, branch.selection);
    replaceBranchSearchParam(branch.selection);
  }, [branch.status, branch.selection, tenantId, pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function go(id: string) {
    const href = staffNavHref(tenantId, id);
    if (href) router.push(withBranchParam(href, branch.selection));
  }

  async function handleSignOut() {
    await signOutStaff();
    router.replace("/staff/sign-in");
  }

  /* The palette moves you around this business. It lists real destinations only;
     record search will arrive with the screens that own those records. */
  const commandGroups = useMemo(
    () =>
      filterCommandGroups(buildStaffCommandGroups(STAFF_NAV_GROUPS, locale), query),
    [locale, query],
  );

  const workspace = !ready ? (
    <p style={{ color: "var(--text-secondary)" }}>
      {staffUiCopy(locale, "loadingWorkspace")}
    </p>
  ) : error ? (
    <div className="qos-alert" data-tone="error" role="alert">
      <div>
        <div className="qos-alert-title">
          {staffUiCopy(locale, "unableToLoadWorkspace")}
        </div>
        <div className="qos-alert-body">{error}</div>
      </div>
    </div>
  ) : !membership ? (
    <div className="qos-alert" data-tone="warning" role="status">
      <div>
        <div className="qos-alert-title">
          {staffUiCopy(locale, "noAccessToBusiness")}
        </div>
        <div className="qos-alert-body">
          {staffUiCopy(locale, "noMembershipBody")}
        </div>
      </div>
    </div>
  ) : (
    children
  );

  const showOverview = isOverview && ready && !error && Boolean(membership);
  const currentBranchName =
    branchSelectionName(locale, branch.selection, branch.branches) ?? "";
  const fallbackName = branchSelectionName(locale, branchFallback, branch.branches);

  return (
    <PortalShellProvider
      value={{
        tenantId,
        tenantName,
        personName: name,
        roleLabel,
        motion,
        toggleMotion,
        branch,
        requestBranchChange,
        registerUnsavedWork,
      }}
    >
      <div
        className="qosp-app"
        data-portal-surface={showOverview ? "overview" : "workspace"}
        data-portal-scene={activeId === "store" ? "vivid" : undefined}
      >
        <PortalScene motion={motion} />
        <PortalTopBar
          tenantId={tenantId}
          tenantName={tenantName}
          tenants={memberships.map((entry) => ({
            id: entry.tenantId,
            name: entry.tenantName,
          }))}
          activeId={activeId}
          personName={name}
          roleLabel={roleLabel}
          locale={locale}
          onToggleLocale={() => setLocale(locale === "en" ? "ar" : "en")}
          onOpenSearch={() => setCommandOpen(true)}
          onSelectTenant={(id) => router.push(`/tenants/${id}`)}
          branch={branch}
          onSelectBranch={requestBranchChange}
          onSignOut={() => {
            void handleSignOut();
          }}
        />
        {fallbackName ? (
          <div className="qosp-branch-notice" role="status">
            <Icon name="alert-triangle" size={16} />
            <span>
              {staffCopyWith(locale, "branchFallbackNotice", {
                branch: isolateText(fallbackName),
              })}
            </span>
            <button
              type="button"
              className="qosp-icon-button"
              aria-label={staffUiCopy(locale, "dismiss")}
              onClick={() => setBranchFallback(null)}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ) : null}
        {showOverview ? (
          workspace
        ) : (
          <main className="qosp-workspace">
            <div className="qosp-workspace-inner">{workspace}</div>
          </main>
        )}
      </div>
      <CommandPalette
        open={commandOpen}
        query={query}
        onQueryChange={setQuery}
        onClose={() => setCommandOpen(false)}
        onSelect={(item) => {
          setCommandOpen(false);
          if (item?.id) {
            go(item.id);
          }
        }}
        groups={commandGroups}
        placeholder={staffUiCopy(locale, "searchCommands")}
      />
      <BranchChangeDialog guard={guard} currentBranchName={currentBranchName} />
    </PortalShellProvider>
  );
}
