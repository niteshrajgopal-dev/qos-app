param location string
param containerAppName string
param acrName string
param imageName string
param imageTag string

resource containerApp 'Microsoft.App/containerApps@2024-03-01' existing = {
  name: containerAppName
}

var image = '${acrName}.azurecr.io/${imageName}:${imageTag}'

resource containerAppUpdate 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  identity: containerApp.identity
  properties: {
    managedEnvironmentId: containerApp.properties.managedEnvironmentId
    configuration: {
      activeRevisionsMode: containerApp.properties.configuration.activeRevisionsMode
      ingress: {
        external: containerApp.properties.configuration.ingress.external
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: containerApp.properties.configuration.registries
      secrets: containerApp.properties.configuration.secrets
    }
    template: {
      containers: [
        {
          name: containerAppName
          image: image
          env: [
            { name: 'DB_HOST', secretRef: 'postgres-host' }
            { name: 'DB_PORT', secretRef: 'postgres-port' }
            { name: 'DB_NAME', secretRef: 'postgres-database' }
            { name: 'DB_USER', secretRef: 'postgres-admin-user' }
            { name: 'DB_PASSWORD', secretRef: 'postgres-admin-password' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health/live'
                port: 3000
              }
              periodSeconds: 10
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health/ready'
                port: 3000
              }
              periodSeconds: 5
              failureThreshold: 48
            }
            {
              type: 'Startup'
              httpGet: {
                path: '/api/health/ready'
                port: 3000
              }
              periodSeconds: 1
              failureThreshold: 240
            }
          ]
          resources: containerApp.properties.template.containers[0].resources
        }
      ]
      scale: containerApp.properties.template.scale
    }
  }
}

output fqdn string = containerAppUpdate.properties.configuration.ingress.fqdn
