"use client";

import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Search, Upload } from "lucide-react";
import { useId, type ChangeEvent, type ReactNode } from "react";

import { usePortalShell } from "@/components/portal/portal-shell-context";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffCopyWith, staffUiCopy } from "@/lib/staff/locale";

/* Interior-screen building blocks from the approved portal prototype
   (content header, stat cards, filter tabs, search field, badges, notices,
   glass panels). Styles live in src/app/qos-portal-workspace.css. */

export function PortalArea({ children }: { children: ReactNode }) {
  return <div className="qosp-area">{children}</div>;
}

export function PortalPageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  meta?: ReactNode;
}) {
  const { tenantName } = usePortalShell();
  const { locale } = useStaffLocale();

  return (
    <header className="qosp-content-header">
      <div className="qosp-content-heading">
        {back ? (
          <Link className="qosp-back-link" href={back.href}>
            <ArrowLeft size={14} aria-hidden="true" className="qosp-flip-rtl" />
            {back.label}
          </Link>
        ) : (
          <p className="qosp-content-eyebrow">
            {staffCopyWith(locale, "workspaceEyebrow", { name: tenantName })}
          </p>
        )}
        <h1 className="qosp-content-title">{title}</h1>
        {description ? <p className="qosp-content-desc">{description}</p> : null}
        {meta ? <div className="qosp-content-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="qosp-header-actions">{actions}</div> : null}
    </header>
  );
}

export function PortalStatGrid({ children }: { children: ReactNode }) {
  return <div className="qosp-stats-grid">{children}</div>;
}

export function PortalStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="qosp-stat qosp-glass">
      <span className="qosp-stat-label">{label}</span>
      <strong className="qosp-stat-value">{value}</strong>
      <small className="qosp-stat-sub">{sub}</small>
    </div>
  );
}

export type PortalBadgeTone = "positive" | "warm" | "neutral" | "danger";

export function PortalBadge({
  tone = "neutral",
  children,
}: {
  tone?: PortalBadgeTone;
  children: ReactNode;
}) {
  return (
    <span className="qosp-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function PortalFilterTabs({
  label,
  tabs,
  value,
  onChange,
  controls,
}: {
  label: string;
  tabs: Array<{ id: string; label: string; count?: number }>;
  value: string;
  onChange: (id: string) => void;
  controls?: string;
}) {
  return (
    <div className="qosp-filter-tabs" role="group" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="qosp-filter-tab"
          aria-pressed={tab.id === value}
          aria-controls={controls}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count != null ? <span className="qosp-filter-count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function PortalSearchField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="qosp-search-field">
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={label}
      />
    </label>
  );
}

export function PortalToolbar({ children }: { children: ReactNode }) {
  return <div className="qosp-toolbar">{children}</div>;
}

export type PortalNoticeTone = "info" | "success" | "warning" | "error";

export function PortalNotice({
  tone = "info",
  children,
}: {
  tone?: PortalNoticeTone;
  children: ReactNode;
}) {
  return (
    <p
      className="qosp-notice"
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

export function PortalPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={["qosp-panel-glass qosp-glass", className].filter(Boolean).join(" ")}>
      {children}
    </section>
  );
}

export function PortalField({
  label,
  help,
  children,
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="qosp-field">
      <span className="qosp-field-label">{label}</span>
      {help ? <span className="qosp-field-help">{help}</span> : null}
      {children}
    </label>
  );
}

/* The native file control renders the browser's own light button, which is
   unreadable on the portal's dark glass. The input stays in the tab order and
   announces normally; only its visual is replaced. */
export function PortalFileInput({
  accept,
  disabled,
  fileName,
  onFile,
  describedBy,
}: {
  accept: string;
  disabled?: boolean;
  fileName: string | null;
  onFile: (file: File) => void;
  describedBy?: string;
}) {
  const id = useId();
  const { locale } = useStaffLocale();

  return (
    <div className="qosp-file">
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        aria-describedby={describedBy}
        className="qosp-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onFile(file);
          }
          event.target.value = "";
        }}
      />
      <label htmlFor={id} className="qosp-file-button">
        <Upload size={15} aria-hidden="true" />
        {staffUiCopy(locale, "chooseFile")}
      </label>
      <span className="qosp-file-name">
        {fileName ?? staffUiCopy(locale, "noFileChosen")}
      </span>
    </div>
  );
}

export function PortalPagination({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { locale } = useStaffLocale();
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav className="qosp-pagination" aria-label={staffUiCopy(locale, "catalogueResultsLabel")}>
      <span>{staffCopyWith(locale, "paginationRange", { from, to, total })}</span>
      <div className="qosp-pagination-buttons">
        <button
          type="button"
          className="qosp-icon-control"
          disabled={page <= 1}
          aria-label={staffUiCopy(locale, "paginationPrevious")}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={16} aria-hidden="true" className="qosp-flip-rtl" />
        </button>
        <span className="qosp-pagination-page" aria-current="page">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          className="qosp-icon-control"
          disabled={page >= pageCount}
          aria-label={staffUiCopy(locale, "paginationNext")}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={16} aria-hidden="true" className="qosp-flip-rtl" />
        </button>
      </div>
    </nav>
  );
}
