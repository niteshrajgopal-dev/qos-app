import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArrowRight,
  Ban,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Clock,
  Contrast,
  Eye,
  EyeOff,
  Globe,
  HeartPulse,
  Info,
  LayoutDashboard,
  Loader,
  LogOut,
  MapPin,
  Package,
  Pause,
  PencilLine,
  Plug,
  Radio,
  Receipt,
  RefreshCw,
  RefreshCwOff,
  Search,
  Settings,
  Settings2,
  ShieldCheck,
  Store,
  TriangleAlert,
  Unplug,
  UploadCloud,
  Users,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import type { CSSProperties } from "react";

const ICONS: Record<string, LucideIcon> = {
  archive: Archive,
  "arrow-right": ArrowRight,
  ban: Ban,
  "bar-chart-3": BarChart3,
  "book-open": BookOpen,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  check: Check,
  "check-circle-2": CheckCircle2,
  "circle-dashed": CircleDashed,
  "circle-dot": CircleDot,
  "circle-half-2": Contrast,
  "circle-slash": CircleSlash,
  clock: Clock,
  eye: Eye,
  "eye-off": EyeOff,
  globe: Globe,
  "heart-pulse": HeartPulse,
  info: Info,
  "layout-dashboard": LayoutDashboard,
  loader: Loader,
  "log-out": LogOut,
  "map-pin": MapPin,
  package: Package,
  pause: Pause,
  "pencil-line": PencilLine,
  plug: Plug,
  radio: Radio,
  receipt: Receipt,
  search: Search,
  "refresh-cw": RefreshCw,
  "refresh-cw-off": RefreshCwOff,
  settings: Settings,
  "settings-2": Settings2,
  "shield-check": ShieldCheck,
  store: Store,
  "alert-triangle": TriangleAlert,
  unplug: Unplug,
  users: Users,
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
