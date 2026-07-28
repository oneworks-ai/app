import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  vi.unstubAllGlobals()
  delete (globalThis as any).__oneWorksExternalBrowserCursor
  delete (globalThis as any).__oneWorksExternalBrowserInactiveCursorSessions
  delete (globalThis as any).__oneWorksExternalBrowserCursorRuntimeInstalled
  delete (globalThis as any).__oneWorksExternalBrowserFavicon
})

const faviconDocument = () => {
  const nodes = new Map<string, any>()
  let observerCallback: ((records: any[]) => void) | undefined
  class FakeLink {
    attributes: Record<string, string> = {}
    dataset: Record<string, string> = {}
    tagName = 'LINK'
    rel = ''
    href = ''
    id = ''
    get isConnected() {
      return nodes.get(this.id) === this
    }
    getAttribute(name: string) {
      return this.attributes[name] ?? (name === 'rel' ? this.rel || null : name === 'href' ? this.href || null : null)
    }
    querySelectorAll() {
      return []
    }
    remove() {
      nodes.delete(this.id)
    }
    setAttribute(name: string, value: string) {
      this.attributes[name] = value
      if (name === 'rel') this.rel = value
      if (name === 'href') this.href = value
    }
  }
  class FakeMutationObserver {
    constructor(callback: (records: any[]) => void) {
      observerCallback = callback
    }
    observe() {}
  }
  vi.stubGlobal('MutationObserver', FakeMutationObserver)
  vi.stubGlobal('document', {
    createElement: () => new FakeLink(),
    getElementById: (id: string) => nodes.get(id),
    head: { append: (node: FakeLink) => nodes.set(node.id, node) },
    querySelectorAll: () => [...nodes.values()]
  })
  return {
    FakeLink,
    nodes,
    trigger: (records: any[]) => observerCallback?.(records)
  }
}

const faviconInput = {
  cursor_url: 'chrome-extension://example/agent-cursor.svg',
  default_favicon_url: 'chrome-extension://example/default-tab-favicon.svg'
}

