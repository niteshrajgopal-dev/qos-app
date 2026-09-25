import { existsSync } from "node:fs";

import { createDbClient } from "@/db/client";
import { getCustomerAuth } from "@/lib/customer/auth-server";
import {
  ensureQuotesCheckoutTester,
  QUOTES_CHECKOUT_TESTER,
} from "@/lib/seed/quotes-checkout-tester";

if (existsSync(".env") && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env");
}

async function main() {
  const { db, sql } = createDbClient();

  try {
    const seeded = await ensureQuotesCheckoutTester(db);
    const auth = getCustomerAuth();
    const signedIn = await auth.api.signInEmail({
      body: {
        email: QUOTES_CHECKOUT_TESTER.email,
        password: QUOTES_CHECKOUT_TESTER.password,
        rememberMe: true,
      },
    });

    console.log(
      JSON.stringify(
        {
          email: seeded.email,
          displayName: seeded.displayName,
          role: seeded.role,
          status: seeded.status,
          emailVerified: seeded.emailVerified,
          created: seeded.created,
          storefrontPublicId: seeded.storefrontPublicId,
          associationStatus: seeded.associationStatus,
          signedIn: signedIn.user.email === seeded.email && signedIn.user.emailVerified === true,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const isDirectRun = process.argv[1]?.replaceAll("\\", "/").includes(
  "scripts/seed-quotes-checkout-tester",
);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
