import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/db";
import {
  customerAuthAccounts,
  customerAuthSessions,
  customerAuthUsers,
  customerAuthVerifications,
} from "@/db/schema";
import { readCustomerAuthConfig } from "@/lib/customer/config";

type CustomerAuth = ReturnType<typeof betterAuth>;

let customerAuthInstance: CustomerAuth | undefined;

export function getCustomerAuth(): CustomerAuth {
  if (customerAuthInstance) {
    return customerAuthInstance;
  }

  const config = readCustomerAuthConfig();

  customerAuthInstance = betterAuth({
    secret: config.secret,
    baseURL: config.baseUrl,
    trustedOrigins: config.trustedOrigins,
    appName: "QOS Storefront",
    advanced: {
      database: {
        validateSchema: false,
      },
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schemaName: "qos",
      schema: {
        customer_auth_users: customerAuthUsers,
        customer_auth_sessions: customerAuthSessions,
        customer_auth_accounts: customerAuthAccounts,
        customer_auth_verifications: customerAuthVerifications,
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
            type: "customer_email_verification",
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
      modelName: "customer_auth_sessions",
      expiresIn: config.sessionMaxAgeSeconds,
    },
    user: {
      modelName: "customer_auth_users",
    },
    account: {
      modelName: "customer_auth_accounts",
    },
    verification: {
      modelName: "customer_auth_verifications",
    },
  }) as CustomerAuth;

  return customerAuthInstance;
}

export type CustomerAuthSession = Awaited<
  ReturnType<CustomerAuth["api"]["getSession"]>
>;
