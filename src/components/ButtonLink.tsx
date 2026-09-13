import Link from "next/link";
import type { ReactNode } from "react";

import type { ButtonVariant } from "@/components/Button";
import { Icon } from "@/components/Icon";

type ButtonLinkProps = {
  href: string;
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: string;
  fullWidth?: boolean;
};

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  icon,
  fullWidth = false,
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className="qos-btn"
      data-variant={variant}
      data-size={size === "md" ? undefined : size}
      data-full={fullWidth || undefined}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </Link>
  );
}
