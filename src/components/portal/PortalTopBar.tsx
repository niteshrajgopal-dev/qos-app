"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Icon } from "@/components/Icon";
import type { PortalBranchState } from "@/components/portal/portal-shell-context";
import { branchSelectionName, branchStatusLabel } from "@/lib/staff/branch-copy";
import {
  ALL_BRANCHES,
  type BranchSelection,
  withBranchParam,
} from "@/lib/staff/branch-selection";
import {
  staffCopyWith,
  staffDocumentDirection,
  staffNavLabel,
  staffUiCopy,
  type StaffLocale,
} from "@/lib/staff/locale";
import {
  isStaffMoreNavId,
  staffNavHref,
  STAFF_MORE_NAV_GROUPS,
  STAFF_TOP_NAV,
} from "@/lib/staff/nav";

type PortalTopBarProps = {
  tenantId: string;
  tenantName: string;
  tenants: Array<{ id: string; name: string }>;
  activeId: string;
  personName: string;
  roleLabel: string;
  locale: StaffLocale;
  onToggleLocale: () => void;
  onOpenSearch: () => void;
  onSelectTenant: (tenantId: string) => void;
  onSignOut: () => void;
  /** Omitted by the layout harness; the picker then stays hidden. */
  branch?: PortalBranchState;
  onSelectBranch?: (selection: BranchSelection) => void;
};

const NO_BRANCH_CONTEXT: PortalBranchState = {
  status: "idle",
  selection: null,
  branches: [],
  allBranchesAllowed: false,
  baseCurrency: null,
  role: null,
  requestedBusinessLabels: [],
};

/* The approved 94px header: white QOS mark with WORKSPACE beneath it, five
   destinations centred with More, then search, notifications, the business
   picker and the profile. At 680px and below the five destinations scroll
   inside their own row while More and search stay pinned beside them, and
   the business picker shrinks to its initial tile. */
