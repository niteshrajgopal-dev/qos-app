# QOS API

Next.js API with Drizzle, PostgreSQL, Docker, and Azure Container Apps deployment.

## Endpoints

- `GET /api/health` — composite readiness (database and media storage config required). Used by deploy scripts.
- `GET /api/health/live` — process liveness. Does not touch the database.
- `GET /api/health/ready` — readiness. Returns 503 if PostgreSQL is unreachable or media storage is misconfigured in production/ACA. Includes `mediaStorage: "local" | "azure-blob"` (no secrets). Does not leak internals.

## Local development

```bash
npm install
cp .env.example .env
docker compose up db -d
npm run db:push
npm run dev
```

Quality gates:

```bash
npm run check
```

That runs typecheck, lint, and unit tests. Individual commands: `npm run typecheck`, `npm run lint`, `npm test`.

## Docker

```bash
docker compose up --build
```

## Database

- Local iteration: `npm run db:push`
- Versioned schema changes: edit `src/db/schema.ts`, then `npm run db:generate` and commit the SQL under `drizzle/`
- Apply committed migrations: `npm run db:migrate`

## Azure deployment

Image: `qosdevacr.azurecr.io/qos-api:0.1`  
Container App: `ca-qos-dev-api` in `rg-qos-dev-core`

Probes: liveness → `/api/health/live`, readiness and startup → `/api/health/ready`.

### Product media storage

Local development and tests use the default `MEDIA_STORAGE=local` backend, writing under `MEDIA_LOCAL_ROOT` (default `.local-media`). Unset `MEDIA_STORAGE` is a local/dev/test default only.

On Azure Container Apps (`CONTAINER_APP_NAME`) or `NODE_ENV=production`, unset `MEDIA_STORAGE` fails readiness (`GET /api/health/ready`) with a clear error listing the required env vars. `MEDIA_STORAGE=azure-blob` still throws at boot if the account URL / connection string is missing — there is no silent fallback to local disk. `next build` is exempt so image builds do not need blob credentials.

Azure Container Apps replicas share no local disk. Set durable blob storage so every replica reads the same bytes:

```bash
MEDIA_STORAGE=azure-blob
MEDIA_AZURE_BLOB_CONNECTION_STRING="<storage-account-connection-string>"
# or MEDIA_AZURE_BLOB_ACCOUNT_URL=https://<account>.blob.core.windows.net
MEDIA_AZURE_BLOB_PRIVATE_CONTAINER=media-private
MEDIA_AZURE_BLOB_PUBLIC_CONTAINER=media-public
# optional path prefix inside both containers
# MEDIA_AZURE_BLOB_PREFIX=dev
```

Private uploads and public derivatives mirror the local layout as `private/...` and `public/...` blob names (with optional prefix). After switching from ephemeral local storage, re-ingest HBZ images onto blob with a fresh idempotency key — do not clear `primaryMediaAssetId` by hand:

```bash
npm run import:quotes-hbz-finedine -- --live --force-image-reingest --idempotency-key=hbz-blob-$(date +%s)
npm run approve-publish:quotes-hbz-finedine
```

`--force-image-reingest` treats FineDine HBZ products as needing image ingest even when `primaryMediaAssetId` is already set. Empty FineDine `image_url` rows (Flatwhite and similar) are still skipped. Use `--help` on the import script for the full flag list.

### Product video worker

Uploaded product MP4s are processed off the request path by a separate worker (`scripts/video-worker.ts`) that runs `ffprobe`/`ffmpeg`. Locally it needs both on `PATH` (Windows: `winget install Gyan.FFmpeg`):

```powershell
npm run worker:video
```

How jobs move:

- The worker claims through `qos.claim_next_video_processing_job` (migration 0035), a `SECURITY DEFINER` function, so it runs as `qos_app` like the API. All other reads/writes use tenant context.
- **Fairness:** the tenant served least recently goes first, and no tenant holds more than `VIDEO_MAX_ACTIVE_JOBS_PER_TENANT` (default 1) worker slots, so one tenant's backlog cannot starve others.
- **Invalid uploads** (limits, codec, undecodable) are `rejected` on the first attempt. **Transient failures** (storage errors, ffmpeg timeouts/kills) are re-queued with exponential backoff (`VIDEO_RETRY_BACKOFF_MS × 2^(n-1)`) and `quarantined` after `VIDEO_MAX_RETRIES`.
- **Crash recovery:** each claim holds a lease (`VIDEO_JOB_LEASE_MS`, default job timeout + 2 min). An expired lease is re-queued on the next claim and counts as an attempt; a stale worker finishing late cannot overwrite the new owner's result.
- Logs are one JSON object per line: `video_worker.boot`, `job_started`, `job_succeeded`, `job_failed` (with `correlationId`, `retryable`, `message`).

Deploying to Azure (one-time create, then the same command for updates):

```powershell
# 1. Apply migration 0035 to the target database first.
# 2. Build the worker image (Dockerfile target `worker` = Node 22 + ffmpeg)
.\deploy\build-and-push-to-acr.cmd -ImageName qos-video-worker -ImageTag 0.1.0 -Target worker
# 3. Create/update ca-qos-dev-video-worker (no ingress). Copies DB/blob
#    Key Vault references and MEDIA_* settings from ca-qos-dev-api.
.\deploy\deploy-video-worker.cmd -ImageTag 0.1.0
```

By default the worker **scales to zero** (0.5 vCPU / 1 GiB, max 1 replica): a KEDA `postgresql` scale rule polls `qos.count_active_video_processing_jobs()` about every 30 s and starts a replica when a job is due, keeping it up while jobs are in flight. Idle cost is ~0; the first job after a quiet period waits ~30–60 s for a cold start. `-AlwaysOn` keeps one replica running instead (roughly $12/month idle at 0.5 vCPU / 1 GiB).

The API image is unchanged: `build-and-push-to-acr.cmd` without `-Target` still builds the last Dockerfile stage (the API).

```powershell
# Build image in ACR and push
.\deploy\build-and-push-to-acr.cmd

# Deploy image from ACR to Container Apps
.\deploy\deploy-to-acr.cmd -WaitForHealth
```

The `.cmd` wrappers bypass a Restricted PowerShell execution policy. If you prefer to run `.ps1` files directly (and `npm` without calling `npm.cmd`):

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Or manually:

```bash
az acr build --registry qosdevacr --image qos-api:0.1 .
az containerapp update \
  --name ca-qos-dev-api \
  --resource-group rg-qos-dev-core \
  --image qosdevacr.azurecr.io/qos-api:0.1
```
