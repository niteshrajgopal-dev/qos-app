#Requires -Version 5.1
<#
.SYNOPSIS
  Create or update the AI worker Container App. Packaging only; does not
  switch AI photo execution to the worker or set a spend policy.

.DESCRIPTION
  Runs the `ai-worker` Dockerfile target with no ingress. The process connects
  as qos_ai_worker_login (granted only qos_ai_worker). KEDA polls
  qos.count_due_ai_work() as qos_ai_scaler_login (granted only qos_ai_scaler).
  Neither login is the API's qos_app credential.

  Shared host/name/port and media/OpenAI settings are copied from the API app.
  Worker and scaler login secrets must already exist in Key Vault (see
  deploy/provision-ai-worker-logins.cmd). Worker concurrency caps are owner
  decisions and have no defaults.

  Prerequisites:
    1. Migrations 0039-0043 applied.
    2. Worker and scaler logins provisioned.
    3. Image built:
       .\deploy\build-and-push-to-acr.cmd -ImageName qos-ai-worker -ImageTag <tag> -Target ai-worker

.EXAMPLE
  .\deploy\deploy-ai-worker.cmd -ImageTag 33d5fd5b0da4 -Concurrency 8 -MaxActiveGlobal 8 -MaxActivePerTenant 3 -MaxActivePerKind 8
#>
[CmdletBinding()]
param(
    [string] $RegistryName = "qosdevacr",
    [string] $ResourceGroup = "rg-qos-dev-core",
    [string] $EnvironmentName = "cae-qos-dev",
    [string] $ContainerAppName = "ca-qos-dev-ai-worker",
    [string] $ApiContainerAppName = "ca-qos-dev-api",
    [string] $KeyVaultName = "kv-qos-dev-runtime",
    [string] $StorageAccountName = "stqosdev",
    [string] $ImageName = "qos-ai-worker",
    [Parameter(Mandatory = $true)]
    [string] $ImageTag,
    [Parameter(Mandatory = $true)]
    [int] $Concurrency,
    [Parameter(Mandatory = $true)]
    [int] $MaxActiveGlobal,
    [Parameter(Mandatory = $true)]
    [int] $MaxActivePerTenant,
    [Parameter(Mandatory = $true)]
    [int] $MaxActivePerKind,
    [string] $Cpu = "0.5",
    [string] $Memory = "1Gi",
    [int] $MaxReplicas = 1,
    [switch] $AlwaysOn,
    [int] $TerminationGracePeriodSeconds = 300
)

$ErrorActionPreference = "Stop"

foreach ($cap in @($Concurrency, $MaxActiveGlobal, $MaxActivePerTenant, $MaxActivePerKind)) {
    if ($cap -lt 1 -or $cap -gt 1000) {
        throw "Worker caps must be integers from 1 to 1000."
    }
}

$sharedSecretNames = @(
    "runtime-db-host",
    "runtime-db-port",
    "runtime-db-name",
    "media-blob-conn",
    "openai-api-key"
)

$dedicatedSecretNames = @(
    "runtime-ai-worker-db-user",
    "runtime-ai-worker-db-password",
    "runtime-ai-scaler-db-user",
    "runtime-ai-scaler-db-password"
)

$secretEnv = [ordered]@{
    DB_HOST                            = "runtime-db-host"
    DB_PORT                            = "runtime-db-port"
    DB_NAME                            = "runtime-db-name"
    DB_USER                            = "runtime-ai-worker-db-user"
    DB_PASSWORD                        = "runtime-ai-worker-db-password"
    MEDIA_AZURE_BLOB_CONNECTION_STRING = "media-blob-conn"
    OPENAI_API_KEY                     = "openai-api-key"
}

$copiedPlainEnv = @(
    "MEDIA_STORAGE",
    "MEDIA_AZURE_BLOB_ACCOUNT_URL",
    "MEDIA_AZURE_BLOB_PRIVATE_CONTAINER",
    "MEDIA_AZURE_BLOB_PUBLIC_CONTAINER",
    "AI_PHOTOS_ENABLED",
    "AI_PHOTO_PROVIDER",
    "AI_PHOTO_MODEL",
    "AI_PHOTO_QUALITY",
    "AI_PHOTO_DAILY_LIMIT_PER_TENANT",
    "AI_PHOTO_REQUEST_TIMEOUT_MS",
    "AI_PHOTO_QUEUED_STALE_MS"
)

function Invoke-Az {
    param([string[]] $Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & az @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }

    if ($exitCode -ne 0) {
        throw "az $($Arguments[0..2] -join ' ') failed ($exitCode): $($output -join "`n")"
    }

    return ($output | Where-Object { $_ -is [string] }) -join "`n"
}

function Assert-AzCli {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        throw "Azure CLI (az) is not installed or not on PATH."
    }

    $account = az account show -o json 2>$null | ConvertFrom-Json
    if (-not $account) {
        throw "Not logged in to Azure. Run 'az login' first."
    }

    Write-Host "Subscription: $($account.name) ($($account.id))"
}