export function PortalTopBar({
  tenantId,
  tenantName,
  tenants,
  activeId,
  personName,
  roleLabel,
  locale,
  onToggleLocale,
  onOpenSearch,
  onSelectTenant,
  onSignOut,
  branch = NO_BRANCH_CONTEXT,
  onSelectBranch,
}: PortalTopBarProps) {
  const [openMenu, setOpenMenu] = useState<
    "more" | "workspace" | "branch" | "profile" | null
  >(null);
  /* Links inside this business keep the current branch in the URL. */
  const branchHref = (href: string) => withBranchParam(href, branch.selection);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        const trigger = headerRef.current?.querySelector<HTMLElement>(
          '[aria-expanded="true"]',
        );
        setOpenMenu(null);
        trigger?.focus();
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const initials = personName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <header className="qosp-topbar" ref={headerRef}>
      <Link
        href={branchHref(staffNavHref(tenantId, "home") ?? "/")}
        className="qosp-brand"
        aria-label="QOS workspace overview"
      >
        {/* Brand geometry is unchanged; the white treatment is a CSS filter. */}
        <Image src="/brand/qos-logo-original.png" alt="QOS" width={126} height={42} priority />
        <span>WORKSPACE</span>
      </Link>

      <nav className="qosp-nav" aria-label="Primary">
        <ActiveLinkInView className="qosp-nav-links" activeKey={`${activeId}:${locale}`}>
          {STAFF_TOP_NAV.map((item) => {
            const href = staffNavHref(tenantId, item.id);
            if (!href) {
              return null;
            }

            return (
              <Link
                key={item.id}
                href={branchHref(href)}
                className="qosp-nav-link"
                data-active={activeId === item.id || undefined}
              >
                {staffNavLabel(locale, item.id, item.label)}
              </Link>
            );
          })}
        </ActiveLinkInView>
        {/* Outside the scrolling links so it never needs a sideways scroll. */}
        <div className="qosp-nav-more">
          <button
            type="button"
            className="qosp-nav-link"
            data-active={isStaffMoreNavId(activeId) || undefined}
            aria-haspopup="menu"
            aria-expanded={openMenu === "more"}
            onClick={() => setOpenMenu(openMenu === "more" ? null : "more")}
          >
            {staffUiCopy(locale, "more")}
            <Icon name="chevron-down" size={14} />
          </button>
          {openMenu === "more" ? (
            <div
              className="qos-menu"
              role="menu"
              style={{
                top: 46,
                insetInlineStart: "50%",
                /* Centre under More in both directions (inline-start is the
                   right edge in Arabic). */
                translate: staffDocumentDirection(locale) === "rtl" ? "50% 0" : "-50% 0",
              }}
            >
              {STAFF_MORE_NAV_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="qos-cmd-group">
                    {group.label
                      ? staffNavLabel(
                          locale,
                          group.label.toLowerCase(),
                          group.label,
                        )
                      : null}
                  </div>
                  {group.items.map((item) => {
                    const href = staffNavHref(tenantId, item.id);
                    if (!href) {
                      return null;
                    }

                    return (
                      <Link
                        key={item.id}
                        href={branchHref(href)}
                        role="menuitem"
                        className="qos-menu-item"
                        data-selected={activeId === item.id || undefined}
                        onClick={() => setOpenMenu(null)}
                      >
                        <span style={{ flex: 1, minWidth: 0 }}>
                          {staffNavLabel(locale, item.id, item.label)}
                        </span>
                        {item.availability === "soon" ? (
                          <span className="qosp-soon-badge">
                            {staffUiCopy(locale, "soon")}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </nav>

      {/* A top bar child (not inside the actions) so that at 680px and below
          it can sit at the end of the nav row as an icon. */}
        <button
          type="button"
          className="qosp-search-trigger"
          onClick={onOpenSearch}
          aria-label={staffUiCopy(locale, "searchThisBusiness")}
        >
          <Icon name="search" size={15} />
          <kbd>⌘K</kbd>
        </button>

      <div className="qosp-top-actions">
        <button
          type="button"
          className="qosp-icon-button qosp-notification"
          aria-label={staffUiCopy(locale, "notifications")}
        >
          <Icon name="alert-circle" size={17} />
          <i aria-hidden="true" />
        </button>
        <span className="qosp-top-divider" aria-hidden="true" />

        <BusinessPicker
          locale={locale}
          tenantId={tenantId}
          tenantName={tenantName}
          tenants={tenants}
          open={openMenu === "workspace"}
          onToggle={() => setOpenMenu(openMenu === "workspace" ? null : "workspace")}
          onClose={() => setOpenMenu(null)}
          onSelect={(id) => {
            setOpenMenu(null);
            onSelectTenant(id);
          }}
        />

        <BranchPicker
          locale={locale}
          branch={branch}
          open={openMenu === "branch"}
          onToggle={() => setOpenMenu(openMenu === "branch" ? null : "branch")}
          onClose={() => setOpenMenu(null)}
          onSelect={(selection) => {
            setOpenMenu(null);
            if (selection !== branch.selection) {
              onSelectBranch?.(selection);
            }
          }}
        />

        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="qosp-avatar"
            aria-haspopup="menu"
            aria-expanded={openMenu === "profile"}
            aria-label={`${personName}, ${roleLabel}`}
            onClick={() => setOpenMenu(openMenu === "profile" ? null : "profile")}
          >
            {initials || "QO"}
          </button>
          {openMenu === "profile" ? (
            <div
              className="qos-menu"
              role="menu"
              style={{ top: 44, insetInlineEnd: 0, minWidth: 220 }}
            >
              <div className="qos-cmd-group">
                {personName} · {roleLabel}
              </div>
              <button
                type="button"
                role="menuitem"
                className="qos-menu-item"
                onClick={() => {
                  setOpenMenu(null);
                  onToggleLocale();
                }}
              >
                <Icon name="globe" size={15} />
                <span style={{ flex: 1 }}>
                  {locale === "en" ? "العربية" : "English"}
                </span>
              </button>
              <div className="qos-menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="qos-menu-item"
                onClick={() => {
                  setOpenMenu(null);
                  onSignOut();
                }}
              >
                <Icon name="log-out" size={15} />
                <span style={{ flex: 1 }}>
                  {staffUiCopy(locale, "signOut")}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/* Keeps the active destination in view when the links scroll sideways. Keyed
   on the locale too, and measured a frame later because the locale provider
   sets the document direction in its own (parent, so later) effect. */
function ActiveLinkInView({
  className,
  activeKey,
  children,
}: {
  className: string;
  activeKey: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const list = ref.current;
      const active = list?.querySelector<HTMLElement>('[data-active="true"]');
      if (!list || !active || list.scrollWidth <= list.clientWidth) {
        return;
      }
      /* Clear of the edge fade, which is as wide as the end padding. */
      const fade = parseFloat(getComputedStyle(list).paddingInlineEnd) || 0;
      const listBox = list.getBoundingClientRect();
      const box = active.getBoundingClientRect();
      if (box.left < listBox.left + fade) {
        list.scrollLeft -= listBox.left + fade - box.left;
      } else if (box.right > listBox.right - fade) {
        list.scrollLeft += box.right - (listBox.right - fade);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeKey]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/* Arrow keys, Home and End move between a listbox's options; Escape closes it
   and returns focus to its trigger; Tab closes it. */
function onListboxKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  listRef: RefObject<HTMLDivElement | null>,
  triggerRef: RefObject<HTMLButtonElement | null>,
  onClose: () => void,
) {
  const options = [
    ...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
  ];
  const index = options.indexOf(document.activeElement as HTMLElement);
  let next: number | null = null;
  if (event.key === "ArrowDown") next = (index + 1) % options.length;
  if (event.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = options.length - 1;
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    triggerRef.current?.focus();
    return;
  }
  if (event.key === "Tab") {
    onClose();
    return;
  }
  if (next !== null && options[next]) {
    event.preventDefault();
    options[next].focus();
  }
}

function useFocusSelectedOption(open: boolean, listRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const options = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    const selected = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    (selected ?? options?.[0])?.focus();
  }, [open, listRef]);
}

type BusinessPickerProps = {
  locale: StaffLocale;
  tenantId: string;
  tenantName: string;
  tenants: Array<{ id: string; name: string }>;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (tenantId: string) => void;
};

/* Business picker: the business initial tile and name. At 680px and below
   only the tile shows, and the listbox spans the narrow top bar. */
export function BusinessPicker({
  locale,
  tenantId,
  tenantName,
  tenants,
  open,
  onToggle,
  onClose,
  onSelect,
}: BusinessPickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useFocusSelectedOption(open, listRef);

  const initial = (tenantName.trim()[0] ?? "Q").toUpperCase();

  return (
    <div className="qosp-workspace-picker-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="qosp-workspace-picker"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={staffCopyWith(locale, "businessPickerLabel", { name: tenantName })}
        onClick={onToggle}
      >
        <span className="qosp-workspace-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="qosp-workspace-picker-name">
          {tenantName}
          <Icon name="chevron-down" size={14} />
        </span>
      </button>
      {open ? (
        <div
          ref={listRef}
          className="qos-menu qosp-workspace-menu"
          role="listbox"
          aria-label={staffUiCopy(locale, "switchBusiness")}
          onKeyDown={(event) => onListboxKeyDown(event, listRef, triggerRef, onClose)}
        >
          <div className="qos-cmd-group" aria-hidden="true">
            {staffUiCopy(locale, "switchBusiness")}
          </div>
          {tenants.map((tenant) => (
            <button
              key={tenant.id}
              type="button"
              role="option"
              aria-selected={tenant.id === tenantId}
              className="qos-menu-item"
              data-selected={tenant.id === tenantId || undefined}
              onClick={() => {
                onSelect(tenant.id);
                triggerRef.current?.focus();
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{tenant.name}</span>
              {tenant.id === tenantId ? <Icon name="check" size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type BranchPickerProps = {
  locale: StaffLocale;
  branch: PortalBranchState;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (selection: BranchSelection) => void;
};

/* Branch picker: the same qos-menu listbox as the business picker, with each
   branch's timezone and currency. All branches is offered only when the
   server said it is allowed. Keyboard handling is shared with the business
   picker (onListboxKeyDown). */
export function BranchPicker({ locale, branch, open, onToggle, onClose, onSelect }: BranchPickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useFocusSelectedOption(open, listRef);

  if (branch.status === "idle") {
    return null;
  }

  const selectedBranch = branch.branches.find((entry) => entry.publicId === branch.selection);
  const name = branchSelectionName(locale, branch.selection, branch.branches);
  const ready = branch.status === "ready" && name !== null;
  const label = ready
    ? name
    : staffUiCopy(
        locale,
        branch.status === "loading"
          ? "branchLoading"
          : branch.status === "error"
            ? "branchUnavailable"
            : "noBranches",
      );
  const meta = selectedBranch
    ? `${selectedBranch.timezone} · ${selectedBranch.currency}`
    : branch.selection === ALL_BRANCHES
      ? branch.baseCurrency
      : null;

  return (
    <div className="qosp-branch-picker-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="qosp-branch-picker"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          ready ? staffCopyWith(locale, "branchPickerLabel", { name: label }) : label
        }
        disabled={!ready}
        onClick={onToggle}
      >
        <Icon name="map-pin" size={15} />
        <span className="qosp-branch-picker-text">
          <span className="qosp-branch-picker-name">{label}</span>
          {ready && meta ? (
            <span className="qosp-branch-picker-meta" dir="ltr">
              {meta}
            </span>
          ) : null}
        </span>
        {ready ? <Icon name="chevron-down" size={14} /> : null}
      </button>
      {open && ready ? (
        <div
          ref={listRef}
          className="qos-menu qosp-branch-menu"
          role="listbox"
          aria-label={staffUiCopy(locale, "switchBranch")}
          onKeyDown={(event) => onListboxKeyDown(event, listRef, triggerRef, onClose)}
        >
          <div className="qosp-menu-heading" aria-hidden="true">
            {staffUiCopy(locale, "switchBranch")}
          </div>
          {branch.allBranchesAllowed ? (
            <button
              type="button"
              role="option"
              aria-selected={branch.selection === ALL_BRANCHES}
              className="qos-menu-item qosp-branch-option"
              data-selected={branch.selection === ALL_BRANCHES || undefined}
              onClick={() => {
                onSelect(ALL_BRANCHES);
                triggerRef.current?.focus();
              }}
            >
              <span className="qosp-branch-option-text">
                <span>{staffUiCopy(locale, "allBranches")}</span>
                <small>{staffUiCopy(locale, "allBranchesHint")}</small>
              </span>
              {branch.selection === ALL_BRANCHES ? <Icon name="check" size={14} /> : null}
            </button>
          ) : null}
          {branch.branches.map((entry) => (
            <button
              key={entry.publicId}
              type="button"
              role="option"
              aria-selected={entry.publicId === branch.selection}
              className="qos-menu-item qosp-branch-option"
              data-selected={entry.publicId === branch.selection || undefined}
              onClick={() => {
                onSelect(entry.publicId);
                triggerRef.current?.focus();
              }}
            >
              <span className="qosp-branch-option-text">
                <span>{entry.name}</span>
                <small>
                  <span dir="ltr">
                    {entry.timezone} · {entry.currency}
                  </span>
                  {entry.status === "suspended" ? (
                    <span className="qosp-soon-badge">
                      {branchStatusLabel(locale, entry.status)}
                    </span>
                  ) : null}
                </small>
              </span>
              {entry.publicId === branch.selection ? <Icon name="check" size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
