import React from "react";
import { Badge } from "./Badge.jsx";

/* The canonical QOS state vocabulary. State is never communicated by colour alone:
   every entry carries a label and an icon (or a dot plus label). */
export const QOS_STATES = {
  live: { tone: "success", icon: "radio", label: "Live" },
  active: { tone: "success", icon: "check-circle-2", label: "Active" },
  published: { tone: "success", icon: "check-circle-2", label: "Published" },
  connected: { tone: "success", icon: "plug", label: "Connected" },
  synced: { tone: "success", icon: "refresh-cw", label: "Synced" },
  healthy: { tone: "success", icon: "heart-pulse", label: "Healthy" },
  verified: { tone: "success", icon: "shield-check", label: "Verified" },
  approved: { tone: "success", icon: "check", label: "Approved" },

  draft: { tone: "neutral", icon: "pencil-line", label: "Draft" },
  unpublished: { tone: "neutral", icon: "eye-off", label: "Unpublished" },
  archived: { tone: "neutral", icon: "archive", label: "Archived" },
  disconnected: { tone: "neutral", icon: "unplug", label: "Disconnected" },
  available: { tone: "neutral", icon: "circle-dashed", label: "Available" },
  inactive: { tone: "neutral", icon: "circle-slash", label: "Inactive" },

  paused: { tone: "warning", icon: "pause", label: "Paused" },
  warning: { tone: "warning", icon: "alert-triangle", label: "Warning" },
  out_of_sync: { tone: "warning", icon: "refresh-cw-off", label: "Out of sync" },
  config_required: { tone: "warning", icon: "settings-2", label: "Configuration required" },
  unsaved: { tone: "warning", icon: "circle-dot", label: "Unsaved changes" },
  suspended: { tone: "warning", icon: "ban", label: "Suspended" },
  pending: { tone: "warning", icon: "clock", label: "Pending" },
  partial: { tone: "warning", icon: "circle-half-2", label: "Partial" },

  error: { tone: "error", icon: "alert-circle", label: "Error" },
  failed: { tone: "error", icon: "x-circle", label: "Failed" },
  rejected: { tone: "error", icon: "x", label: "Rejected" },
  offline: { tone: "error", icon: "wifi-off", label: "Offline" },

  processing: { tone: "processing", icon: "loader", label: "Processing" },
  syncing: { tone: "processing", icon: "refresh-cw", label: "Syncing" },
  provisioning: { tone: "processing", icon: "loader", label: "Provisioning" },
  publishing: { tone: "processing", icon: "upload-cloud", label: "Publishing" },

  preview: { tone: "info", icon: "eye", label: "Preview" },
  info: { tone: "info", icon: "info", label: "Info" },
};

export function StatusBadge({ state, label, ...rest }) {
  const cfg = QOS_STATES[state] || QOS_STATES.info;
  return <Badge tone={cfg.tone} icon={cfg.icon} {...rest}>{label || cfg.label}</Badge>;
}
