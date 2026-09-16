#Requires -Version 5.1

$ErrorActionPreference = "Stop"

. "$PSScriptRoot/storefront-deploy-validation.ps1"

function Assert-Throws {
    param(
        [scriptblock] $Script,
        [string] $Pattern
    )

    $threw = $false
    try {
        & $Script
    }
    catch {
        $threw = $true
        if ($Pattern -and $_.Exception.Message -notmatch $Pattern) {
            throw "Expected error matching '$Pattern' but got: $($_.Exception.Message)"
        }
    }

    if (-not $threw) {
        throw "Expected script block to throw."
    }
}

Write-Host "Running storefront deploy validation tests..."

Test-StorefrontDeployTarget -ImageName "qos-api" -ContainerAppName "ca-qos-dev-api"

Test-StorefrontDeployTarget `
    -ImageName "qos-storefront" `
    -ContainerAppName "ca-qos-dev-storefront-quotes"

Test-StorefrontDeployTarget `
    -ImageName "qos-storefront" `
    -ContainerAppName "ca-qos-dev-storefront-florea"

Assert-Throws {
    Test-StorefrontDeployTarget -ImageName "qos-storefront" -ContainerAppName ""
} "explicit"

Assert-Throws {
    Test-StorefrontDeployTarget `
        -ImageName "qos-storefront" `
        -ContainerAppName "ca-qos-dev-storefront"
} "Legacy shared storefront"

Assert-Throws {
    Test-StorefrontDeployTarget `
        -ImageName "qos-storefront" `
        -ContainerAppName "ca-qos-dev-api"
} "approved isolated storefront naming"

Write-Host "All storefront deploy validation tests passed."
