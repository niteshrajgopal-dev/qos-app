# QOS API Deployment Plan

**Status:** Ready for Validation  
**Created:** 2026-09-06  
**Subscription:** QOS Development (`164f1f74-6340-4704-ab96-3224a3552606`)  
**Location:** UAE North (`uaenorth`)

## 1. Overview

Next.js API with Prisma + PostgreSQL, containerized and deployed to existing Azure Container Apps infrastructure, replacing the hello-world sample image.

## 2. Mode

**MODIFY** — Deploy new application image to existing Azure resources.

## 3. Architecture

| Component | Azure Service | Existing Resource |
|-----------|---------------|-------------------|
| API | Container Apps | `ca-qos-dev-api` |
| Container Registry | ACR | `qosdevacr.azurecr.io` |
| Database | PostgreSQL Flexible Server | `psql-qos-dev` |
| Secrets | Key Vault | `kv-qos-dev` |
| Environment | Container Apps Environment | `cae-qos-dev` |

## 4. Recipe

**Type:** AZCLI (update existing Container App)

- Build Docker image locally via `az acr build`
- Push as `qosdevacr.azurecr.io/qos-api:0.1`
- Update `ca-qos-dev-api` to use new image on port 3000
- HTTP health probes on `/api/health`

## 5. Environment Variables (from Key Vault)

| Env Var | Secret |
|---------|--------|
| `DB_HOST` | `postgres-host` |
| `DB_PORT` | `postgres-port` |
| `DB_NAME` | `postgres-database` |
| `DB_USER` | `postgres-admin-user` |
| `DB_PASSWORD` | `postgres-admin-password` |

Prisma `DATABASE_URL` is constructed at runtime from these variables.

## 6. Deployment Steps

- [x] Scaffold Next.js + TypeScript
- [x] Add Prisma + PostgreSQL schema
- [x] Add `/api/health` endpoint
- [x] Create Dockerfile + docker-compose
- [x] Build and push `qos-api:0.1` to ACR
- [x] Update Container App image and probes
- [x] Verify `/api/health` endpoint

## 7. Validation Proof

**Validated:** 2026-09-06T08:28:28Z

```bash
az acr repository show-tags --name qosdevacr --repository qos-api
# 0.1

az containerapp revision list --name ca-qos-dev-api --resource-group rg-qos-dev-core
# ca-qos-dev-api--0000004 — Healthy, 100% traffic

curl https://ca-qos-dev-api.gentleplant-cc8574e8.uaenorth.azurecontainerapps.io/api/health
# {"status":"healthy","service":"qos-api","database":"connected",...}
```
