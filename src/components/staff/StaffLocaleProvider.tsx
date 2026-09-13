"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  readStoredStaffLocale,
  setStoredStaffLocale,
  staffDocumentDirection,
  subscribeStaffLocale,
  type StaffLocale,
} from "@/lib/staff/locale";

type StaffLocaleContextValue = {
  locale: StaffLocale;
  setLocale: (locale: StaffLocale) => void;
};

const StaffLocaleContext = createContext<StaffLocaleContextValue>({
  locale: "en",
  setLocale: () => undefined,
});

export function StaffLocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(
    subscribeStaffLocale,
    readStoredStaffLocale,
    (): StaffLocale => "en",
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = staffDocumentDirection(locale);
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale: setStoredStaffLocale,
    }),
    [locale],
  );

  return (
    <StaffLocaleContext.Provider value={value}>
      {children}
    </StaffLocaleContext.Provider>
  );
}

export function useStaffLocale() {
  return useContext(StaffLocaleContext);
}
