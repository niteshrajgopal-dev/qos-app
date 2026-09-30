"use client";

import { useCallback, useEffect, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type ResourceState<T> = {
  url: string | null;
  data: T | null;
  error: string | null;
};

export function useStaffResource<T>(url: string | null, fallbackError: string) {
  const [state, setState] = useState<ResourceState<T>>({
    url: null,
    data: null,
    error: null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!url) {
      return;
    }

    let cancelled = false;

    staffApiFetch(url)
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as T & {
          error?: string;
        };

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setState({ url, data: null, error: payload.error ?? fallbackError });
          return;
        }

        setState({ url, data: payload, error: null });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ url, data: null, error: fallbackError });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url, version, fallbackError]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const current = state.url === url;

  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: Boolean(url) && (!current || (state.data === null && state.error === null)),
    reload,
  };
}
