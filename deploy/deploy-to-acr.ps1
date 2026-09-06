#Requires -Version 5.1
<#
.SYNOPSIS
  Deploy the qos-api image from ACR to Azure Container Apps.

.EXAMPLE
  .\deploy\deploy-to-acr.ps1

.EXAMPLE
  .\deploy\deploy-to-acr.ps1 -ImageTag "0.2" -WaitForHealth
#>
[CmdletBinding()]
param(
    [string] $RegistryName = "qosdevacr",
    [string] $ResourceGroup = "rg-qos-dev-core",
    [string] $ContainerAppName = "ca-qos-dev-api",
    [string] $ImageName = "qos-api",
    [string] $ImageTag = "0.1",
    [string] $HealthPath = "/api/health",
    [switch] $WaitForHealth,
    [int] $HealthTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

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

function Wait-ForHealthyRevision {
    param(
        [string] $HealthUrl,
        [int] $TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    Write-Host "Waiting for health endpoint (timeout: ${TimeoutSeconds}s)..."

    while ((Get-Date) -lt $deadline) {
        try {
            $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 15
            if ($health.status -eq "healthy") {
                Write-Host "Health check passed."
                return $health
            }

            Write-Host "Health status: $($health.status)"
        }
        catch {
            Write-Host "Health endpoint not ready yet..."
        }

        Start-Sleep -Seconds 5
    }

    throw "Timed out waiting for a healthy deployment at $HealthUrl"
}

$image = "$RegistryName.azurecr.io/${ImageName}:${ImageTag}"

Write-Host "Deploying $image to container app '$ContainerAppName'"
Assert-AzCli

& az containerapp update `
    --name $ContainerAppName `
    --resource-group $ResourceGroup `
    --image $image

if ($LASTEXITCODE -ne 0) {
    throw "Container App update failed."
}

$app = az containerapp show `
    --name $ContainerAppName `
    --resource-group $ResourceGroup `
    -o json `
    | ConvertFrom-Json

$fqdn = $app.properties.configuration.ingress.fqdn
$healthUrl = "https://$fqdn$HealthPath"

Write-Host ""
Write-Host "Container App: $ContainerAppName"
Write-Host "URL:           https://$fqdn"
Write-Host "Health:        $healthUrl"

if ($WaitForHealth) {
    $result = Wait-ForHealthyRevision `
        -HealthUrl $healthUrl `
        -TimeoutSeconds $HealthTimeoutSeconds

    $result | ConvertTo-Json -Depth 5 | Write-Host
}
