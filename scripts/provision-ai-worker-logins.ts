/**
 * Creates or rotates the AI worker and scaler database logins. Passwords come
 * from the environment and are never printed. The deploy wrapper stores them
 * in Key Vault.
 *
 * Connects as the migrator (qosadmin on Azure) via DATABASE_ADMIN_URL.
 */

import { createAdminDbClient } from "@/db/client";
import { AI_SCALER_LOGIN, AI_WORKER_LOGIN, provisionAiWorkerLogin } from "@/lib/ai/jobs/worker-logins";

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function main() {
  const workerPassword = requiredEnv("QOS_AI_WORKER_LOGIN_PASSWORD");
  const scalerPassword = requiredEnv("QOS_AI_SCALER_LOGIN_PASSWORD");
  const { sql } = createAdminDbClient();
  try {
    await provisionAiWorkerLogin(sql, AI_WORKER_LOGIN, workerPassword);
    await provisionAiWorkerLogin(sql, AI_SCALER_LOGIN, scalerPassword);
    console.log(`provisioned ${AI_WORKER_LOGIN.login} and ${AI_SCALER_LOGIN.login}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
