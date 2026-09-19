#Requires -Version 5.1
<#
.SYNOPSIS
  Build the qos-api Docker image in Azure Container Registry and push it.

.EXAMPLE
  .\deploy\build-and-push-to-acr.cmd

.EXAMPLE
  .\deploy\build-and-push-to-acr.cmd -ImageTag "0.2"
#>
[CmdletBinding()]
param(
    [string] $RegistryName = "qosdevacr",
    [string] $ResourceGroup = "rg-qos-dev-core",
    [string] $ImageName = "qos-api",
    [string] $ImageTag = "0.2",
    [string] $ProjectRoot = "",
    [switch] $ShowLogs
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $scriptDir = $PSScriptRoot
    if (-not $scriptDir) {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    if (-not $scriptDir) {
        throw "Could not resolve deploy script directory. Pass -ProjectRoot explicitly."
    }
    $ProjectRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
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

function Get-LatestAcrRun {
    param([string] $RegistryName)

    $runs = az acr task list-runs `
        --registry $RegistryName `
        --top 1 `
        -o json `
        2>$null | ConvertFrom-Json

    if (-not $runs) {
        return $null
    }

    # PS 5.1 leaves a one-item JSON array as Object[], so .status is empty.
    @($runs)[0]
}

function Wait-AcrRun {
    param(
        [string] $RegistryName,
        $Run,
        [int] $TimeoutSeconds = 1800
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $current = $Run

    while ((Get-Date) -lt $deadline) {
        if (-not $current) {
            $current = Get-LatestAcrRun -RegistryName $RegistryName
            if (-not $current) {
                Start-Sleep -Seconds 10
                continue
            }
        }

        if ($current.status -in @("Queued", "Started", "Running")) {
            Start-Sleep -Seconds 10
            $current = Get-LatestAcrRun -RegistryName $RegistryName
            continue
        }

        return $current
    }

    return $current
}

function Write-AcrRunLogs {
    param(
        [string] $RegistryName,
        [string] $RunId
    )

    if (-not $RunId) {
        Write-Warning "No ACR run id available; skipping log download."
        return
    }

    Write-Host ""
    Write-Host "Fetching logs for ACR run $RunId..."

    $logFile = Join-Path $env:TEMP "acr-build-$RunId.log"
    $previousPythonUtf8 = $env:PYTHONUTF8
    $previousPythonIoEncoding = $env:PYTHONIOENCODING

    try {
        # Redirect away from the console so Colorama never encodes ▲ as cp1252.
        $env:PYTHONUTF8 = "1"
        $env:PYTHONIOENCODING = "utf-8"
        az acr task logs --registry $RegistryName --run-id $RunId > $logFile 2>&1
        Get-Content -Path $logFile -Encoding UTF8
    }
    finally {
        $env:PYTHONUTF8 = $previousPythonUtf8
        $env:PYTHONIOENCODING = $previousPythonIoEncoding
        Remove-Item -Path $logFile -ErrorAction SilentlyContinue
    }
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
        "--resource-group", $ResourceGroup,
        "--only-show-errors",
        # Next.js prints Unicode (e.g. ▲). Streaming those logs through
        # Azure CLI on Windows crashes with cp1252 UnicodeEncodeError even
        # when the remote build succeeds. Never stream live; fetch later.
        "--no-logs",
        "."
    )

    $previousErrorActionPreference = $ErrorActionPreference
    $previousPythonUtf8 = $env:PYTHONUTF8
    $previousPythonIoEncoding = $env:PYTHONIOENCODING

    try {
        $env:PYTHONUTF8 = "1"
        $env:PYTHONIOENCODING = "utf-8"

        # Windows PowerShell 5.1 can turn native stderr warnings into
        # PowerShell error records. Let az complete and judge success
        # from its process exit code instead.
        $ErrorActionPreference = "Continue"

        & az @buildArgs 2>&1 |
            ForEach-Object { Write-Host $_ }

        $azExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
        $env:PYTHONUTF8 = $previousPythonUtf8
        $env:PYTHONIOENCODING = $previousPythonIoEncoding
    }

    $run = Get-LatestAcrRun -RegistryName $RegistryName
    if ($azExitCode -ne 0) {
        $run = Wait-AcrRun -RegistryName $RegistryName -Run $run

        if ($run -and $run.status -eq "Succeeded") {
            Write-Warning @"
Azure CLI exited with code $azExitCode while talking to ACR, but run $($run.runId) succeeded.
This is a known Windows log-encoding issue with Next.js Unicode output. The image was still published.
"@
        }
        else {
            $runStatus = if ($run) { $run.status } else { "unknown" }
            $runId = if ($run) { $run.runId } else { "none" }
            throw "ACR build failed with exit code $azExitCode (run $runId status $runStatus)."
        }
    }

    if ($ShowLogs) {
        Write-AcrRunLogs -RegistryName $RegistryName -RunId $run.runId
    }

    Write-Host ""
    Write-Host "Image published: $RegistryName.azurecr.io/$fullImage"
}
finally {
    Pop-Location
}
