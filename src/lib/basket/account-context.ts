import { CustomerBasketError } from "@/lib/basket/customer-basket";
import type { BasketContextInput } from "@/lib/basket/customer-basket";

export function readAccountBasketContextFromRequest(
  request: Request,
): BasketContextInput {
  const url = new URL(request.url);

  const storefrontPublicId = url.searchParams.get("storefrontPublicId")?.trim();
  const locationPublicId = url.searchParams.get("locationPublicId")?.trim();
  const locale = url.searchParams.get("locale");

  if (!storefrontPublicId) {
    throw new CustomerBasketError(
      "storefrontPublicId query parameter is required.",
      400,
      "storefrontPublicId",
    );
  }

  if (!locationPublicId) {
    throw new CustomerBasketError(
      "locationPublicId query parameter is required.",
      400,
      "locationPublicId",
    );
  }

  return {
    storefrontPublicId,
    locationPublicId,
    locale,
  };
}

export function readOptionalAccountBasketContextFromRequest(
  request: Request,
): BasketContextInput | undefined {
  const url = new URL(request.url);
  const storefrontPublicId = url.searchParams.get("storefrontPublicId")?.trim();
  const locationPublicId = url.searchParams.get("locationPublicId")?.trim();

  if (!storefrontPublicId || !locationPublicId) {
    return undefined;
  }

  return {
    storefrontPublicId,
    locationPublicId,
    locale: url.searchParams.get("locale"),
  };
}
