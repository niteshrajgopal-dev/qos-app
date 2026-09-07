# QOS API

Next.js API with Drizzle, PostgreSQL, Docker, and Azure Container Apps deployment.

## Endpoints

- `GET /api/health` — composite readiness (database required). Used by deploy scripts.
- `GET /api/health/live` — process liveness. Does not touch the database.
- `GET /api/health/ready` — readiness. Returns 503 if PostgreSQL is unreachable. Does not leak internals.

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

```powershell
# Build image in ACR and push
.\deploy\build-and-push-to-acr.ps1

# Deploy image from ACR to Container Apps
.\deploy\deploy-to-acr.ps1 -WaitForHealth
```

Or manually:

```bash
az acr build --registry qosdevacr --image qos-api:0.1 .
az containerapp update \
  --name ca-qos-dev-api \
  --resource-group rg-qos-dev-core \
  --image qosdevacr.azurecr.io/qos-api:0.1
```
