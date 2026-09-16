#Requires -Version 5.1

$script:LegacySharedStorefrontContainerApp = "ca-qos-dev-storefront"
$script:ApprovedStorefrontContainerAppPattern = "^ca-qos-dev-storefront-[a-z0-9-]+$"

function Test-StorefrontDeployTarget {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $ImageName,

        [AllowEmptyString()]
        [string] $ContainerAppName
    )

    if ($ImageName -ne "qos-storefront") {
        return
    }

    $target = $ContainerAppName.Trim()

    if (-not $target) {
        throw "Storefront deployment requires an explicit -ContainerAppName target."
    }

    if ($target -eq $script:LegacySharedStorefrontContainerApp) {
        throw "Legacy shared storefront target '$target' is frozen and cannot be used for normal storefront deployments."
    }

    if ($target -notmatch $script:ApprovedStorefrontContainerAppPattern) {
        throw "Storefront deployment target '$target' does not match the approved isolated storefront naming convention."
    }
}

function Get-DeploymentReleaseEvidence {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $RegistryName,

        [Parameter(Mandatory = $true)]
        [string] $ImageName,

        [Parameter(Mandatory = $true)]
        [string] $ImageTag,

        [Parameter(Mandatory = $true)]
        [string] $ContainerAppName,

        [Parameter(Mandatory = $true)]
        [string] $ResourceGroup,

        [string] $Environment = "dev"
    )

    $image = "$RegistryName.azurecr.io/${ImageName}:${ImageTag}"
    $gitCommit = $null

    try {
        $gitCommit = (git rev-parse HEAD 2>$null).Trim()
    }
    catch {
        $gitCommit = $null
    }

    $digest = $null
    try {
        $manifestJson = az acr repository show-manifests `
            --name $RegistryName `
            --repository $ImageName `
            --query "[?contains(tags, '$ImageTag')].digest | [0]" `
            -o tsv 2>$null
        if ($manifestJson) {
            $digest = $manifestJson.Trim()
        }
    }
    catch {
        $digest = $null
    }

    $revision = $null
    try {
        $appJson = az containerapp show `
            --name $ContainerAppName `
            --resource-group $ResourceGroup `
            -o json 2>$null | ConvertFrom-Json
        if ($appJson) {
            $revision = $appJson.properties.latestRevisionName
        }
    }
    catch {
        $revision = $null
    }

    return [ordered]@{
        timestampUtc     = (Get-Date).ToUniversalTime().ToString("o")
        environment      = $Environment
        containerAppName = $ContainerAppName
        imageRepository  = $ImageName
        imageTag         = $ImageTag
        imageReference   = $image
        imageDigest      = $digest
        gitCommit        = $gitCommit
        revision         = $revision
    }
}
