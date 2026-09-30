"use client";

import { useEffect, useRef } from "react";

type PortalSceneProps = {
  /** Pointer parallax is skipped on touch, on reduced motion, and when paused. */
  motion: boolean;
};

/* Fixed full-bleed artwork behind the whole staff app: a 22s dolly over a still
   image, an 11s light breath, and pointer parallax of 10px x / 8px y eased over
   1.6s — the values from the approved prototype. Purely decorative. */
export function PortalScene({ motion }: PortalSceneProps) {
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !motion) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    if (window.matchMedia("(hover: none)").matches) {
      return;
    }

    function onPointerMove(event: PointerEvent) {
      if (!scene) {
        return;
      }

      const x = (event.clientX / window.innerWidth - 0.5) * 10;
      const y = (event.clientY / window.innerHeight - 0.5) * 8;
      scene.style.setProperty("--qosp-mx", `${x.toFixed(2)}px`);
      scene.style.setProperty("--qosp-my", `${y.toFixed(2)}px`);
    }

    window.addEventListener("pointermove", onPointerMove);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      scene.style.removeProperty("--qosp-mx");
      scene.style.removeProperty("--qosp-my");
    };
  }, [motion]);

  return (
    <>
      <div className="qosp-scene" ref={sceneRef} aria-hidden="true">
        <div className="qosp-scene-image" />
        <div className="qosp-scene-light" />
      </div>
      <div className="qosp-scene-shade" aria-hidden="true" />
    </>
  );
}
