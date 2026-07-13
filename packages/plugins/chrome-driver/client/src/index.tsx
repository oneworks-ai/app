const readPluginVersion = () => {
  try {
    return new URL(import.meta.url).searchParams.get('pluginVersion') ?? String(Date.now())
  } catch {
    return String(Date.now())
  }
}
const isSourceEntry = () => {
  try {
    return new URL(import.meta.url).pathname.includes('/client/src/')
  } catch {
    return false
  }
}
const peer = (name, extension = 'ts') => isSourceEntry() ? `./${name}.${extension}` : `./${name}.js`
const dynamic = (path, version) => import(`${path}?pluginVersion=${encodeURIComponent(version)}`)

export async function activatePlugin(ctx) {
  const version = readPluginVersion()
  const [{ chromeDriverCss }, { ChromeDriverView }] = await Promise.all([
    dynamic(peer('styles'), version),
    dynamic(peer('view', 'tsx'), version)
  ])
  const style = document.createElement('style')
  style.textContent = chromeDriverCss
  document.head.appendChild(style)

  let extensionNonce
  let extensionId
  let pairingRequested = false
  let pairingInFlight = false
  const postPairingOffer = async () => {
    if (extensionNonce == null || extensionId == null || pairingInFlight) return
    pairingInFlight = true
    try {
      const offer = await ctx.commands.execute('create-pairing-offer', {
        origin: location.origin,
        extension_id: extensionId,
        pairing_nonce: extensionNonce
      })
      window.postMessage({
        type: 'ONEWORKS_CHROME_PAIRING_OFFER',
        nonce: extensionNonce,
        offer
      }, location.origin)
      pairingRequested = false
    } finally {
      pairingInFlight = false
    }
  }
  const handleHandshake = event => {
    if (event.source !== window || event.origin !== location.origin) return
    if (event.data?.type === 'ONEWORKS_CHROME_HELLO') {
      const compatible = event.data.protocol_version === 1
      extensionNonce = compatible && typeof event.data.nonce === 'string' ? event.data.nonce : undefined
      extensionId = compatible && typeof event.data.extension_id === 'string' ? event.data.extension_id : undefined
      window.postMessage({
        type: 'ONEWORKS_CHROME_WELCOME',
        nonce: event.data.nonce,
        protocol_version: 1,
        compatible,
        capabilities: ['pairing', 'frame-discovery', 'confirmation-ui'],
        app_origin: location.origin
      }, location.origin)
      if (pairingRequested) void postPairingOffer()
      return
    }
    if (event.data?.type !== 'ONEWORKS_CHROME_PAIRING_REQUEST') return
    pairingRequested = true
    void postPairingOffer()
  }
  window.addEventListener('message', handleHandshake)

  const disposable = ctx.views.register('control', {
    renderNode: view => ctx.react.createElement(ChromeDriverView, { ctx, react: ctx.react, view })
  })
  return {
    dispose() {
      disposable.dispose()
      window.removeEventListener('message', handleHandshake)
      style.remove()
    }
  }
}