function Get-ContainerApp {
    param([string] $Name)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $json = az containerapp show --name $Name --resource-group $ResourceGroup -o json 2>$null
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }

    if ($exitCode -ne 0 -or -not $json) {
        return $null
    }

    return ($json | Out-String | ConvertFrom-Json)
}

function Grant-Role {
    param([string] $PrincipalId, [string] $Role, [string] $Scope)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $existing = az role assignment list --assignee $PrincipalId --role $Role --scope $Scope --query "[0].id" -o tsv 2>$null
    }
    finally {
        $ErrorActionPreference = $previous
    }
    if ($existing) {
        Write-Host "  $Role already assigned."
        return
    }

    Invoke-Az @(
        "role", "assignment", "create",
        "--assignee-object-id", $PrincipalId,
        "--assignee-principal-type", "ServicePrincipal",
        "--role", $Role,
        "--scope", $Scope,
        "--only-show-errors", "-o", "none"
    ) | Out-Null
    Write-Host "  $Role assigned."
}

function Get-KeyVaultSecretUri {
    param([string] $Name)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $id = az keyvault secret show --vault-name $KeyVaultName --name $Name --query id -o tsv 2>$null
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    if ($exitCode -ne 0 -or -not $id) {
        throw "Key Vault '$KeyVaultName' has no secret '$Name'. Run deploy/provision-ai-worker-logins.cmd first."
    }
    return ($id.Trim() -replace '/[0-9a-f]{32}$', '')
}

$image = "$RegistryName.azurecr.io/${ImageName}:${ImageTag}"
Write-Host "Deploying $image to '$ContainerAppName' (no ingress)"
Assert-AzCli

$api = Get-ContainerApp -Name $ApiContainerAppName
if (-not $api) {
    throw "API Container App '$ApiContainerAppName' not found; it is the source of shared settings."
}

$apiSecrets = @{}
foreach ($secret in $api.properties.configuration.secrets) {
    $apiSecrets[$secret.name] = $secret.keyVaultUrl
}
foreach ($name in $sharedSecretNames) {
    if (-not $apiSecrets[$name]) {
        throw "API app has no Key Vault reference for secret '$name'."
    }
}

$apiEnv = @{}
foreach ($entry in $api.properties.template.containers[0].env) {
    if ($null -ne $entry.value) {
        $apiEnv[$entry.name] = $entry.value
    }
}
if (-not $apiEnv["MEDIA_STORAGE"]) {
    throw "API app has no MEDIA_STORAGE value; the worker refuses to boot without it."
}

$worker = Get-ContainerApp -Name $ContainerAppName
if (-not $worker) {
    Write-Host "Creating '$ContainerAppName' (scaled to zero until secrets are wired)..."
    $subscriptionId = (az account show --query id -o tsv).Trim()
    $environmentId = "/subscriptions/$subscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.App/managedEnvironments/$EnvironmentName"
    $location = (az group show --name $ResourceGroup --query location -o tsv).Trim()
    $createBody = @{
        location   = $location
        identity   = @{ type = "SystemAssigned" }
        properties = @{
            managedEnvironmentId = $environmentId
            workloadProfileName  = "Consumption"
            configuration        = @{
                activeRevisionsMode = "Single"
                registries          = @(
                    @{
                        server   = "$RegistryName.azurecr.io"
                        identity = "system-environment"
                    }
                )
            }
            template             = @{
                terminationGracePeriodSeconds = $TerminationGracePeriodSeconds
                containers                    = @(
                    @{
                        name      = $ContainerAppName
                        image     = $image
                        resources = @{
                            cpu    = [double]$Cpu
                            memory = $Memory
                        }
                    }
                )
                scale                         = @{
                    minReplicas = 0
                    maxReplicas = 1
                }
            }
        }
    } | ConvertTo-Json -Depth 8 -Compress
    $bodyFile = Join-Path $env:TEMP "qos-ai-worker-create.json"
    [System.IO.File]::WriteAllText($bodyFile, $createBody)
    $createUrl = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.App/containerApps/${ContainerAppName}?api-version=2026-01-01"
    Invoke-Az @(
        "rest", "--method", "put",
        "--url", $createUrl,
        "--body", "@$bodyFile",
        "--only-show-errors", "-o", "none"
    ) | Out-Null
    $worker = Get-ContainerApp -Name $ContainerAppName
}

$principalId = $worker.identity.principalId
if (-not $principalId) {
    Invoke-Az @(
        "containerapp", "identity", "assign",
        "--name", $ContainerAppName,
        "--resource-group", $ResourceGroup,
        "--system-assigned",
        "--only-show-errors", "-o", "none"
    ) | Out-Null
    $worker = Get-ContainerApp -Name $ContainerAppName
    $principalId = $worker.identity.principalId
}
Write-Host "Worker identity: $principalId"

