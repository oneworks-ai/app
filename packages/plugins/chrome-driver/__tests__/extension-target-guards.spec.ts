import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

const targetFingerprint = (value: string) => createHash('sha256').update(new URL(value).toString()).digest('hex')

afterEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('chrome extension execution target guards', () => {
  it('fails guarded operations closed when an older bridge omits expected targets', async () => {
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { assertCommandExpectedTargets } = await import('../extension/operations/target-guard.js')
    for (const op of ['raw.evaluate', 'debug.screenshot', 'page.screenshot', 'page.type_sensitive']) {
      await expect(assertCommandExpectedTargets(op, undefined)).rejects.toMatchObject({
        code: 'INVALID_TARGET_GUARD'
      })
    }
    await expect(assertCommandExpectedTargets('tabs.reload', undefined)).resolves.toBeUndefined()
    await expect(assertCommandExpectedTargets('debug.detach', undefined)).resolves.toBeUndefined()
  })

  it('restores the previous active tab when a visible screenshot target changes', async () => {
    let activeTabId = 9
    let targetChecks = 0
    const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,unexpected')
    const update = vi.fn(async (tabId, options) => {
      if (options.active === true) activeTabId = tabId
    })
    const get = vi.fn(async () => ({
      id: 4,
      url: targetChecks++ < 3 ? 'https://example.com/checked' : 'https://other.example/navigated',
      windowId: 2
    }))
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
      tabs: {
        captureVisibleTab,
        get,
        query: vi.fn(async () => [{ id: activeTabId }]),
        update
      },
      webNavigation: {
        getAllFrames: vi.fn(async () => [{ documentId: 'document-4', frameId: 0, url: 'https://example.com/checked' }])
      },
      windows: { update: vi.fn(async () => undefined) }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    await expect(pageOperation('screenshot', {
      document_id: 'document-4',
      expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint('https://example.com/checked') }],
      tab_id: 4
    }, vi.fn())).rejects.toMatchObject({ code: 'TARGET_URL_CHANGED' })
    expect(captureVisibleTab).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(4, { active: true })
    expect(update).toHaveBeenCalledWith(9, { active: true })
  })

  it.each(['screenshot', 'print_to_pdf'])(
    'detaches before enabling debugger domains when the %s target changes after attach',
    async action => {
      const sendCommand = vi.fn(async () => ({}))
      const detach = vi.fn(async () => undefined)
      const get = vi.fn()
        .mockResolvedValueOnce({ id: 4, url: 'https://example.com/checked' })
        .mockResolvedValueOnce({ id: 4, url: 'https://other.example/navigated' })
      vi.stubGlobal('chrome', {
        tabs: { get },
        debugger: {
          attach: vi.fn(async () => undefined),
          detach,
          sendCommand,
          onEvent: { addListener: vi.fn() },
          onDetach: { addListener: vi.fn() }
        }
      })
      // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
      const { debugOperation } = await import('../extension/operations/debug.js')

      await expect(debugOperation(action, {
        expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint('https://example.com/checked') }],
        tab_id: 4
      })).rejects.toMatchObject({ code: 'TARGET_URL_CHANGED' })
      expect(sendCommand).not.toHaveBeenCalled()
      expect(detach).toHaveBeenCalledWith({ tabId: 4 })
      await expect(debugOperation('status', { tab_id: 4 })).resolves.toMatchObject({ attached: false })
    }
  )

  it.each([
    ['Runtime.enable', 2],
    ['Network.enable', 3],
    ['caller guard', 5]
  ])('detaches a newly owned debugger attachment when the URL changes during %s', async (_stage, stableGets) => {
    let getCount = 0
    const get = vi.fn(async () => ({
      id: 4,
      url: getCount++ < Number(stableGets) ? 'https://example.com/checked' : 'https://example.com/changed'
    }))
    const detach = vi.fn(async () => undefined)
    const sendCommand = vi.fn(async (_target, method) =>
      method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main-frame' } } } : {}
    )
    vi.stubGlobal('chrome', {
      tabs: { get },
      debugger: {
        attach: vi.fn(async () => undefined),
        detach,
        sendCommand,
        onEvent: { addListener: vi.fn() },
        onDetach: { addListener: vi.fn() }
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { debugOperation } = await import('../extension/operations/debug.js')

    await expect(debugOperation('screenshot', {
      expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint('https://example.com/checked') }],
      tab_id: 4
    })).rejects.toMatchObject({ code: 'TARGET_URL_CHANGED' })
    expect(sendCommand).not.toHaveBeenCalledWith({ tabId: 4 }, 'Page.captureScreenshot', expect.anything())
    expect(detach).toHaveBeenCalledWith({ tabId: 4 })
    await expect(debugOperation('status', { tab_id: 4 })).resolves.toMatchObject({ attached: false })
  })

  it('does not detach an existing attachment for a normal debugger command error', async () => {
    const detach = vi.fn(async () => undefined)
    const sendCommand = vi.fn(async (_target, method) => {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main-frame' } } }
      if (method === 'Page.captureScreenshot') {
        throw Object.assign(new Error('Capture failed'), { code: 'CAPTURE_FAILED' })
      }
      return {}
    })
    vi.stubGlobal('chrome', {
      tabs: { get: vi.fn(async () => ({ id: 4, url: 'https://example.com/checked' })) },
      debugger: {
        attach: vi.fn(async () => undefined),
        detach,
        sendCommand,
        onEvent: { addListener: vi.fn() },
        onDetach: { addListener: vi.fn() }
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { debugOperation } = await import('../extension/operations/debug.js')
    const guarded = {
      expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint('https://example.com/checked') }],
      tab_id: 4
    }

    await expect(debugOperation('attach', guarded)).resolves.toMatchObject({ attached: true })
    await expect(debugOperation('screenshot', guarded)).rejects.toMatchObject({ code: 'CAPTURE_FAILED' })
    expect(detach).not.toHaveBeenCalled()
    await expect(debugOperation('status', { tab_id: 4 })).resolves.toMatchObject({ attached: true })
  })

  it('detects a same-URL top-level reload while the initial debugger attachment is provisional', async () => {
    let onEvent: ((source: { tabId: number }, method: string, params: Record<string, any>) => void) | undefined
    const detach = vi.fn(async () => undefined)
    const sendCommand = vi.fn(async (_target, method) => {
      if (method === 'Page.enable') {
        onEvent!({ tabId: 4 }, 'Page.frameNavigated', {
          frame: { id: 'main-frame', loaderId: 'reload-loader', url: 'https://example.com/checked' }
        })
      }
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'main-frame', loaderId: 'reload-loader' } } }
      }
      return {}
    })
    vi.stubGlobal('chrome', {
      tabs: { get: vi.fn(async () => ({ id: 4, url: 'https://example.com/checked' })) },
      debugger: {
        attach: vi.fn(async () => undefined),
        detach,
        sendCommand,
        onEvent: {
          addListener: vi.fn(listener => {
            onEvent = listener
          })
        },
        onDetach: { addListener: vi.fn() }
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { debugOperation } = await import('../extension/operations/debug.js')

    await expect(debugOperation('attach', {
      expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint('https://example.com/checked') }],
      tab_id: 4
    })).rejects.toMatchObject({ code: 'TARGET_DOCUMENT_CHANGED' })
    await vi.waitFor(() => expect(detach).toHaveBeenCalledWith({ tabId: 4 }))
    await expect(debugOperation('status', { tab_id: 4 })).resolves.toMatchObject({
      attached: false,
      buffered_events: 0
    })
  })

  it('allows debugger detach to clean up after the target URL changes', async () => {
    const detach = vi.fn(async () => undefined)
    vi.stubGlobal('chrome', {
      tabs: { get: vi.fn(async () => ({ id: 4, url: 'https://example.com/checked' })) },
      debugger: {
        attach: vi.fn(async () => undefined),
        detach,
        sendCommand: vi.fn(async () => ({})),
        onEvent: { addListener: vi.fn() },
        onDetach: { addListener: vi.fn() }
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { debugOperation } = await import('../extension/operations/debug.js')
    const guarded = {
      expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint('https://example.com/checked') }],
      tab_id: 4
    }
    await expect(debugOperation('attach', guarded)).resolves.toMatchObject({ attached: true })
    await expect(debugOperation('detach', {
      ...guarded,
      expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint('https://other.example/changed') }]
    })).resolves.toMatchObject({ attached: false })
    expect(detach).toHaveBeenCalledWith({ tabId: 4 })
  })

  it('fails a raw debugger command closed on a same-origin path change and detaches', async () => {
    const sendCommand = vi.fn(async () => ({}))
    const detach = vi.fn(async () => undefined)
    const get = vi.fn()
      .mockResolvedValueOnce({ id: 4, url: 'https://example.com/checked' })
      .mockResolvedValueOnce({ id: 4, url: 'https://example.com/checked' })
      .mockResolvedValueOnce({ id: 4, url: 'https://example.com/changed' })
    vi.stubGlobal('chrome', {
      storage: {
        session: { get: vi.fn(async () => ({ oneWorksExternalBrowserAdvancedAccess: { raw_debugger: true } })) }
      },
      tabs: { get },
      debugger: {
        attach: vi.fn(async () => undefined),
        detach,
        sendCommand,
        onEvent: { addListener: vi.fn() },
        onDetach: { addListener: vi.fn() }
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { rawDebugOperation } = await import('../extension/operations/raw-debug.js')

    await expect(rawDebugOperation('evaluate', {
      expected_origin: 'https://example.com',
      expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint('https://example.com/checked') }],
      expression: 'document.title',
      tab_id: 4
    })).rejects.toMatchObject({ code: 'TARGET_URL_CHANGED' })
    expect(sendCommand).not.toHaveBeenCalled()
    expect(detach).toHaveBeenCalledWith({ tabId: 4 })
  })

  it.each([
    [
      'query',
      'https://example.com/account?tenant=A#stable',
      'https://example.com/account?tenant=B#stable'
    ],
    [
      'fragment',
      'https://example.com/account?tenant=A#section-a',
      'https://example.com/account?tenant=A#section-b'
    ]
  ])('rejects raw CDP on a same-path %s identity change without exposing the URL', async (_kind, checked, changed) => {
    let getCount = 0
    const get = vi.fn(async () => ({ id: 4, url: getCount++ < 7 ? checked : changed }))
    const detach = vi.fn(async () => undefined)
    const sendCommand = vi.fn(async (_target, method) =>
      method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main-frame' } } } : {}
    )
    vi.stubGlobal('chrome', {
      storage: {
        session: { get: vi.fn(async () => ({ oneWorksExternalBrowserAdvancedAccess: { raw_debugger: true } })) }
      },
      tabs: { get },
      debugger: {
        attach: vi.fn(async () => undefined),
        detach,
        sendCommand,
        onEvent: { addListener: vi.fn() },
        onDetach: { addListener: vi.fn() }
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { rawDebugOperation } = await import('../extension/operations/raw-debug.js')

    const failure = await rawDebugOperation('evaluate', {
      expected_origin: 'https://example.com',
      expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint(checked) }],
      expression: 'document.title',
      tab_id: 4
    }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'TARGET_URL_CHANGED' })
    expect(JSON.stringify(failure)).not.toContain(checked)
    expect(JSON.stringify(failure)).not.toContain(changed)
    expect(sendCommand).not.toHaveBeenCalledWith({ tabId: 4 }, 'Runtime.evaluate', expect.anything())
    expect(detach).toHaveBeenCalledWith({ tabId: 4 })
  })

  it('detaches and clears buffered debugger data on top-level same-document navigation', async () => {
    let onEvent: ((source: { tabId: number }, method: string, params: Record<string, any>) => void) | undefined
    const detach = vi.fn(async () => undefined)
    const sendCommand = vi.fn(async (_target, method) =>
      method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main-frame' } } } : {}
    )
    vi.stubGlobal('chrome', {
      tabs: { get: vi.fn(async () => ({ id: 4, url: 'https://example.com/account?tenant=A#first' })) },
      debugger: {
        attach: vi.fn(async () => undefined),
        detach,
        sendCommand,
        onEvent: {
          addListener: vi.fn(listener => {
            onEvent = listener
          })
        },
        onDetach: { addListener: vi.fn() }
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { debugOperation } = await import('../extension/operations/debug.js')
    const guarded = {
      expected_targets: [{
        tab_id: 4,
        url_sha256: targetFingerprint('https://example.com/account?tenant=A#first')
      }],
      tab_id: 4
    }
    await expect(debugOperation('attach', guarded)).resolves.toMatchObject({ attached: true })
    onEvent!({ tabId: 4 }, 'Runtime.consoleAPICalled', { args: [{ description: 'before' }], type: 'log' })
    await expect(debugOperation('status', { tab_id: 4 })).resolves.toMatchObject({
      attached: true,
      buffered_events: 1
    })

    onEvent!(
      { tabId: 4 },
      'Page.navigatedWithinDocument',
      { frameId: 'main-frame', url: 'https://example.com/account?tenant=A#second' }
    )
    await vi.waitFor(() => expect(detach).toHaveBeenCalledWith({ tabId: 4 }))
    await expect(debugOperation('status', { tab_id: 4 })).resolves.toMatchObject({
      attached: false,
      buffered_events: 0
    })
  })

  it('rejects MHTML capture when the execution-time target no longer matches', async () => {
    const saveAsMHTML = vi.fn(async () => new Blob())
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
      tabs: { get: vi.fn(async () => ({ id: 4, url: 'https://other.example/navigated' })) },
      webNavigation: {
        getAllFrames: vi.fn(
          async () => [{ documentId: 'document-4', frameId: 0, url: 'https://other.example/navigated' }]
        )
      },
      pageCapture: { saveAsMHTML },
      downloads: { download: vi.fn(async () => 1) }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    await expect(pageOperation('save_mhtml', {
      document_id: 'document-4',
      expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint('https://example.com/checked') }],
      tab_id: 4
    }, vi.fn())).rejects.toMatchObject({ code: 'TARGET_URL_CHANGED' })
    expect(saveAsMHTML).not.toHaveBeenCalled()
  })

  it('keeps semantic document guards after adding the expected URL guard', async () => {
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
      tabs: { get: vi.fn(async () => ({ id: 4, url: 'https://example.com/checked', windowId: 2 })) },
      webNavigation: {
        getAllFrames: vi.fn(
          async () => [{ documentId: 'document-new', frameId: 0, url: 'https://example.com/checked' }]
        )
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { pageOperation } = await import('../extension/operations/page.js')

    await expect(pageOperation('click', {
      document_id: 'document-checked',
      expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint('https://example.com/checked') }],
      ref: 'button-1',
      tab_id: 4
    }, vi.fn())).rejects.toMatchObject({ code: 'DOCUMENT_CHANGED' })
  })
})
