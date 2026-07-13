import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('chrome extension typed operations', () => {
  it('reuses the stored cursor session when an MV3 worker restarts on the same connection', async () => {
    const { normalizeStoredCursorSession, selectCursorSession } = await import(
      // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
      '../extension/operations/cursor-session.js'
    )
    const storedSession = normalizeStoredCursorSession({
      connection_id: 'connection-1',
      cursor_session_id: 'cursor-session-1'
    })
    const createId = vi.fn(() => 'cursor-session-new')

    expect(selectCursorSession({
      connectionId: 'connection-1',
      createId,
      previousConnection: undefined,
      reused: true,
      storedSession
    })).toBe('cursor-session-1')
    expect(createId).not.toHaveBeenCalled()
    expect(selectCursorSession({
      connectionId: 'connection-2',
      createId,
      previousConnection: undefined,
      reused: true,
      storedSession
    })).toBe('cursor-session-new')
  })

  it('returns bookmark operations through explicit Chrome APIs', async () => {
    const getAll = vi.fn(async () => ({ permissions: ['bookmarks'], origins: [] }))
    const create = vi.fn(async input => ({ id: '42', ...input }))
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => true), getAll }, bookmarks: { create } })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { bookmarksOperation } = await import('../extension/operations/browser-data.js')
    await expect(bookmarksOperation('create', { title: 'Evidence', url: 'https://example.com/' })).resolves
      .toMatchObject({ id: '42', title: 'Evidence' })
    expect(create).toHaveBeenCalledWith({
      parentId: undefined,
      index: undefined,
      title: 'Evidence',
      url: 'https://example.com/'
    })
  })

  it('reports missing optional permissions with a recoverable action', async () => {
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => false) } })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { requirePermissions } = await import('../extension/operations/shared.js')
    await expect(requirePermissions(['history'])).rejects.toMatchObject({
      code: 'MISSING_PERMISSION',
      missing_permissions: ['history']
    })
  })

  it('never returns cookie values from metadata reads', async () => {
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
      cookies: {
        getAll: vi.fn(
          async () => [{
            name: 'sid',
            value: 'super-secret',
            domain: '.example.com',
            hostOnly: false,
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
            session: true,
            storeId: '0'
          }]
        )
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { cookiesOperation } = await import('../extension/operations/browser-data.js')
    const result = await cookiesOperation('list_metadata', { domain: 'example.com' })
    expect(JSON.stringify(result)).not.toContain('super-secret')
    expect(result).toMatchObject([{ name: 'sid', domain: '.example.com', http_only: true }])
  })

  it('returns complete cookie values only after the session switch is enabled', async () => {
    const sessionState: Record<string, unknown> = {}
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
      storage: {
        session: {
          get: vi.fn(async key => ({ [key]: sessionState[key] })),
          set: vi.fn(async value => Object.assign(sessionState, value))
        }
      },
      cookies: {
        getAll: vi.fn(
          async () => [{
            name: 'sid',
            value: 'super-secret',
            domain: '.example.com',
            hostOnly: false,
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
            session: true,
            storeId: '0'
          }]
        )
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { cookiesOperation } = await import('../extension/operations/browser-data.js')
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { setAdvancedAccessPolicy } = await import('../extension/operations/security.js')

    await expect(cookiesOperation('list_with_values', { url: 'https://example.com/' })).rejects.toMatchObject({
      advanced_access_key: 'cookie_values',
      code: 'ADVANCED_ACCESS_DISABLED'
    })
    await setAdvancedAccessPolicy('cookie_values', true)
    await expect(cookiesOperation('list_with_values', { url: 'https://example.com/' })).resolves.toMatchObject({
      cookies: [expect.objectContaining({ name: 'sid', value: 'super-secret' })],
      origin: 'https://example.com'
    })
  })

  it('runs Runtime.evaluate only for an enabled switch and matching explicit origin', async () => {
    const sendCommand = vi.fn(async (_target, method) =>
      method === 'Runtime.evaluate'
        ? { result: { value: 'raw-secret' } }
        : {}
    )
    vi.stubGlobal('chrome', {
      storage: {
        session: { get: vi.fn(async () => ({ oneWorksExternalBrowserAdvancedAccess: { raw_debugger: true } })) }
      },
      tabs: { get: vi.fn(async () => ({ id: 4, url: 'https://example.com/path' })) },
      debugger: {
        attach: vi.fn(async () => undefined),
        sendCommand,
        onEvent: { addListener: vi.fn() },
        onDetach: { addListener: vi.fn() }
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { rawDebugOperation } = await import('../extension/operations/raw-debug.js')

    await expect(rawDebugOperation('evaluate', {
      tab_id: 4,
      expected_origin: 'https://example.com',
      expression: 'localStorage.token'
    })).resolves.toMatchObject({
      expected_origin: 'https://example.com',
      method: 'Runtime.evaluate',
      result: { result: { value: 'raw-secret' } }
    })
    await expect(rawDebugOperation('evaluate', {
      tab_id: 4,
      expected_origin: 'https://other.example',
      expression: '1'
    })).rejects.toMatchObject({ code: 'ORIGIN_CHANGED' })
  })

  it('treats Raw access as the effective superset of cookie and sensitive-field switches', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: vi.fn(async () => ({
            oneWorksExternalBrowserAdvancedAccess: { raw_debugger: true, cookie_values: false, sensitive_fields: false }
          }))
        }
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { getAdvancedAccessPolicy, requireAdvancedAccess } = await import('../extension/operations/security.js')
    await expect(getAdvancedAccessPolicy()).resolves.toMatchObject({
      raw_debugger: true,
      cookie_values: true,
      sensitive_fields: true,
      raw_includes: ['cookie_values', 'sensitive_fields']
    })
    await expect(requireAdvancedAccess('cookie_values')).resolves.toMatchObject({ raw_debugger: true })
  })

  it('blocks host file-system CDP primitives even when Raw access is enabled', async () => {
    const sendCommand = vi.fn(async () => ({}))
    vi.stubGlobal('chrome', {
      storage: {
        session: { get: vi.fn(async () => ({ oneWorksExternalBrowserAdvancedAccess: { raw_debugger: true } })) }
      },
      tabs: { get: vi.fn(async () => ({ id: 4, url: 'https://example.com/path' })) },
      debugger: {
        attach: vi.fn(async () => undefined),
        sendCommand,
        onEvent: { addListener: vi.fn() },
        onDetach: { addListener: vi.fn() }
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { rawDebugOperation } = await import('../extension/operations/raw-debug.js')
    await expect(rawDebugOperation('cdp_command', {
      tab_id: 4,
      expected_origin: 'https://example.com',
      method: 'DOM.setFileInputFiles',
      params: { files: ['/Users/example/.ssh/id_ed25519'], nodeId: 1 }
    })).rejects.toMatchObject({ code: 'HOST_FILE_ACCESS_BLOCKED' })
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('blocks ordinary typing for token and OTP fields classified as sensitive', async () => {
    class FakeElement {
      isConnected = true
      isContentEditable = false
      labels = []
      innerText = ''
      value = ''
      constructor(readonly attributes: Record<string, string>) {}
      getAttribute(name: string) {
        return this.attributes[name] ?? null
      }
    }
    class FakeInput extends FakeElement {
      type = 'text'
    }
    vi.stubGlobal('Element', FakeElement)
    vi.stubGlobal('HTMLInputElement', FakeInput)
    vi.stubGlobal('HTMLTextAreaElement', class extends FakeElement {})
    vi.stubGlobal('__oneWorksChromeState', {
      generation: 1,
      refs: new Map([['token-ref', new FakeInput({ 'aria-label': 'API token' })], [
        'otp-ref',
        new FakeInput({ autocomplete: 'one-time-code' })
      ]])
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { semanticPageOperation } = await import('../extension/operations/page.js')

    for (const ref of ['token-ref', 'otp-ref']) {
      await expect(semanticPageOperation({ action: 'type', ref, text: 'secret', allow_sensitive_fields: false }))
        .rejects.toMatchObject({ code: 'SENSITIVE_FIELD_BLOCKED' })
    }
  })

  it('redacts credit-card autocomplete fields from ordinary snapshots', async () => {
    class FakeElement {
      isConnected = true
      isContentEditable = false
      labels = []
      innerText = ''
      tagName = 'INPUT'
      value = '4111111111111111'
      disabled = false
      checked = false
      constructor(readonly attributes: Record<string, string>) {}
      getAttribute(name: string) {
        return this.attributes[name] ?? null
      }
      getBoundingClientRect() {
        return { height: 20, width: 160, x: 0, y: 0 }
      }
    }
    class FakeInput extends FakeElement {
      type = 'text'
    }
    vi.stubGlobal('Element', FakeElement)
    vi.stubGlobal('HTMLInputElement', FakeInput)
    vi.stubGlobal('HTMLTextAreaElement', class extends FakeElement {})
    vi.stubGlobal('HTMLSelectElement', class extends FakeElement {})
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' }))
    vi.stubGlobal('document', {
      body: { innerText: '' },
      querySelectorAll: () => [new FakeInput({ autocomplete: 'cc-number' })],
      title: 'Checkout',
      readyState: 'complete'
    })
    vi.stubGlobal('location', { href: 'https://example.com/checkout' })
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('innerWidth', 1200)
    vi.stubGlobal('scrollX', 0)
    vi.stubGlobal('scrollY', 0)
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { semanticPageOperation } = await import('../extension/operations/page.js')

    await expect(semanticPageOperation({ action: 'snapshot', allow_sensitive_fields: false })).resolves.toMatchObject({
      elements: [{ sensitive: true, value: '[redacted]' }]
    })
  })

  it('rejects browsing-data types whose removal cannot be limited to the supplied origins', async () => {
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
      browsingData: { remove: vi.fn(async () => undefined) }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { browsingDataOperation } = await import('../extension/operations/browser-data.js')
    for (const action of ['preview_removal', 'remove']) {
      await expect(browsingDataOperation(action, {
        origins: ['https://example.com'],
        types: ['history']
      })).rejects.toMatchObject({ code: 'ORIGIN_FILTER_UNSUPPORTED' })
    }
  })

  it('allows basic tab control without the sensitive tabs permission', async () => {
    const reload = vi.fn(async () => undefined)
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => false) }, tabs: { reload } })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { tabsOperation } = await import('../extension/operations/browser-data.js')
    await expect(tabsOperation('reload', { tab_id: 9 })).resolves.toEqual({ reloaded: true, tab_id: 9 })
    expect(reload).toHaveBeenCalledWith(9, { bypassCache: undefined })
  })

  it('redacts secrets, sensitive URL parameters, and inline PAC scripts from results', async () => {
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { sanitizeResult } = await import('../extension/operations/shared.js')
    const value = sanitizeResult({
      url: 'https://user:pass@example.com/path?token=canary-secret&view=ok#fragment',
      text: 'Authorization: Bearer canary-secret',
      value: {
        pacScript: {
          data: 'function FindProxyForURL(){ return "canary-secret" }',
          url: 'https://example.com/proxy.pac'
        }
      }
    })
    expect(JSON.stringify(value)).not.toContain('canary-secret')
    expect(JSON.stringify(value)).not.toContain('user:pass')
    expect(value.value.pacScript).not.toHaveProperty('data')
  })

  it('preserves only marked sensitive element values in a sensitive snapshot result', async () => {
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { sanitizeSensitiveSnapshotResult } = await import('../extension/operations/shared.js')
    const value = sanitizeSensitiveSnapshotResult({
      url: 'https://example.com/?token=query-secret#fragment',
      text: 'Authorization: Bearer body-secret',
      elements: [
        { sensitive: true, value: 'password-secret' },
        { sensitive: false, value: 'Authorization: Bearer normal-secret' }
      ]
    })
    expect(value.elements[0].value).toBe('password-secret')
    expect(JSON.stringify(value)).not.toContain('query-secret')
    expect(JSON.stringify(value)).not.toContain('body-secret')
    expect(JSON.stringify(value)).not.toContain('normal-secret')
  })

  it('delivers an in-flight command with its immutable connection after another worker disconnects', async () => {
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { deliverCommand } = await import('../extension/operations/delivery.js')
    let globalConnection: Record<string, string> | undefined = {
      bridge_url: 'http://127.0.0.1:1',
      session_token: 'session-a'
    }
    const snapshot = globalConnection
    const post = vi.fn(async (_path, _body, token) => {
      expect(token).toBe('session-a')
      return { accepted: true }
    })
    await deliverCommand({ command_id: 'command-1' }, {
      connection: snapshot,
      execute: async () => {
        globalConnection = undefined
        return { changed: true }
      },
      post,
      sanitizeResult: (value: unknown) => value,
      sleep: async () => undefined,
      uploadLargeArtifact: async (value: unknown) => value
    })
    expect(globalConnection).toBeUndefined()
    expect(post).toHaveBeenCalledWith(
      '/v1/extensions/ack',
      expect.objectContaining({ command_id: 'command-1', bridge_url: snapshot.bridge_url, ok: true }),
      snapshot.session_token
    )
  })
})
