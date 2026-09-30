"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "qos-motion";

const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getSnapshot() {
  return window.localStorage.getItem(STORAGE_KEY) !== "off";
}

function getServerSnapshot() {
  return true;
}

/* The preference lives in localStorage, and on <html> so it also reaches dialogs
   and drawers rendered through portals. */
export function useAmbientMotion() {
  const motion = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    document.documentElement.dataset.qosMotion = motion ? "on" : "off";
  }, [motion]);

  const toggleMotion = useCallback(() => {
    window.localStorage.setItem(STORAGE_KEY, getSnapshot() ? "off" : "on");
    for (const listener of listeners) {
      listener();
    }
  }, []);

  return { motion, toggleMotion };
}
