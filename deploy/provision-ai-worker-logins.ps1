#Requires -Version 5.1
<#
.SYNOPSIS
  Create or rotate the AI worker and scaler database logins, then store them
  in Key Vault. Passwords are never printed.

.DESCRIPTION
  Prompts for the qosadmin password, generates two URL-safe passwords, creates
  qos_ai_worker_login (inherits qos_ai_worker) and qos_ai_scaler_login
  (inherits qos_ai_scaler), and writes the four Key Vault secrets the deploy
  script expects. Does not deploy the worker or change API settings.

.EXAMPLE
  .\deploy\provision-ai-worker-logins.cmd
#>
[CmdletBinding()]
param(
    [string] $ResourceGroup = "rg-qos-dev-core",
    [string] $KeyVaultName = "kv-qos-dev-runtime",
    [string] $DbHost = "psql-qos-dev.postgres.database.azure.com",
    [string] $DbName = "qos_db",
    [string] $MigratorUser = "qosadmin"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "Azure CLI (az) is not installed or not on PATH."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required to run scripts/provision-ai-worker-logins.ts."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$script = Join-Path $projectRoot "scripts\provision-ai-worker-logins.ts"
if (-not (Test-Path $script)) {
    throw "Missing $script"
}

$secure = Read-Host "qosadmin password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $migratorPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $secure.Dispose()
}

function New-UrlSafeSecret {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $value = & node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"
        if ($LASTEXITCODE -ne 0 -or -not $value -or $value.Length -lt 32) {
            throw "Could not generate a login password."
        }
        return $value
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

$workerPassword = New-UrlSafeSecret
$scalerPassword = New-UrlSafeSecret

$encodedUser = [uri]::EscapeDataString($MigratorUser)
$encodedPassword = [uri]::EscapeDataString($migratorPassword)
$env:DATABASE_ADMIN_URL = "postgresql://${encodedUser}:${encodedPassword}@${DbHost}:5432/${DbName}?sslmode=require"
$env:QOS_AI_WORKER_LOGIN_PASSWORD = $workerPassword
$env:QOS_AI_SCALER_LOGIN_PASSWORD = $scalerPassword

try {
    Write-Host "Provisioning database logins..."
    Push-Location $projectRoot
    try {
        & npx --no-install tsx $script
        if ($LASTEXITCODE -ne 0) {
            throw "Login provisioning failed."
        }
    }
    finally {
        Pop-Location
    }

    $secrets = [ordered]@{
        "runtime-ai-worker-db-user"     = "qos_ai_worker_login"
        "runtime-ai-worker-db-password" = $workerPassword
        "runtime-ai-scaler-db-user"     = "qos_ai_scaler_login"
        "runtime-ai-scaler-db-password" = $scalerPassword
    }

    foreach ($name in $secrets.Keys) {
        $temp = Join-Path $env:TEMP ("qos-" + $name + ".txt")
        try {
            [System.IO.File]::WriteAllText($temp, [string]$secrets[$name])
            $previous = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            try {
                & az keyvault secret set --vault-name $KeyVaultName --name $name --file $temp --only-show-errors -o none
                if ($LASTEXITCODE -ne 0) {
                    throw "Failed to write Key Vault secret '$name'."
                }
            }
            finally {
                $ErrorActionPreference = $previous
            }
            Write-Host "Wrote $name to Key Vault $KeyVaultName."
        }
        finally {
            if (Test-Path $temp) {
                Remove-Item $temp -Force
            }
        }
    }
}
finally {
    Remove-Item Env:DATABASE_ADMIN_URL -ErrorAction SilentlyContinue
    Remove-Item Env:QOS_AI_WORKER_LOGIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:QOS_AI_SCALER_LOGIN_PASSWORD -ErrorAction SilentlyContinue
    $migratorPassword = $null
    $workerPassword = $null
    $scalerPassword = $null
}

Write-Host "Logins are in Key Vault. Deploy the worker with deploy/deploy-ai-worker.cmd."