Write-Host "Granting data-plane roles..."
$kvId = Invoke-Az @("keyvault", "show", "--name", $KeyVaultName, "--query", "id", "-o", "tsv")
$storageId = Invoke-Az @("storage", "account", "show", "--name", $StorageAccountName, "--resource-group", $ResourceGroup, "--query", "id", "-o", "tsv")
Grant-Role -PrincipalId $principalId -Role "Key Vault Secrets User" -Scope $kvId.Trim()
Grant-Role -PrincipalId $principalId -Role "Storage Blob Data Contributor" -Scope $storageId.Trim()

$secretArgs = @()
foreach ($name in $sharedSecretNames) {
    $secretArgs += "$name=keyvaultref:$($apiSecrets[$name]),identityref:system"
}
foreach ($name in $dedicatedSecretNames) {
    $secretArgs += "$name=keyvaultref:$(Get-KeyVaultSecretUri -Name $name),identityref:system"
}

$envArgs = @()
foreach ($key in $secretEnv.Keys) {
    $envArgs += "$key=secretref:$($secretEnv[$key])"
}
foreach ($key in $copiedPlainEnv) {
    if ($apiEnv[$key]) {
        $envArgs += "$key=$($apiEnv[$key])"
    }
}
$envArgs += @(
    "DB_POOL_MAX=4",
    "AI_WORKER_ENABLED=true",
    "AI_WORKER_CONCURRENCY=$Concurrency",
    "AI_WORKER_MAX_ACTIVE_GLOBAL=$MaxActiveGlobal",
    "AI_WORKER_MAX_ACTIVE_PER_TENANT=$MaxActivePerTenant",
    "AI_WORKER_MAX_ACTIVE_PER_KIND=$MaxActivePerKind"
)

$deadline = (Get-Date).AddMinutes(6)
while ($true) {
    try {
        Write-Host "Wiring Key Vault secrets..."
        Invoke-Az (@(
                "containerapp", "secret", "set",
                "--name", $ContainerAppName,
                "--resource-group", $ResourceGroup,
                "--secrets"
            ) + $secretArgs + @("--only-show-errors", "-o", "none")) | Out-Null
        break
    }
    catch {
        if ((Get-Date) -gt $deadline) {
            throw
        }
        Write-Host "  Key Vault access not effective yet; retrying in 30s..."
        Start-Sleep -Seconds 30
    }
}

$minReplicas = if ($AlwaysOn) { "1" } else { "0" }

$scaleArgs = @(
    "--scale-rule-name", "ai-queue",
    "--scale-rule-type", "postgresql",
    "--scale-rule-metadata",
    "query=SELECT qos.count_due_ai_work()",
    "targetQueryValue=1",
    "activationTargetQueryValue=0",
    "sslmode=require",
    "--scale-rule-auth",
    "host=runtime-db-host",
    "port=runtime-db-port",
    "dbName=runtime-db-name",
    "userName=runtime-ai-scaler-db-user",
    "password=runtime-ai-scaler-db-password"
)

$mode = if ($AlwaysOn) { "always-on" } else { "scale-to-zero" }
Write-Host "Rolling out $image ($mode, $Cpu vCPU / $Memory, max $MaxReplicas replicas)..."
Invoke-Az (@(
        "containerapp", "update",
        "--name", $ContainerAppName,
        "--resource-group", $ResourceGroup,
        "--image", $image,
        "--cpu", $Cpu,
        "--memory", $Memory,
        "--min-replicas", $minReplicas,
        "--max-replicas", "$MaxReplicas"
    ) + $scaleArgs + @("--set-env-vars") + $envArgs + @("--only-show-errors", "-o", "none")) | Out-Null

$deadline = (Get-Date).AddMinutes(5)
do {
    Start-Sleep -Seconds 10
    $worker = Get-ContainerApp -Name $ContainerAppName
    $ready = $worker.properties.latestRevisionName
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $state = az containerapp revision show --name $ContainerAppName --resource-group $ResourceGroup --revision $ready --query "properties.provisioningState" -o tsv 2>$null
    }
    finally {
        $ErrorActionPreference = $previous
    }
    Write-Host "  revision=$ready provisioning=$state"
} while ($state -notin @("Provisioned", "Failed") -and (Get-Date) -lt $deadline)

if ($state -ne "Provisioned") {
    throw "Revision $ready did not provision (state: $state). Check: az containerapp revision show -n $ContainerAppName -g $ResourceGroup --revision $ready"
}

Write-Host ""
Write-Host "Worker revision $ready is configured with $image ($mode)."
Write-Host "Photos stay synchronous until the API execution mode is switched to the worker."
if ($AlwaysOn) {
    Write-Host "Look for an 'ai_worker.started' line (and no 'ai_worker.fatal'):"
}
else {
    Write-Host "No replica runs until a job is queued. After queueing one, within ~30-60s look for"
    Write-Host "'ai_worker.started' then 'ai_worker.job_started' (and no 'ai_worker.fatal'):"
}
Write-Host "  az containerapp logs show -n $ContainerAppName -g $ResourceGroup --tail 50"
