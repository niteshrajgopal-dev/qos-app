"use client";

import { useEffect, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { isOverlayDismissKey } from "@/lib/staff/overlay";

type OverlaySurfaceProps = {
  className: string;
  onClose?: () => void;
  children: ReactNode;
};

export function OverlaySurface({
  className,
  onClose,
  children,
}: OverlaySurfaceProps) {
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (isOverlayDismissKey(event.key)) {
        event.preventDefault();
        onClose?.();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleScrimClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  }

  function handleScrimKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isOverlayDismissKey(event.key)) {
      event.preventDefault();
      onClose?.();
    }
  }

  return (
    <div
      className={className}
      role="presentation"
      onClick={handleScrimClick}
      onKeyDown={handleScrimKeyDown}
    >
      {children}
    </div>
  );
}
