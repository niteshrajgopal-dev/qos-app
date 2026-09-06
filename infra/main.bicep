@targetScope = 'subscription'

param location string = 'uaenorth'
param resourceGroupName string = 'rg-qos-dev-core'
param containerAppName string = 'ca-qos-dev-api'
param acrName string = 'qosdevacr'
param imageName string = 'qos-api'
param imageTag string = '0.1'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' existing = {
  name: resourceGroupName
}

module containerAppUpdate 'container-app.bicep' = {
  name: 'qos-api-deploy'
  scope: rg
  params: {
    location: location
    containerAppName: containerAppName
    acrName: acrName
    imageName: imageName
    imageTag: imageTag
  }
}

output containerAppFqdn string = containerAppUpdate.outputs.fqdn
