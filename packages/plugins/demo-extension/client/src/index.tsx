const DEMO_EXTENSION_POINT = 'demo/quick-actions'
const DEMO_API = 'demo/describe-extension-point'

export function activatePlugin(ctx) {
  const disposables = []
  let observedExtensionPoint = null

  disposables.push(
    ctx.commands.register('status', () => ({
      active: true,
      extensionPoint: DEMO_EXTENSION_POINT,
      message: 'Plugin Demo Extension is active.',
      scope: ctx.scope
    }))
  )

  disposables.push(
    ctx.commands.register('demo-quick-action', async payload => {
      const hostResult = await ctx.pluginApis.call(DEMO_API, {
        contribution: 'extension-quick-action',
        extensionPoint: DEMO_EXTENSION_POINT,
        payload
      })
      return {
        at: new Date().toISOString(),
        extensionPoint: DEMO_EXTENSION_POINT,
        hostResult,
        message: 'Plugin Demo Extension handled a contributed quick action.',
        observedExtensionPoint,
        payload,
        scope: ctx.scope
      }
    })
  )

  disposables.push(
    ctx.extensionPoints.onAvailable(DEMO_EXTENSION_POINT, (point) => {
      observedExtensionPoint = {
        id: point.id,
        pluginScope: point.pluginScope,
        title: point.title,
        titleI18n: point.titleI18n
      }
      return () => {
        observedExtensionPoint = null
      }
    })
  )

  return () => {
    disposables.forEach(disposable => disposable.dispose())
  }
}
