;(() => {
  if (globalThis.__oneWorksChromeBridgeInstalled) return
  globalThis.__oneWorksChromeBridgeInstalled = true
  const nonce = crypto.randomUUID()
  let negotiated = false

  const postHello = () =>
    window.postMessage({
      type: 'ONEWORKS_CHROME_HELLO',
      nonce,
      protocol_version: 1,
      extension_id: chrome.runtime.id,
      extension_version: chrome.runtime.getManifest().version
    }, location.origin)

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.nonce !== nonce) return
    if (event.data.type === 'ONEWORKS_CHROME_WELCOME') {
      negotiated = event.data.protocol_version === 1
      window.postMessage(
        { type: 'ONEWORKS_CHROME_BRIDGE_STATUS', nonce, negotiated, protocol_version: 1 },
        location.origin
      )
      return
    }
    if (event.data.type === 'ONEWORKS_CHROME_PAIRING_OFFER') {
      const offer = event.data.offer
      if (!negotiated || offer?.trusted_origin !== location.origin || offer?.protocol_version !== 1) return
      chrome.runtime.sendMessage({ type: 'oneworks:pairing-offer', offer }).then(response => {
        window.postMessage({
          type: 'ONEWORKS_CHROME_PAIRING_RESULT',
          nonce,
          ok: response?.ok === true,
          error: response?.error
        }, location.origin)
      })
    }
  })
  postHello()
  const timer = setInterval(() => {
    if (!negotiated) postHello()
  }, 1500)
  addEventListener('pagehide', () => clearInterval(timer), { once: true })
})()
