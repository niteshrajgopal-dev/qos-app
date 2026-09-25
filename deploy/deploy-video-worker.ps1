#Requires -Version 5.1
<#
.SYNOPSIS
  Create or update the video worker Container App (QOS-25).

.DESCRIPTION
  Runs the `worker` Dockerfile target (Node + ffmpeg) with no ingress. It claims
  jobs from qos.video_processing_jobs as qos_app, so it gets the same database
  and media settings as the API app and nothing else (no Stripe/auth secrets).

  Database and blob Key Vault references plus media settings are copied from
  the API Container App at deploy time so the two never drift.

  Scales to zero by default: a KEDA postgresql rule polls
  qos.count_active_video_processing_jobs() (~every 30s) and starts a replica
  when a job is due, so an idle dev environment costs ~nothing. The first job
  after a quiet period waits for a cold start. Use -AlwaysOn to keep one
  replica running (no cold start, billed continuously).

  Prerequisites:
    1. Migration 0035 (claim function) applied to the target database.
    2. Image built:  .\deploy\build-and-push-to-acr.cmd -ImageName qos-video-worker -ImageTag <tag> -Target worker

.EXAMPLE
  .\deploy\deploy-video-worker.cmd -ImageTag "0.1.0"
#>
[CmdletBinding()]
param(
    [string] $RegistryName = "qosdevacr",
    [string] $ResourceGroup = "rg-qos-dev-core",
    [string] $EnvironmentName = "cae-qos-dev",
    [string] $ContainerAppName = "ca-qos-dev-video-worker",
    [string] $ApiContainerAppName = "ca-qos-dev-api",
    [string] $KeyVaultName = "kv-qos-dev-runtime",
    [string] $StorageAccountName = "stqosdev",
    [string] $ImageName = "qos-video-worker",
    [Parameter(Mandatory = $true)]
    [string] $ImageTag,
    [string] $Cpu = "0.5",
    [string] $Memory = "1Gi",
    [int] $MaxReplicas = 1,
    [switch] $AlwaysOn,
    [int] $MaxConcurrentJobs = 1,
    [int] $MaxActiveJobsPerTenant = 1,
    # Job timeout (5 min) plus uploads, so a rolling update lets the current job finish.
    [int] $TerminationGracePeriodSeconds = 450
)

$ErrorActionPreference = "Stop"

$sharedSecretNames = @(
    "runtime-db-host",
    "runtime-db-port",
    "runtime-db-name",
    "runtime-db-user",
    "runtime-db-password",
    "media-blob-conn"
)

$secretEnv = [ordered]@{
    DB_HOST                            = "runtime-db-host"
    DB_PORT                            = "runtime-db-port"
    DB_NAME                            = "runtime-db-name"
    DB_USER                            = "runtime-db-user"
    DB_PASSWORD                        = "runtime-db-password"
    MEDIA_AZURE_BLOB_CONNECTION_STRING = "media-blob-conn"
}

$copiedPlainEnv = @(
    "MEDIA_STORAGE",
    "MEDIA_AZURE_BLOB_ACCOUNT_URL",
    "MEDIA_AZURE_BLOB_PRIVATE_CONTAINER",
    "MEDIA_AZURE_BLOB_PUBLIC_CONTAINER"
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

    $json = az containerapp show --name $Name --resource-group $ResourceGroup -o json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) {
        return $null
    }

    return ($json | Out-String | ConvertFrom-Json)
}

function Grant-Role {
    param([string] $PrincipalId, [string] $Role, [string] $Scope)

    $existing = az role assignment list --assignee $PrincipalId --role $Role --scope $Scope --query "[0].id" -o tsv 2>$null
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

$image = "$RegistryName.azurecr.io/${ImageName}:${ImageTag}"
Write-Host "Deploying $image to '$ContainerAppName'"
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
    Invoke-Az @(
        "containerapp", "create",
        "--name", $ContainerAppName,
        "--resource-group", $ResourceGroup,
        "--environment", $EnvironmentName,
        "--workload-profile-name", "Consumption",
        "--image", $image,
        "--registry-server", "$RegistryName.azurecr.io",
        "--registry-identity", "system-environment",
        "--system-assigned",
        "--cpu", $Cpu,
        "--memory", $Memory,
        "--min-replicas", "0",
        "--max-replicas", "1",
        "--termination-grace-period", "$TerminationGracePeriodSeconds",
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
    "VIDEO_MAX_CONCURRENT_JOBS=$MaxConcurrentJobs",
    "VIDEO_MAX_ACTIVE_JOBS_PER_TENANT=$MaxActiveJobsPerTenant"
)

# New role assignments can take a few minutes to reach Key Vault.
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

# KEDA postgresql scaler: replicas = ceil(count / targetQueryValue), capped at
# MaxReplicas; activates from zero when count > 0. Connection parts come from
# the same Key Vault-backed secrets the worker uses, never from plain metadata.
$scaleArgs = @(
    "--scale-rule-name", "video-queue",
    "--scale-rule-type", "postgresql",
    "--scale-rule-metadata",
    "query=SELECT qos.count_active_video_processing_jobs()",
    "targetQueryValue=$MaxConcurrentJobs",
    "activationTargetQueryValue=0",
    "sslmode=require",
    "--scale-rule-auth",
    "host=runtime-db-host",
    "port=runtime-db-port",
    "dbName=runtime-db-name",
    "userName=runtime-db-user",
    "password=runtime-db-password"
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

# A scaled-to-zero revision never runs a replica, so wait on provisioning
# rather than readiness.
$deadline = (Get-Date).AddMinutes(5)
do {
    Start-Sleep -Seconds 10
    $worker = Get-ContainerApp -Name $ContainerAppName
    $ready = $worker.properties.latestRevisionName
    $state = az containerapp revision show --name $ContainerAppName --resource-group $ResourceGroup --revision $ready --query "properties.provisioningState" -o tsv 2>$null
    Write-Host "  revision=$ready provisioning=$state"
} while ($state -notin @("Provisioned", "Failed") -and (Get-Date) -lt $deadline)

if ($state -ne "Provisioned") {
    throw "Revision $ready did not provision (state: $state). Check: az containerapp revision show -n $ContainerAppName -g $ResourceGroup --revision $ready"
}

Write-Host ""
Write-Host "Worker revision $ready is configured with $image ($mode)."
if ($AlwaysOn) {
    Write-Host "Look for a 'video_worker.boot' line (and no 'video_worker.fatal'):"
}
else {
    Write-Host "No replica runs until a job is queued. After queueing one, within ~30-60s look for"
    Write-Host "'video_worker.boot' then 'video_worker.job_started' (and no 'video_worker.fatal'):"
}
Write-Host "  az containerapp logs show -n $ContainerAppName -g $ResourceGroup --tail 50"
