/**
 * Names the AI worker image, bundle, scale query and Key Vault secrets share.
 * The Dockerfile, npm script, CI step and deploy script must use these values.
 */
export const AI_WORKER_DOCKER_TARGET = "ai-worker";
export const AI_WORKER_BUNDLE_RELATIVE = "dist/ai-worker.cjs";
export const AI_WORKER_SCALE_QUERY = "SELECT qos.count_due_ai_work()";

export const AI_WORKER_SHARED_DB_SECRETS = [
  "runtime-db-host",
  "runtime-db-port",
  "runtime-db-name",
] as const;

/** API app login. The worker and scaler must not inherit it. */
export const AI_WORKER_FORBIDDEN_API_DB_SECRETS = [
  "runtime-db-user",
  "runtime-db-password",
] as const;

export const AI_WORKER_DB_SECRETS = {
  user: "runtime-ai-worker-db-user",
  password: "runtime-ai-worker-db-password",
} as const;

export const AI_SCALER_DB_SECRETS = {
  user: "runtime-ai-scaler-db-user",
  password: "runtime-ai-scaler-db-password",
} as const;

export const AI_WORKER_REQUIRED_CAP_ENV = [
  "AI_WORKER_CONCURRENCY",
  "AI_WORKER_MAX_ACTIVE_GLOBAL",
  "AI_WORKER_MAX_ACTIVE_PER_TENANT",
  "AI_WORKER_MAX_ACTIVE_PER_KIND",
] as const;
