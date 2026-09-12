import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/db";
import {
  staffAuthAccounts,
  staffAuthSessions,
  staffAuthUsers,
  staffAuthVerifications,
} from "@/db/schema";
import { readStaffAuthConfig } from "@/lib/staff/config";

type StaffAuth = ReturnType<typeof betterAuth>;

let staffAuthInstance: StaffAuth | undefined;

export function getStaffAuth(): StaffAuth {
  if (staffAuthInstance) {
    return staffAuthInstance;
  }

  const config = readStaffAuthConfig();

  staffAuthInstance = betterAuth({
    secret: config.secret,
    baseURL: config.baseUrl,
    basePath: "/api/staff-auth",
    trustedOrigins: config.trustedOrigins,
    appName: "QOS Staff",
    advanced: {
      cookiePrefix: "qos-staff",
      database: {
        validateSchema: false,
      },
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schemaName: "qos",
      schema: {
        staff_auth_users: staffAuthUsers,
        staff_auth_sessions: staffAuthSessions,
        staff_auth_accounts: staffAuthAccounts,
        staff_auth_verifications: staffAuthVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        console.info(
          JSON.stringify({
            type: "staff_email_verification",
            userId: user.id,
            email: user.email,
            url,
          }),
        );
      },
    },
    socialProviders: {
      ...(config.googleClientId && config.googleClientSecret
        ? {
            google: {
              clientId: config.googleClientId,
              clientSecret: config.googleClientSecret,
            },
          }
        : {}),
      ...(config.microsoftClientId && config.microsoftClientSecret
        ? {
            microsoft: {
              clientId: config.microsoftClientId,
              clientSecret: config.microsoftClientSecret,
            },
          }
        : {}),
    },
    session: {
      modelName: "staff_auth_sessions",
      expiresIn: config.sessionMaxAgeSeconds,
    },
    user: {
      modelName: "staff_auth_users",
    },
    account: {
      modelName: "staff_auth_accounts",
    },
    verification: {
      modelName: "staff_auth_verifications",
    },
  }) as StaffAuth;

  return staffAuthInstance;
}
