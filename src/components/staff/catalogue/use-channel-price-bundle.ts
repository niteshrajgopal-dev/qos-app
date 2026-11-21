"use client";

import { useCallback, useEffect, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type ApiPayload<T> = { channelPrices?: T; channel?: unknown; error?: string };

/**
 * Loads a channel-price bundle (product variants or modifier-group options)
 * and runs set, reset and add-channel calls against the real catalogue API.
 * `refreshKey` reloads the bundle when the editor saved a base price.
 */
export function useChannelPriceBundle<T>(loadUrl: string, refreshKey: unknown, loadErrorText: string) {
  const [bundle, setBundle] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const response = await staffApiFetch(loadUrl);
      const payload = (await response.json()) as ApiPayload<T>;
      if (!response.ok || !payload.channelPrices) {
        throw new Error(payload.error ?? loadErrorText);
      }
      setBundle(payload.channelPrices);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : loadErrorText);
    }
  }, [loadErrorText, loadUrl]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload, refreshKey]);

  const mutate = useCallback(
    async (url: string, init: RequestInit, failureText: string, successText: string, reloadAfter = false) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const response = await staffApiFetch(url, init);
        const payload = (await response.json()) as ApiPayload<T>;
        if (!response.ok) {
          throw new Error(payload.error ?? failureText);
        }
        if (payload.channelPrices) {
          setBundle(payload.channelPrices);
        }
        if (reloadAfter) {
          await reload();
        }
        setMessage(successText);
        return true;
      } catch (mutationError) {
        setError(mutationError instanceof Error ? mutationError.message : failureText);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  return { bundle, error, message, busy, reload, mutate };
}
