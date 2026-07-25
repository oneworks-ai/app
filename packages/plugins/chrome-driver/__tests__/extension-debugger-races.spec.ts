import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

const targetUrl = 'https://example.com/checked'
const targetFingerprint = createHash('sha256').update(new URL(targetUrl).toString()).digest('hex')
const guarded = {
  expected_targets: [{ tab_id: 4, url_sha256: targetFingerprint }],
  tab_id: 4
}

afterEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(promiseResolve => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('chrome debugger attachment races', () => {
  it('does not let a delayed detach event from attachment A clear successor attachment B', async () => {
    let attachedTarget = false
    let onDetach: ((source: { tabId: number }) => void) | undefined
    const getTargets = vi.fn(async () => [{ attached: attachedTarget, tabId: 4 }])
    const attach = vi.fn(async () => {
      attachedTarget = true
    })
    const detach = vi.fn(async () => {
      attachedTarget = false
    })
    const sendCommand = vi.fn(async (_target, method) =>
      method === 'Page.getFrameTree'
        ? { frameTree: { frame: { id: 'main-frame', loaderId: 'stable-loader' } } }
        : {}
    )
    vi.stubGlobal('chrome', {
      tabs: { get: vi.fn(async () => ({ id: 4, url: targetUrl })) },
      debugger: {
        attach,
        detach,
        getTargets,
        sendCommand,
        onEvent: { addListener: vi.fn() },
        onDetach: {
          addListener: vi.fn(listener => {
            onDetach = listener
          })
        }
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { debugOperation } = await import('../extension/operations/debug.js')

    await expect(debugOperation('attach', guarded)).resolves.toMatchObject({ attached: true })
    await expect(debugOperation('detach', { tab_id: 4 })).resolves.toMatchObject({ attached: false })
    await expect(debugOperation('attach', guarded)).resolves.toMatchObject({ attached: true })

    const targetChecksBeforeStaleEvent = getTargets.mock.calls.length
    onDetach!({ tabId: 4 })
    await vi.waitFor(() => expect(getTargets.mock.calls.length).toBeGreaterThan(targetChecksBeforeStaleEvent))
    await expect(debugOperation('status', { tab_id: 4 })).resolves.toMatchObject({ attached: true })

    attachedTarget = false
    onDetach!({ tabId: 4 })
    await vi.waitFor(async () => {
      await expect(debugOperation('status', { tab_id: 4 })).resolves.toMatchObject({ attached: false })
    })
  })

  it('does not dispatch Page.captureScreenshot when navigation wins an awaited final guard', async () => {
    let onEvent:
      | ((source: { tabId: number }, method: string, params: Record<string, unknown>) => void)
      | undefined
    const tabGet = vi.fn(async () => ({ id: 4, url: targetUrl }))
    const sendCommand = vi.fn(async (_target, method) => {
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'main-frame', loaderId: 'stable-loader' } } }
      }
      if (method === 'Page.captureScreenshot') return { data: 'unexpected' }
      return {}
    })
    vi.stubGlobal('chrome', {
      tabs: { get: tabGet },
      debugger: {
        attach: vi.fn(async () => undefined),
        detach: vi.fn(async () => undefined),
        getTargets: vi.fn(async () => [{ attached: true, tabId: 4 }]),
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
    await debugOperation('attach', guarded)

    const guard = deferred<{ id: number; url: string }>()
    tabGet.mockImplementationOnce(() => guard.promise)
    const targetChecksBeforeOperation = tabGet.mock.calls.length
    const operation = debugOperation('screenshot', guarded)
    await vi.waitFor(() => expect(tabGet.mock.calls.length).toBeGreaterThan(targetChecksBeforeOperation))
    onEvent!(
      { tabId: 4 },
      'Page.navigatedWithinDocument',
      { frameId: 'main-frame', url: `${targetUrl}#changed` }
    )
    guard.resolve({ id: 4, url: targetUrl })

    await expect(operation).rejects.toMatchObject({ code: 'TARGET_DOCUMENT_CHANGED' })
    expect(sendCommand).not.toHaveBeenCalledWith({ tabId: 4 }, 'Page.captureScreenshot', expect.anything())
  })

  it('does not dispatch raw CDP when navigation wins an awaited final guard', async () => {
    let onEvent:
      | ((source: { tabId: number }, method: string, params: Record<string, unknown>) => void)
      | undefined
    const tabGet = vi.fn(async () => ({ id: 4, url: targetUrl }))
    const sendCommand = vi.fn(async (_target, method) =>
      method === 'Page.getFrameTree'
        ? { frameTree: { frame: { id: 'main-frame', loaderId: 'stable-loader' } } }
        : {}
    )
    vi.stubGlobal('chrome', {
      storage: {
        session: { get: vi.fn(async () => ({ oneWorksExternalBrowserAdvancedAccess: { raw_debugger: true } })) }
      },
      tabs: { get: tabGet },
      debugger: {
        attach: vi.fn(async () => undefined),
        detach: vi.fn(async () => undefined),
        getTargets: vi.fn(async () => [{ attached: true, tabId: 4 }]),
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
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { rawDebugOperation } = await import('../extension/operations/raw-debug.js')
    await debugOperation('attach', guarded)

    const guard = deferred<{ id: number; url: string }>()
    tabGet.mockImplementationOnce(() => guard.promise)
    const targetChecksBeforeOperation = tabGet.mock.calls.length
    const operation = rawDebugOperation('evaluate', {
      ...guarded,
      expected_origin: 'https://example.com',
      expression: 'document.title'
    })
    await vi.waitFor(() => expect(tabGet.mock.calls.length).toBeGreaterThan(targetChecksBeforeOperation))
    onEvent!(
      { tabId: 4 },
      'Page.navigatedWithinDocument',
      { frameId: 'main-frame', url: `${targetUrl}#changed` }
    )
    guard.resolve({ id: 4, url: targetUrl })

    await expect(operation).rejects.toMatchObject({ code: 'TARGET_DOCUMENT_CHANGED' })
    expect(sendCommand).not.toHaveBeenCalledWith({ tabId: 4 }, 'Runtime.evaluate', expect.anything())
  })

  it.each([
    ['debug screenshot', 'Page.captureScreenshot'],
    ['raw evaluation', 'Runtime.evaluate']
  ])('discards a successful %s result when navigation occurs during the command', async (kind, commandMethod) => {
    let onEvent:
      | ((source: { tabId: number }, method: string, params: Record<string, unknown>) => void)
      | undefined
    const sendCommand = vi.fn(async (_target, method) => {
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'main-frame', loaderId: 'stable-loader' } } }
      }
      if (method === commandMethod) {
        onEvent!(
          { tabId: 4 },
          'Page.navigatedWithinDocument',
          { frameId: 'main-frame', url: `${targetUrl}#changed` }
        )
        return method === 'Page.captureScreenshot' ? { data: 'discard-me' } : { result: { value: 'discard-me' } }
      }
      return {}
    })
    vi.stubGlobal('chrome', {
      storage: {
        session: { get: vi.fn(async () => ({ oneWorksExternalBrowserAdvancedAccess: { raw_debugger: true } })) }
      },
      tabs: { get: vi.fn(async () => ({ id: 4, url: targetUrl })) },
      debugger: {
        attach: vi.fn(async () => undefined),
        detach: vi.fn(async () => undefined),
        getTargets: vi.fn(async () => [{ attached: true, tabId: 4 }]),
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
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { rawDebugOperation } = await import('../extension/operations/raw-debug.js')
    await debugOperation('attach', guarded)

    const operation = kind === 'debug screenshot'
      ? debugOperation('screenshot', guarded)
      : rawDebugOperation('evaluate', {
        ...guarded,
        expected_origin: 'https://example.com',
        expression: 'document.title'
      })
    await expect(operation).rejects.toMatchObject({ code: 'TARGET_DOCUMENT_CHANGED' })
    expect(sendCommand).toHaveBeenCalledWith({ tabId: 4 }, commandMethod, expect.anything())
    await expect(debugOperation('status', { tab_id: 4 })).resolves.toMatchObject({ attached: false })
  })

  it.each([
    ['debug screenshot', 'loader', 'Page.captureScreenshot'],
    ['raw evaluation', 'isolate', 'Runtime.evaluate']
  ])(
    'discards a successful %s result when the %s identity changes before a delayed navigation event',
    async (kind, changedIdentity, commandMethod) => {
      let loaderId = 'loader-A'
      let isolateId = 'isolate-A'
      let onEvent:
        | ((source: { tabId: number }, method: string, params: Record<string, unknown>) => void)
        | undefined
      const sendCommand = vi.fn(async (_target, method) => {
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame', loaderId } } }
        }
        if (method === 'Runtime.getIsolateId') return { id: isolateId }
        if (method === commandMethod) {
          if (changedIdentity === 'loader') loaderId = 'loader-B'
          else isolateId = 'isolate-B'
          return method === 'Page.captureScreenshot' ? { data: 'discard-me' } : { result: { value: 'discard-me' } }
        }
        return {}
      })
      vi.stubGlobal('chrome', {
        storage: {
          session: { get: vi.fn(async () => ({ oneWorksExternalBrowserAdvancedAccess: { raw_debugger: true } })) }
        },
        tabs: { get: vi.fn(async () => ({ id: 4, url: targetUrl })) },
        debugger: {
          attach: vi.fn(async () => undefined),
          detach: vi.fn(async () => undefined),
          getTargets: vi.fn(async () => [{ attached: true, tabId: 4 }]),
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
      // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
      const { rawDebugOperation } = await import('../extension/operations/raw-debug.js')
      await debugOperation('attach', guarded)
      onEvent!(
        { tabId: 4 },
        'Runtime.consoleAPICalled',
        { args: [{ description: 'discard buffered event' }], type: 'log' }
      )

      const operation = kind === 'debug screenshot'
        ? debugOperation('screenshot', guarded)
        : rawDebugOperation('evaluate', {
          ...guarded,
          expected_origin: 'https://example.com',
          expression: 'document.title'
        })
      await expect(operation).rejects.toMatchObject({ code: 'TARGET_DOCUMENT_CHANGED' })
      expect(sendCommand).toHaveBeenCalledWith({ tabId: 4 }, commandMethod, expect.anything())
      await expect(debugOperation('status', { tab_id: 4 })).resolves.toEqual({
        attached: false,
        buffered_events: 0,
        tab_id: 4
      })
    }
  )
})
