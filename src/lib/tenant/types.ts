export type BusinessProfile = "hospitality" | "generic_retail";

export type StaffRole = "administrator" | "user";

export type CreateTenantHierarchyInput = {
  tenant: {
    publicId: string;
    name: string;
    businessProfile: BusinessProfile;
    baseCurrency: string;
    defaultLocale: string;
    defaultTimezone: string;
    supportedLocales?: string[];
  };
  organization: {
    publicId: string;
    name: string;
  };
  brand: {
    publicId: string;
    name: string;
  };
  location: {
    publicId: string;
    name: string;
    slug: string;
    timezone: string;
  };
};

export class TenantValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantValidationError";
  }
}
