#Requires -Version 5.1
<#
.SYNOPSIS
  Build the qos-api Docker image in Azure Container Registry and push it.

.EXAMPLE
  .\deploy\build-and-push-to-acr.ps1

.EXAMPLE
  .\deploy\build-and-push-to-acr.ps1 -ImageTag "0.2"
#>
[CmdletBinding()]
param(
    [string] $RegistryName = "qosdevacr",
    [string] $ResourceGroup = "rg-qos-dev-core",
    [string] $ImageName = "qos-api",
    [string] $ImageTag = "0.1",
    [string] $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [switch] $ShowLogs
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

$fullImage = "${ImageName}:${ImageTag}"

Write-Host "Building and pushing $RegistryName.azurecr.io/$fullImage"
Write-Host "Project root: $ProjectRoot"

Assert-AzCli

Push-Location $ProjectRoot
try {
    $buildArgs = @(
        "acr", "build",
        "--registry", $RegistryName,
        "--image", $fullImage,
        "--resource-group", $ResourceGroup
    )

    if (-not $ShowLogs) {
        $buildArgs += "--no-logs"
    }

    $buildArgs += "."

    & az @buildArgs
    if ($LASTEXITCODE -ne 0) {
        throw "ACR build failed."
    }

    if (-not $ShowLogs) {
        $latestRun = az acr task list-runs `
            --registry $RegistryName `
            --output json `
            | ConvertFrom-Json `
            | Select-Object -First 1

        if ($latestRun.status -ne "Succeeded") {
            throw "Latest ACR run '$($latestRun.runId)' finished with status '$($latestRun.status)'."
        }

        Write-Host "ACR run '$($latestRun.runId)' succeeded."
    }

    Write-Host ""
    Write-Host "Image published: $RegistryName.azurecr.io/$fullImage"
}
finally {
    Pop-Location
}
