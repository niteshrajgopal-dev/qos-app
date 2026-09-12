import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Ban,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Clock,
  Contrast,
  Eye,
  EyeOff,
  HeartPulse,
  Info,
  Loader,
  Pause,
  PencilLine,
  Plug,
  Radio,
  RefreshCw,
  RefreshCwOff,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Unplug,
  UploadCloud,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import type { CSSProperties } from "react";

const ICONS: Record<string, LucideIcon> = {
  archive: Archive,
  ban: Ban,
  check: Check,
  "check-circle-2": CheckCircle2,
  "circle-dashed": CircleDashed,
  "circle-dot": CircleDot,
  "circle-half-2": Contrast,
  "circle-slash": CircleSlash,
  clock: Clock,
  eye: Eye,
  "eye-off": EyeOff,
  "heart-pulse": HeartPulse,
  info: Info,
  loader: Loader,
  pause: Pause,
  "pencil-line": PencilLine,
  plug: Plug,
  radio: Radio,
  "refresh-cw": RefreshCw,
  "refresh-cw-off": RefreshCwOff,
  "settings-2": Settings2,
  "shield-check": ShieldCheck,
  "alert-triangle": TriangleAlert,
  unplug: Unplug,
  "upload-cloud": UploadCloud,
  "wifi-off": WifiOff,
  x: X,
  "x-circle": XCircle,
  "alert-circle": CircleAlert,
};

export type IconProps = {
  /** Lucide icon name, e.g. "search", "alert-triangle". */
  name: string;
  /** px. 14 for dense UI, 16 default, 18–20 for headers. */
  size?: number;
  strokeWidth?: number;
  /** Accessible name. Omit for decorative icons (then aria-hidden). */
  label?: string;
  style?: CSSProperties;
  className?: string;
};

export function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  label,
  style,
  className,
}: IconProps) {
  const Glyph = ICONS[name];

  if (!Glyph) {
    return (
      <span
        role={label ? "img" : "presentation"}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className={className}
        data-icon={name}
        style={{
          display: "inline-block",
          width: size,
          height: size,
          flex: "none",
          ...style,
        }}
      />
    );
  }

  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      data-icon={name}
      style={style}
    />
  );
}
