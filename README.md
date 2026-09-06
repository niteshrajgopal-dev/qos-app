# QOS API

Next.js API with Drizzle, PostgreSQL, Docker, and Azure Container Apps deployment.

## Endpoints

- `GET /api/health` — health check with database connectivity

## Local development

```bash
npm install
cp .env.example .env
docker compose up db -d
npm run db:push
npm run dev
```

## Docker

```bash
docker compose up --build
```

## Azure deployment

Image: `qosdevacr.azurecr.io/qos-api:0.1`  
Container App: `ca-qos-dev-api` in `rg-qos-dev-core`

```bash
az acr build --registry qosdevacr --image qos-api:0.1 .
az containerapp update \
  --name ca-qos-dev-api \
  --resource-group rg-qos-dev-core \
  --image qosdevacr.azurecr.io/qos-api:0.1
```
