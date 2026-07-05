import { relayApiDocumentation } from './api-metadata.js'
import { handleRelayApi } from './api.js'
import { createRelayController } from './controller.js'
import { normalizeOptions } from './options.js'
import type { RelayPluginContext } from './types.js'

export function activatePlugin(ctx: RelayPluginContext) {
  const controller = createRelayController(ctx)
  let disposed = false
  const options = normalizeOptions(ctx.options)

  ctx.registerCommand('connect', async payload => await controller.connect(payload))
  ctx.registerCommand('disconnect', async payload => await controller.disconnect(payload))
  ctx.registerCommand('login', async payload => await controller.createLoginUrl(payload))
  ctx.registerCommand('logout', async payload => await controller.logoutUser(payload))
  ctx.registerCommand('refresh-config', async payload => await controller.refreshConfigDistribution(payload))
  ctx.registerCommand('status', async () => await controller.getPublicStatus())
  ctx.registerCommand('search', payload => controller.search(payload))
  ctx.registerCommand('users', async payload => await controller.listUsers(payload))
  ctx.registerCommand('users-disable', async payload => await controller.setUserEnabled(payload, false))
  ctx.registerCommand('users-enable', async payload => await controller.setUserEnabled(payload, true))
  ctx.registerApi('relay', {
    ...relayApiDocumentation,
    handler: async request => await handleRelayApi(request, controller)
  })

  void controller.restoreStoredConnections()
    .then(async restoredServerIds => {
      if (disposed || !options.autoConnect) return
      if (restoredServerIds.includes(options.activeServerId)) return
      await controller.connect()
    })
    .catch(error => {
      if (disposed) return
      ctx.logger.warn({ err: error, scope: ctx.scope }, '[relay] auto-connect failed')
    })

  ctx.dispose(() => {
    disposed = true
    controller.dispose()
  })
}
