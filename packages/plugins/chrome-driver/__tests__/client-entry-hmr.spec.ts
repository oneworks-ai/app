import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../client/src/index.tsx', import.meta.url), 'utf8')

afterEach(() => {
  delete (globalThis as any).__oneWorksChromeBridgeInstalled
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('chrome driver client entry HMR', () => {
  it('uses analyzable source imports and versioned production peers', () => {
    expect(source).toContain("import('./styles')")
    expect(source).toContain("import('./view')")
    expect(source).toContain("importVersionedPeer('./styles.js', version)")
    expect(source).toContain("importVersionedPeer('./view.js', version)")
    expect(source).not.toContain('const dynamic =')
  })

  it('accepts source updates without escalating to a page reload', () => {
    expect(source).toContain("import.meta.hot.accept('./styles.ts'")
    expect(source).not.toContain("import.meta.hot.accept('./view.tsx'")
    expect(source).toContain('import.meta.hot.accept(reloadActivePlugins)')
    expect(source).toContain('activeReloads.delete(reload)')
    expect(source).toContain('activeStyles.delete(style)')
  })

  it('renegotiates the content-script handshake after dispose and reactivation', async () => {
    const origin = 'https://oneworks.test'
    const nonce = 'extension-nonce'
    const extensionId = 'extension-id'
    const messages: any[] = []
    const listeners = new Set<(event: any) => void>()
    const fakeWindow = {
      addEventListener: vi.fn((type, listener) => {
        if (type === 'message') listeners.add(listener)
      }),
      postMessage: vi.fn((data, targetOrigin) => {
        messages.push(data)
        for (const listener of [...listeners]) {
          listener({ data, origin: targetOrigin, source: fakeWindow })
        }
      }),
      removeEventListener: vi.fn((type, listener) => {
        if (type === 'message') listeners.delete(listener)
      })
    }
    const style = () => ({ remove: vi.fn(), textContent: '' })
    const sendMessage = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', fakeWindow)
    vi.stubGlobal('location', { origin })
    vi.stubGlobal('chrome', {
      runtime: {
        getManifest: () => ({ version: '0.1.0' }),
        id: extensionId,
        sendMessage
      }
    })
    vi.stubGlobal('crypto', { randomUUID: () => nonce })
    vi.stubGlobal('setInterval', vi.fn(() => 1))
    vi.stubGlobal('clearInterval', vi.fn())
    vi.stubGlobal('addEventListener', vi.fn())
    vi.stubGlobal('document', {
      createElement: vi.fn(style),
      head: { appendChild: vi.fn() }
    })
    const execute = vi.fn(async () => ({
      protocol_version: 1,
      trusted_origin: origin
    }))
    const viewDisposable = { dispose: vi.fn() }
    const ctx = {
      commands: { execute },
      hot: { reload: vi.fn(async () => undefined) },
      react: { createElement: vi.fn() },
      views: { register: vi.fn(() => viewDisposable) }
    }
    // @ts-expect-error -- The extension content script is intentionally plain browser JavaScript.
    await import('../extension/content-script.js')
    const entryUrl = new URL('../client/src/index.tsx', import.meta.url).href
    const { activatePlugin } = await import(/* @vite-ignore */ entryUrl) as any

    const first = await activatePlugin(ctx)
    expect(messages).toContainEqual(expect.objectContaining({
      compatible: true,
      nonce,
      type: 'ONEWORKS_CHROME_WELCOME'
    }))
    first.dispose()

    const second = await activatePlugin(ctx)
    fakeWindow.postMessage({ type: 'ONEWORKS_CHROME_PAIRING_REQUEST' }, origin)
    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith('create-pairing-offer', {
        extension_id: extensionId,
        origin,
        pairing_nonce: nonce
      })
    )
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'ONEWORKS_CHROME_PAIRING_OFFER',
      nonce
    }))
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'oneworks:pairing-offer'
      }))
    )
    second.dispose()
  })
})
