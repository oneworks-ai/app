/* eslint-disable max-lines -- Page capture and sensitive handoff races share one lifecycle harness. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

const checkedUrl = 'https://example.com/account?tenant=A#checked'
const targetFingerprint = createHash('sha256').update(new URL(checkedUrl).toString()).digest('hex')
const guarded = {
  document_id: 'document-4',
  expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint }],
  tab_id: 4
}

function chromeEvent<Arguments extends unknown[]>() {
  const listeners = new Set<(...args: Arguments) => void>()
  return {
    addListener: vi.fn((listener: (...args: Arguments) => void) => listeners.add(listener)),
    emit: (...args: Arguments) => {
      for (const listener of listeners) listener(...args)
    },
    listenerCount: () => listeners.size,
    removeListener: vi.fn((listener: (...args: Arguments) => void) => listeners.delete(listener))
  }
}

afterEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('chrome page result guards', () => {
  it.each([
    ['URL changes', 'TARGET_URL_CHANGED'],
    ['another tab becomes active', 'TARGET_DOCUMENT_CHANGED']
  ])('discards a visible screenshot when %s during capture', async (change, expectedCode) => {
    let activeTabId = 9
    let currentUrl = checkedUrl
    const update = vi.fn(async (tabId, options) => {
      if (options.active === true) activeTabId = tabId
    })
    const captureVisibleTab = vi.fn(async () => {
      if (change === 'URL changes') currentUrl = 'https://secret.example/account?tenant=B#changed'
      else activeTabId = 8
      return 'data:image/png;base64,c2VjcmV0'
    })
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
      tabs: {
        captureVisibleTab,
        get: vi.fn(async () => ({ id: 4, url: currentUrl, windowId: 2 })),
        query: vi.fn(async () => [{ id: activeTabId }]),
        update
      },
      webNavigation: {
        getAllFrames: vi.fn(async () => [{ documentId: 'document-4', frameId: 0, url: currentUrl }])
      },
      windows: { update: vi.fn(async () => undefined) }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    await expect(pageOperation('screenshot', guarded, vi.fn())).rejects.toMatchObject({ code: expectedCode })
    expect(captureVisibleTab).toHaveBeenCalledOnce()
    expect(update).toHaveBeenLastCalledWith(9, { active: true })
  })

  it('does not download MHTML when the target changes while Chrome captures the blob', async () => {
    let currentUrl = checkedUrl
    const download = vi.fn(async () => 11)
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
      tabs: { get: vi.fn(async () => ({ id: 4, url: currentUrl })) },
      webNavigation: {
        getAllFrames: vi.fn(async () => [{ documentId: 'document-4', frameId: 0, url: currentUrl }])
      },
      pageCapture: {
        saveAsMHTML: vi.fn(async () => {
          currentUrl = 'https://example.com/account?tenant=B#changed'
          return new Blob(['secret'])
        })
      },
      downloads: { download }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    await expect(pageOperation('save_mhtml', guarded, vi.fn())).rejects.toMatchObject({
      code: 'TARGET_URL_CHANGED'
    })
    expect(download).not.toHaveBeenCalled()
  })

  it.each(['screenshot', 'save_mhtml'])(
    'discards %s output when the main document changes without a URL change',
    async action => {
      let documentId = 'document-A'
      let activeTabId = 4
      const download = vi.fn(async () => 11)
      const chromeMock = {
        permissions: { contains: vi.fn(async () => true) },
        tabs: {
          captureVisibleTab: vi.fn(async () => {
            documentId = 'document-B'
            return 'data:image/png;base64,c2VjcmV0'
          }),
          get: vi.fn(async () => ({ id: 4, url: checkedUrl, windowId: 2 })),
          query: vi.fn(async () => [{ id: activeTabId }]),
          update: vi.fn(async (tabId, options) => {
            if (options.active === true) activeTabId = tabId
          })
        },
        webNavigation: {
          getAllFrames: vi.fn(async () => [{ documentId, frameId: 0, url: checkedUrl }])
        },
        windows: { update: vi.fn(async () => undefined) },
        pageCapture: {
          saveAsMHTML: vi.fn(async () => {
            documentId = 'document-B'
            return new Blob(['secret'])
          })
        },
        downloads: { download }
      }
      vi.stubGlobal('chrome', chromeMock)
      // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
      const { pageOperation } = await import('../extension/operations/page.js')

      await expect(pageOperation(action, { ...guarded, document_id: 'document-A' }, vi.fn())).rejects.toMatchObject({
        code: 'TARGET_DOCUMENT_CHANGED'
      })
      if (action === 'save_mhtml') expect(download).not.toHaveBeenCalled()
    }
  )

  it.each(['screenshot', 'save_mhtml'])(
    'rejects %s before capture when the caller-bound document is already stale',
    async action => {
      const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,dW5leHBlY3RlZA==')
      const saveAsMHTML = vi.fn(async () => new Blob(['unexpected']))
      const download = vi.fn(async () => 11)
      vi.stubGlobal('chrome', {
        permissions: { contains: vi.fn(async () => true) },
        tabs: {
          captureVisibleTab,
          get: vi.fn(async () => ({ id: 4, url: checkedUrl, windowId: 2 })),
          query: vi.fn(async () => [{ id: 4 }]),
          update: vi.fn(async () => undefined)
        },
        webNavigation: {
          getAllFrames: vi.fn(async () => [{ documentId: 'successor-document', frameId: 0, url: checkedUrl }])
        },
        windows: { update: vi.fn(async () => undefined) },
        pageCapture: { saveAsMHTML },
        downloads: { download }
      })
      // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
      const { pageOperation } = await import('../extension/operations/page.js')

      const failure = await pageOperation(action, guarded, vi.fn()).catch((error: unknown) => error)
      expect(failure).toMatchObject({
        code: action === 'screenshot' ? 'DOCUMENT_CHANGED' : 'TARGET_DOCUMENT_CHANGED'
      })
      expect(captureVisibleTab).not.toHaveBeenCalled()
      expect(saveAsMHTML).not.toHaveBeenCalled()
      expect(download).not.toHaveBeenCalled()
      expect(JSON.stringify(failure)).not.toContain('successor-document')
      expect(JSON.stringify(failure)).not.toContain(checkedUrl)
    }
  )

  it.each(['screenshot', 'save_mhtml'])(
    'requires a main document identity for %s',
    async action => {
      vi.stubGlobal('chrome', {
        permissions: { contains: vi.fn(async () => true) },
        tabs: {
          get: vi.fn(async () => ({ id: 4, url: checkedUrl, windowId: 2 })),
          query: vi.fn(async () => [{ id: 4 }])
        },
        webNavigation: {
          getAllFrames: vi.fn(async () => [{ documentId: 'document-4', frameId: 0, url: checkedUrl }])
        },
        windows: { update: vi.fn(async () => undefined) }
      })
      // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
      const { pageOperation } = await import('../extension/operations/page.js')

      await expect(pageOperation(action, {
        expected_targets: guarded.expected_targets,
        tab_id: guarded.tab_id
      }, vi.fn())).rejects.toMatchObject({ code: 'DOCUMENT_ID_REQUIRED' })
    }
  )

  it.each(['screenshot', 'save_mhtml'])('rejects a child-frame target for tab-wide %s capture', async action => {
    vi.stubGlobal('chrome', {})
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    await expect(pageOperation(action, { ...guarded, frame_id: 7 }, vi.fn())).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
  })

  it('fails closed when MHTML document identity permission is unavailable', async () => {
    const saveAsMHTML = vi.fn(async () => new Blob(['unexpected']))
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn(async request => !request.permissions?.includes('webNavigation'))
      },
      pageCapture: { saveAsMHTML }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    await expect(pageOperation('save_mhtml', guarded, vi.fn())).rejects.toMatchObject({
      code: 'MISSING_PERMISSION',
      missing_permissions: expect.arrayContaining(['webNavigation'])
    })
    expect(saveAsMHTML).not.toHaveBeenCalled()
  })

  it('discards a visible screenshot after an active-tab ABA switch', async () => {
    let activeTabId = 4
    const activated = chromeEvent<[{ tabId: number; windowId: number }]>()
    const captureVisibleTab = vi.fn(async () => {
      activeTabId = 8
      activated.emit({ tabId: 8, windowId: 2 })
      activeTabId = 4
      activated.emit({ tabId: 4, windowId: 2 })
      return 'data:image/png;base64,d3JvbmctdGFi'
    })
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
      tabs: {
        captureVisibleTab,
        get: vi.fn(async () => ({ id: 4, url: checkedUrl, windowId: 2 })),
        onActivated: activated,
        query: vi.fn(async () => [{ id: activeTabId }]),
        update: vi.fn(async (tabId, options) => {
          if (options.active === true) activeTabId = tabId
        })
      },
      webNavigation: {
        getAllFrames: vi.fn(async () => [{ documentId: 'document-4', frameId: 0, url: checkedUrl }])
      },
      windows: { update: vi.fn(async () => undefined) }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    await expect(pageOperation('screenshot', guarded, vi.fn())).rejects.toMatchObject({
      code: 'TARGET_DOCUMENT_CHANGED'
    })
    expect(captureVisibleTab).toHaveBeenCalledOnce()
    expect(activated.listenerCount()).toBe(0)
  })

  it('does not download an MHTML capture after a URL ABA navigation', async () => {
    const historyUpdated = chromeEvent<[{ frameId: number; tabId: number; url: string }]>()
    const download = vi.fn(async () => 11)
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
      tabs: { get: vi.fn(async () => ({ id: 4, url: checkedUrl })) },
      webNavigation: {
        getAllFrames: vi.fn(async () => [{ documentId: 'document-4', frameId: 0, url: checkedUrl }]),
        onHistoryStateUpdated: historyUpdated
      },
      pageCapture: {
        saveAsMHTML: vi.fn(async () => {
          historyUpdated.emit({ frameId: 0, tabId: 4, url: 'https://secret.example/private' })
          historyUpdated.emit({ frameId: 0, tabId: 4, url: checkedUrl })
          return new Blob(['secret'])
        })
      },
      downloads: { download }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    await expect(pageOperation('save_mhtml', guarded, vi.fn())).rejects.toMatchObject({
      code: 'TARGET_DOCUMENT_CHANGED'
    })
    expect(download).not.toHaveBeenCalled()
    expect(historyUpdated.listenerCount()).toBe(0)
  })

  it('restores the originally focused window after a visible screenshot', async () => {
    const updateWindow = vi.fn(async () => undefined)
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
      tabs: {
        captureVisibleTab: vi.fn(async () => 'data:image/png;base64,c2FmZQ=='),
        get: vi.fn(async () => ({ id: 4, url: checkedUrl, windowId: 2 })),
        query: vi.fn(async () => [{ id: 4 }]),
        update: vi.fn(async () => undefined)
      },
      webNavigation: {
        getAllFrames: vi.fn(async () => [{ documentId: 'document-4', frameId: 0, url: checkedUrl }])
      },
      windows: {
        getLastFocused: vi.fn(async () => ({ id: 7 })),
        update: updateWindow
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    await expect(pageOperation('screenshot', guarded, vi.fn())).resolves.toMatchObject({ tab_id: 4 })
    expect(updateWindow).toHaveBeenNthCalledWith(1, 2, { focused: true })
    expect(updateWindow).toHaveBeenNthCalledWith(2, 7, { focused: true })
  })

  it('rejects sensitive typing after an exact path/query/fragment identity change', async () => {
    const executeScript = vi.fn(async () => [])
    vi.stubGlobal('chrome', {
      storage: {
        session: { get: vi.fn(async () => ({ oneWorksExternalBrowserAdvancedAccess: { sensitive_fields: true } })) }
      },
      permissions: { contains: vi.fn(async () => true) },
      tabs: {
        get: vi.fn(async () => ({ id: 4, url: 'https://example.com/account?tenant=B#changed', windowId: 2 }))
      },
      scripting: { executeScript },
      webNavigation: { getAllFrames: vi.fn(async () => []) }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    await expect(pageOperation('type_sensitive', {
      ...guarded,
      document_id: 'document-4',
      ref: 'password',
      text: 'secret'
    }, vi.fn())).rejects.toMatchObject({ code: 'TARGET_URL_CHANGED' })
    expect(executeScript).not.toHaveBeenCalled()
  })

  it.each(['cursor injection', 'tab activity injection'])(
    'does not execute sensitive typing when the URL changes after %s',
    async driftPoint => {
      let currentUrl = checkedUrl
      const changedUrl = 'https://secret.example/account?token=never-log-this#changed'
      const executeScript = vi.fn(async request => {
        if (driftPoint === 'cursor injection' && request.files?.includes('cursor-runtime.js')) {
          currentUrl = changedUrl
        }
        if (
          driftPoint === 'tab activity injection' &&
          request.func?.name === 'semanticTabActivity' &&
          request.args?.[0]?.action === 'begin'
        ) {
          currentUrl = changedUrl
        }
        return []
      })
      vi.stubGlobal('chrome', {
        storage: {
          session: { get: vi.fn(async () => ({ oneWorksExternalBrowserAdvancedAccess: { sensitive_fields: true } })) }
        },
        permissions: { contains: vi.fn(async () => true) },
        runtime: { getURL: vi.fn(path => `chrome-extension://oneworks/${path}`) },
        tabs: { get: vi.fn(async () => ({ id: 4, url: currentUrl, windowId: 2 })) },
        scripting: { executeScript },
        webNavigation: {
          getAllFrames: vi.fn(async () => [{ documentId: 'document-4', frameId: 0, url: currentUrl }])
        }
      })
      // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
      const { pageOperation } = await import('../extension/operations/page.js')

      const failure = await pageOperation('type_sensitive', {
        ...guarded,
        cursor_session_id: 'cursor-session',
        document_id: 'document-4',
        ref: 'password',
        text: 'secret'
      }, vi.fn()).catch((error: unknown) => error)

      expect(failure).toMatchObject({ code: 'TARGET_URL_CHANGED' })
      expect(executeScript.mock.calls.some(([request]) => request.func?.name === 'semanticPageOperation')).toBe(false)
      expect(JSON.stringify(failure)).not.toContain(changedUrl)
      expect(JSON.stringify(failure)).not.toContain(checkedUrl)
    }
  )

  it('binds sensitive typing to the exact document in the isolated scripting world', async () => {
    const executeScript = vi.fn(async request =>
      request.func?.name === 'semanticPageOperation'
        ? [{ result: { typed: 'password' } }]
        : []
    )
    vi.stubGlobal('chrome', {
      storage: {
        session: { get: vi.fn(async () => ({ oneWorksExternalBrowserAdvancedAccess: { sensitive_fields: true } })) }
      },
      permissions: { contains: vi.fn(async () => true) },
      runtime: { getURL: vi.fn(path => `chrome-extension://oneworks/${path}`) },
      tabs: { get: vi.fn(async () => ({ id: 4, url: checkedUrl, windowId: 2 })) },
      scripting: { executeScript },
      webNavigation: {
        getAllFrames: vi.fn(async () => [{ documentId: 'document-4', frameId: 0, url: checkedUrl }])
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    await expect(pageOperation('type_sensitive', {
      ...guarded,
      cursor_session_id: 'cursor-session',
      ref: 'password',
      text: 'secret'
    }, vi.fn())).resolves.toMatchObject({ typed: 'password' })
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
      args: [expect.objectContaining({ expected_document_url_sha256: targetFingerprint })],
      target: { documentIds: ['document-4'], tabId: 4 },
      world: 'ISOLATED'
    }))
  })

  it.each([
    ['same-URL successor document', 'TARGET_DOCUMENT_CHANGED'],
    ['URL drift', 'TARGET_URL_CHANGED']
  ])('discards a sensitive snapshot after %s', async (drift, expectedCode) => {
    let currentDocumentId = 'document-A'
    let currentUrl = checkedUrl
    let semanticRequest: Record<string, unknown> | undefined
    const successorUrl = 'https://secret.example/account?token=never-log-this#changed'
    const executeScript = vi.fn(async request => {
      if (request.func?.name !== 'semanticPageOperation') return []
      semanticRequest = request
      if (drift === 'same-URL successor document') currentDocumentId = 'document-B'
      else currentUrl = successorUrl
      return [{ result: { elements: [{ sensitive: true, value: 'successor-secret' }] } }]
    })
    vi.stubGlobal('chrome', {
      storage: {
        session: { get: vi.fn(async () => ({ oneWorksExternalBrowserAdvancedAccess: { sensitive_fields: true } })) }
      },
      permissions: { contains: vi.fn(async () => true) },
      runtime: { getURL: vi.fn(path => `chrome-extension://oneworks/${path}`) },
      tabs: { get: vi.fn(async () => ({ id: 4, url: currentUrl, windowId: 2 })) },
      scripting: { executeScript },
      webNavigation: {
        getAllFrames: vi.fn(
          async () => [{ documentId: currentDocumentId, frameId: 0, url: currentUrl }]
        )
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    const failure = await pageOperation('snapshot_sensitive', {
      ...guarded,
      document_id: 'document-A'
    }, vi.fn()).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: expectedCode })
    expect(semanticRequest).toMatchObject({
      args: [expect.objectContaining({ expected_document_url_sha256: targetFingerprint })],
      target: { documentIds: ['document-A'], tabId: 4 },
      world: 'ISOLATED'
    })
    expect(JSON.stringify(failure)).not.toContain('successor-secret')
    expect(JSON.stringify(failure)).not.toContain(successorUrl)
    expect(JSON.stringify(failure)).not.toContain(checkedUrl)
  })

  it('rechecks the isolated document URL immediately before sensitive DOM mutation', async () => {
    const location = { href: checkedUrl }
    const focus = vi.fn()
    class FakeElement {
      isConnected = true
      isContentEditable = false
      labels = []
      innerText = ''
      value = 'unchanged'
      focus = focus
      dispatchEvent = vi.fn()
      getAttribute(name: string) {
        return name === 'aria-label' ? 'Password' : null
      }
    }
    class FakeInput extends FakeElement {
      type = 'password'
    }
    const node = new FakeInput()
    const digest = Uint8Array.from(Buffer.from(targetFingerprint, 'hex')).buffer
    vi.stubGlobal('Element', FakeElement)
    vi.stubGlobal('HTMLInputElement', FakeInput)
    vi.stubGlobal('HTMLTextAreaElement', class extends FakeElement {})
    vi.stubGlobal('location', location)
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn(async () => {
          location.href = 'https://secret.example/account?token=never-log-this#changed'
          return digest
        })
      }
    })
    vi.stubGlobal('__oneWorksChromeState', {
      generation: 1,
      refs: new Map([['password', node]])
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { semanticPageOperation } = await import('../extension/operations/page.js')

    const failure = await semanticPageOperation({
      action: 'type',
      allow_sensitive_fields: true,
      expected_document_url_sha256: targetFingerprint,
      ref: 'password',
      text: 'secret'
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'TARGET_URL_CHANGED' })
    expect(node.value).toBe('unchanged')
    expect(focus).not.toHaveBeenCalled()
    expect(JSON.stringify(failure)).not.toContain(location.href)
    expect(JSON.stringify(failure)).not.toContain(checkedUrl)
  })

  it('checks the isolated document URL before reading sensitive snapshot values', async () => {
    let valueReads = 0
    const location = { href: checkedUrl }
    class FakeElement {
      checked = false
      disabled = false
      innerText = ''
      isContentEditable = false
      labels = []
      tagName = 'INPUT'
      get value() {
        valueReads += 1
        return 'must-not-be-read'
      }
      getAttribute(name: string) {
        return name === 'aria-label' ? 'Password' : null
      }
      getBoundingClientRect() {
        return { height: 20, width: 160, x: 0, y: 0 }
      }
    }
    class FakeInput extends FakeElement {
      type = 'password'
    }
    const digest = Uint8Array.from(Buffer.from(targetFingerprint, 'hex')).buffer
    vi.stubGlobal('Element', FakeElement)
    vi.stubGlobal('HTMLInputElement', FakeInput)
    vi.stubGlobal('HTMLTextAreaElement', class extends FakeElement {})
    vi.stubGlobal('HTMLSelectElement', class extends FakeElement {})
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' }))
    vi.stubGlobal('document', {
      body: { innerText: '' },
      querySelectorAll: () => [new FakeInput()],
      readyState: 'complete',
      title: 'Secrets'
    })
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('innerWidth', 1200)
    vi.stubGlobal('location', location)
    vi.stubGlobal('scrollX', 0)
    vi.stubGlobal('scrollY', 0)
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn(async () => {
          location.href = 'https://secret.example/account?token=never-log-this#changed'
          return digest
        })
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { semanticPageOperation } = await import('../extension/operations/page.js')

    await expect(semanticPageOperation({
      action: 'snapshot',
      allow_sensitive_fields: true,
      expected_document_url_sha256: targetFingerprint
    })).rejects.toMatchObject({ code: 'TARGET_URL_CHANGED' })
    expect(valueReads).toBe(0)
  })
})
