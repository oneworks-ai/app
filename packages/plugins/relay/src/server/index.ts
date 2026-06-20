import { relayApiDocumentation } from './api-metadata.js'
import { handleRelayApi } from './api.js'
import { createRelayController } from './controller.js'
import { normalizeOptions } from './options.js'
import type { RelayPluginContext } from './types.js'

export function activatePlugin(ctx: RelayPluginContext) {
  const controller = createRelayController(ctx)
  let disposed = false

  ctx.registerCommand('connect', async payload => await controller.connect(payload))
  ctx.registerCommand('disconnect', async payload => await controller.disconnect(payload))
  ctx.registerCommand('refresh-config', async payload => await controller.refreshConfigDistribution(payload))
  ctx.registerCommand('status', async () => await controller.getPublicStatus())
  ctx.registerCommand('search', payload => controller.search(payload))
  ctx.registerApi('relay', {
    ...relayApiDocumentation,
    handler: async request => await handleRelayApi(request, controller)
  })

  if (normalizeOptions(ctx.options).autoConnect) {
    void controller.connect().catch(error => {
      if (disposed) return
      ctx.logger.warn({ err: error, scope: ctx.scope }, '[relay] auto-connect failed')
    })
  }

  ctx.dispose(() => {
    disposed = true
    controller.dispose()
  })
}
