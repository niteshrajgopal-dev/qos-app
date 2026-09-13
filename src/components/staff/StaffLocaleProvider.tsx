"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  isStaffLocale,
  STAFF_LOCALE_STORAGE_KEY,
  staffDocumentDirection,
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
  const [locale, setLocaleState] = useState<StaffLocale>("en");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STAFF_LOCALE_STORAGE_KEY);
    if (isStaffLocale(stored)) {
      setLocaleState(stored);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    document.documentElement.lang = locale;
    document.documentElement.dir = staffDocumentDirection(locale);
    window.localStorage.setItem(STAFF_LOCALE_STORAGE_KEY, locale);
  }, [hydrated, locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale: setLocaleState,
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
