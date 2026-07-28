/// <reference types="vite/client" />

const readPluginVersion = () => {
  try {
    return new URL(import.meta.url).searchParams.get('pluginVersion') ?? String(Date.now())
  } catch {
    return String(Date.now())
  }
}

const importVersionedPeer = (path, version) =>
  import(/* @vite-ignore */ `${path}?pluginVersion=${encodeURIComponent(version)}`)

const loadChromeDriverModules = () => {
  if (import.meta.env.DEV) {
    return Promise.all([import('./styles'), import('./view')])
  }
  const version = readPluginVersion()
  return Promise.all([
    importVersionedPeer('./styles.js', version),
    importVersionedPeer('./view.js', version)
  ])
}

const activeReloads = new Set<() => Promise<void>>()
const activeStyles = new Set<HTMLStyleElement>()
const reloadActivePlugins = () => {
  activeReloads.forEach(reload => void reload())
}

if (import.meta.hot) {
  import.meta.hot.accept('./styles.ts', (styles) => {
    if (styles == null) return
    activeStyles.forEach(style => {
      style.textContent = styles.chromeDriverCss
    })
  })
  import.meta.hot.accept(reloadActivePlugins)
}

export async function activatePlugin(ctx) {
  const [{ chromeDriverCss }, { ChromeDriverView }] = await loadChromeDriverModules()
  const style = document.createElement('style')
  style.textContent = chromeDriverCss
  document.head.appendChild(style)
  activeStyles.add(style)
  const reload = () => ctx.hot.reload()
  activeReloads.add(reload)

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
  window.postMessage({ type: 'ONEWORKS_CHROME_HELLO_REQUEST' }, location.origin)

  const disposable = ctx.views.register('control', {
    renderNode: view => ctx.react.createElement(ChromeDriverView, { ctx, react: ctx.react, view })
  })
  return {
    dispose() {
      disposable.dispose()
      window.removeEventListener('message', handleHandshake)
      activeReloads.delete(reload)
      activeStyles.delete(style)
      style.remove()
    }
  }
}