describe('chrome extension visible action indicators', () => {
  it('does not let stale cleanup remove a newer favicon lease and restores the no-site default', async () => {
    vi.useFakeTimers()
    const { nodes } = faviconDocument()
    const faviconState: Record<string, unknown> = {}
    vi.stubGlobal('__oneWorksExternalBrowserFavicon', faviconState)
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { semanticTabActivity } = await import('../extension/operations/page.js')
    await semanticTabActivity({ ...faviconInput, action: 'begin', activity_id: 'first' })
    const secondInput = { ...faviconInput, default_favicon_url: 'chrome-extension://example/second-default.svg' }
    await semanticTabActivity({ ...secondInput, action: 'begin', activity_id: 'second' })
    const staleCleanup = semanticTabActivity({
      ...faviconInput,
      action: 'end',
      activity_id: 'first',
      default_favicon_url: 'chrome-extension://example/stale-default.svg'
    })
    await vi.advanceTimersByTimeAsync(1_500)
    await staleCleanup
    expect(nodes.get('oneworks-external-browser-agent-favicon')?.dataset.oneworksActivityId).toBe('second')
    expect(faviconState).toMatchObject({
      activityId: 'second',
      defaultFaviconUrl: secondInput.default_favicon_url,
      restoreSource: undefined
    })
    const currentCleanup = semanticTabActivity({ ...secondInput, action: 'end', activity_id: 'second' })
    await vi.advanceTimersByTimeAsync(1_500)
    await currentCleanup
    expect(nodes.has('oneworks-external-browser-agent-favicon')).toBe(false)
    expect(nodes.get('oneworks-external-browser-restored-favicon')).toMatchObject({
      href: secondInput.default_favicon_url,
      dataset: { oneworksRestoredFavicon: 'default' }
    })
  })

  it('rebuilds an active lease after replace-all and restores all latest native attributes', async () => {
    vi.useFakeTimers()
    const { FakeLink, nodes, trigger } = faviconDocument()
    const siteFavicon = new FakeLink()
    siteFavicon.id = 'site-favicon'
    siteFavicon.rel = 'icon'
    siteFavicon.href = 'https://example.com/old.svg'
    siteFavicon.setAttribute('sizes', '16x16')
    nodes.set(siteFavicon.id, siteFavicon)
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { semanticTabActivity } = await import('../extension/operations/page.js')
    await semanticTabActivity({ ...faviconInput, action: 'begin', activity_id: 'dynamic' })
    expect(siteFavicon.rel).toBe('oneworks-suspended-icon')
    const standaloneRemovedAgent = nodes.get('oneworks-external-browser-agent-favicon')
    standaloneRemovedAgent.remove()
    trigger([{
      type: 'childList',
      addedNodes: [],
      removedNodes: [standaloneRemovedAgent]
    }])
    await Promise.resolve()
    expect(nodes.get('oneworks-external-browser-agent-favicon')).toMatchObject({
      dataset: { oneworksActivityId: 'dynamic' }
    })
    const removedAgent = nodes.get('oneworks-external-browser-agent-favicon')
    siteFavicon.remove()
    removedAgent.remove()
    const latestFavicon = new FakeLink()
    latestFavicon.id = 'latest-favicon'
    latestFavicon.rel = 'icon'
    latestFavicon.href = 'https://example.com/latest.png'
    latestFavicon.setAttribute('type', 'image/png')
    latestFavicon.setAttribute('sizes', '32x32')
    latestFavicon.setAttribute('media', '(prefers-color-scheme: dark)')
    nodes.set(latestFavicon.id, latestFavicon)
    trigger([{ type: 'childList', addedNodes: [latestFavicon], removedNodes: [siteFavicon, removedAgent] }])
    await Promise.resolve()
    expect(nodes.get('oneworks-external-browser-agent-favicon')).toMatchObject({
      dataset: { oneworksActivityId: 'dynamic' }
    })
    expect(latestFavicon.rel).toBe('oneworks-suspended-icon')
    const cleanup = semanticTabActivity({ ...faviconInput, action: 'end', activity_id: 'dynamic' })
    await vi.advanceTimersByTimeAsync(1_500)
    await cleanup
    expect(latestFavicon.rel).toBe('icon')
    expect(nodes.get('oneworks-external-browser-restored-favicon')).toMatchObject({
      attributes: {
        href: 'https://example.com/latest.png',
        media: '(prefers-color-scheme: dark)',
        rel: 'icon',
        sizes: '32x32',
        type: 'image/png'
      },
      dataset: { oneworksRestoredFavicon: 'site' }
    })
  })

  it('recomputes the idle restore when a native favicon rel stops being an icon', async () => {
    vi.useFakeTimers()
    const { FakeLink, nodes, trigger } = faviconDocument()
    const siteFavicon = new FakeLink()
    siteFavicon.id = 'site-favicon'
    siteFavicon.rel = 'icon'
    siteFavicon.href = 'https://example.com/site.png'
    nodes.set(siteFavicon.id, siteFavicon)
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { semanticTabActivity } = await import('../extension/operations/page.js')
    await semanticTabActivity({ ...faviconInput, action: 'begin', activity_id: 'rel-change' })
    const cleanup = semanticTabActivity({ ...faviconInput, action: 'end', activity_id: 'rel-change' })
    await vi.advanceTimersByTimeAsync(1_500)
    await cleanup
    siteFavicon.setAttribute('rel', 'stylesheet')
    trigger([{ type: 'attributes', attributeName: 'rel', oldValue: 'icon', target: siteFavicon }])
    await vi.runAllTicks()
    expect(nodes.get('oneworks-external-browser-restored-favicon')).toMatchObject({
      href: faviconInput.default_favicon_url,
      dataset: { oneworksRestoredFavicon: 'default' }
    })
  })

  it('only removes the cursor that belongs to the closed session', async () => {
    vi.useFakeTimers()
    class FakeImage {
      dataset: Record<string, string> = { oneworksCursorSessionId: 'first' }
      isConnected = true
      style: Record<string, string> = { opacity: '1' }
      remove() {
        this.isConnected = false
      }
    }
    const image = new FakeImage()
    const cursorState = {
      closedSessionIds: new Set<string>(),
      element: image,
      generation: 1,
      sessionId: 'first'
    }
    vi.stubGlobal('HTMLElement', FakeImage)
    vi.stubGlobal('HTMLImageElement', FakeImage)
    vi.stubGlobal('document', { getElementById: () => image })
    vi.stubGlobal('__oneWorksExternalBrowserCursor', cursorState)
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { semanticCursorLifecycle } = await import('../extension/operations/page.js')
    const staleCleanup = semanticCursorLifecycle({ action: 'close_session', cursor_session_id: 'first' })
    cursorState.sessionId = 'second'
    cursorState.generation += 1
    image.dataset.oneworksCursorSessionId = 'second'
    image.style.opacity = '1'
    await vi.advanceTimersByTimeAsync(240)
    await expect(staleCleanup).resolves.toEqual({ closed: true, removed: false })
    expect(image.isConnected).toBe(true)
    const currentCleanup = semanticCursorLifecycle({ action: 'close_session', cursor_session_id: 'second' })
    await vi.advanceTimersByTimeAsync(240)
    await expect(currentCleanup).resolves.toEqual({ closed: true, removed: true })
    expect(image.isConnected).toBe(false)
  })

  it('mounts a new session cursor in the body so document scrolling cannot move the fixed overlay away', async () => {
    vi.useFakeTimers()
    const inactiveCursorSessions = new Map([['cursor-session', 1]])
    class FakeElement {}
    class FakeImage {
      alt = ''
      dataset: Record<string, string> = {}
      isConnected = false
      popoverOpen = false
      src = ''
      style: Record<string, string> = {}
      animate = vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() }))
      matches = vi.fn(() => this.popoverOpen)
      showPopover = vi.fn(() => {
        this.popoverOpen = true
      })
      setAttribute = vi.fn()
    }
    const image = new FakeImage()
    const bodyAppend = vi.fn((node: FakeImage) => {
      node.isConnected = true
    })
    const scrollBy = vi.fn()
    vi.stubGlobal('Element', FakeElement)
    vi.stubGlobal('HTMLImageElement', FakeImage)
    vi.stubGlobal('innerHeight', 720)
    vi.stubGlobal('innerWidth', 1280)
    vi.stubGlobal('__oneWorksExternalBrowserInactiveCursorSessions', inactiveCursorSessions)
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { active: true } }) }
    })
    vi.stubGlobal('window', { scrollBy })
    vi.stubGlobal('document', {
      body: { append: bodyAppend },
      createElement: () => image,
      documentElement: { append: vi.fn() },
      visibilityState: 'visible'
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { semanticPageOperation } = await import('../extension/operations/page.js')
    const operation = semanticPageOperation({
      action: 'scroll',
      cursor_session_id: 'cursor-session',
      cursor_url: 'chrome-extension://example/agent-cursor.svg',
      x: 0,
      y: 520
    })
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(operation).resolves.toMatchObject({ cursor_visible: true, scrolled: true })
    expect(bodyAppend).toHaveBeenCalledWith(image)
    expect(image.setAttribute).toHaveBeenCalledWith('popover', 'manual')
    expect(image.showPopover).toHaveBeenCalledOnce()
    expect(inactiveCursorSessions.has('cursor-session')).toBe(false)
    expect(scrollBy).toHaveBeenCalledWith({ behavior: 'instant', left: 0, top: 520 })
    expect(image.style.opacity).toBe('1')
  })

  it('rejects a visible action when cleanup advances its cursor-session generation during validation', async () => {
    class FakeElement {}
    let resolveValidation: (value: unknown) => void = () => undefined
    const inactiveCursorSessions = new Map([['cursor-session', 1]])
    vi.stubGlobal('Element', FakeElement)
    vi.stubGlobal('window', { scrollBy: vi.fn() })
    vi.stubGlobal('__oneWorksExternalBrowserInactiveCursorSessions', inactiveCursorSessions)
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(() =>
          new Promise(resolve => {
            resolveValidation = resolve
          })
        )
      }
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { semanticPageOperation } = await import('../extension/operations/page.js')
    const operation = semanticPageOperation({
      action: 'scroll',
      cursor_session_id: 'cursor-session',
      cursor_url: 'chrome-extension://example/agent-cursor.svg',
      x: 0,
      y: 520
    })
    await Promise.resolve()
    inactiveCursorSessions.set('cursor-session', 2)
    resolveValidation({ ok: true, result: { active: true } })
    await expect(operation).rejects.toMatchObject({ code: 'CURSOR_SESSION_INACTIVE' })
  })

  it('does not let a throttled cursor animation block the semantic action', async () => {
    vi.useFakeTimers()
    class FakeElement {
      dispatchEvent = vi.fn()
      focus = vi.fn()
      getAttribute(name: string) {
        return name === 'aria-label' ? 'Evidence input' : null
      }
      getBoundingClientRect() {
        return { height: 24, left: 80, top: 60, width: 180 }
      }
    }
    class FakeInput extends FakeElement {
      isConnected = true
      isContentEditable = false
      labels: unknown[] = []
      type = 'text'
      value = ''
    }
    const cancel = vi.fn()
    class FakeImage {
      animate = vi.fn(() => ({ cancel, finished: new Promise(() => undefined) }))
      dataset: Record<string, string> = {}
      isConnected = true
      style: Record<string, string> = {}
    }
    const input = new FakeInput()
    const image = new FakeImage()
    vi.stubGlobal('Element', FakeElement)
    vi.stubGlobal('HTMLInputElement', FakeInput)
    vi.stubGlobal('HTMLTextAreaElement', class {})
    vi.stubGlobal('HTMLImageElement', FakeImage)
    vi.stubGlobal('innerHeight', 720)
    vi.stubGlobal('innerWidth', 1280)
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { active: true } }) }
    })
    vi.stubGlobal('document', { visibilityState: 'visible' })
    vi.stubGlobal('__oneWorksChromeState', { generation: 1, refs: new Map([['r1', input]]) })
    vi.stubGlobal('__oneWorksExternalBrowserCursor', {
      closedSessionIds: new Set<string>(),
      element: image,
      generation: 1,
      sessionId: 'cursor-session',
      x: 640,
      y: 360
    })
    // @ts-expect-error -- Extension modules intentionally remain plain browser JavaScript.
    const { semanticPageOperation } = await import('../extension/operations/page.js')
    const operation = semanticPageOperation({
      action: 'type',
      allow_sensitive_fields: false,
      cursor_session_id: 'cursor-session',
      cursor_url: 'chrome-extension://example/agent-cursor.svg',
      ref: 'r1',
      text: 'OneWorks'
    })
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(operation).resolves.toMatchObject({ typed: 'r1' })
    expect(input.value).toBe('OneWorks')
    expect(cancel).toHaveBeenCalledOnce()
  })
})
