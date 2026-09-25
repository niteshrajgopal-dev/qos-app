"use client";

import {
  BLOCKS,
  CHANNELS,
  INTEGRATIONS,
  LOCATIONS,
  NAV,
  ORDERS,
  ORDER_TREND,
  PRODUCTS,
  RELEASES,
  REVENUE_TREND,
  TENANTS,
} from "@/mocks/platform";

export function usePlatformData() {
  return {
    BLOCKS,
    CHANNELS,
    INTEGRATIONS,
    LOCATIONS,
    NAV,
    ORDERS,
    ORDER_TREND,
    PRODUCTS,
    RELEASES,
    REVENUE_TREND,
    TENANTS,
  };
}

export type PlatformData = ReturnType<typeof usePlatformData>;
