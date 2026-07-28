import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeCursorElement {
  dataset: Record<string, string>
  isConnected = true
  popoverOpen = false
  style: Record<string, string> = { opacity: '1', visibility: 'visible' }
  hidePopover = vi.fn(() => {
    this.popoverOpen = false
  })
  matches = vi.fn(() => this.popoverOpen)
  remove = vi.fn(() => {
    this.isConnected = false
  })
  showPopover = vi.fn(() => {
    this.popoverOpen = true
  })
  constructor(sessionId = 'cursor-session') {
    this.dataset = { oneworksCursorSessionId: sessionId }
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  vi.unstubAllGlobals()
  delete (globalThis as any).__oneWorksExternalBrowserCursor
  delete (globalThis as any).__oneWorksExternalBrowserInactiveCursorSessions
  delete (globalThis as any).__oneWorksExternalBrowserCursorRuntimeInstalled
})

async function setupRuntime({ active = true, deferred = false, sessionId = 'cursor-session' } = {}) {
  vi.useFakeTimers()
  const listeners = new Map<string, () => void>()
  const addListener = vi.fn()
  const removeListener = vi.fn()
  const original = new FakeCursorElement(sessionId)
  let currentElement = original
  let resolveValidation: (value: unknown) => void = () => undefined
  const sendMessage = deferred
    ? vi.fn(() =>
      new Promise(resolve => {
        resolveValidation = resolve
      })
    )
    : vi.fn().mockResolvedValue({ ok: true, result: { active } })
  const cursorState = { element: original, sessionId }
  vi.stubGlobal('HTMLElement', FakeCursorElement)
  vi.stubGlobal('document', { getElementById: () => currentElement.isConnected ? currentElement : undefined })
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener, removeListener }, sendMessage } })
  vi.stubGlobal('__oneWorksExternalBrowserCursor', cursorState)
  vi.stubGlobal('addEventListener', vi.fn((type: string, listener: () => void) => listeners.set(type, listener)))
  // @ts-expect-error -- Extension runtime intentionally remains plain browser JavaScript.
  await import('../extension/cursor-runtime.js')
  return {
    addListener,
    cursorState,
    listeners,
    original,
    removeListener,
    resolveValidation: (value: unknown) => resolveValidation(value),
    sendMessage,
    setCurrentElement: (element: FakeCursorElement) => {
      currentElement = element
    }
  }
}

describe('chrome extension persistent cursor runtime', () => {
  it('keeps the cursor visible until close_session marks it as closing', async () => {
    const { original } = await setupRuntime()
    original.style.opacity = '0'
    await vi.advanceTimersByTimeAsync(100)
    expect(original.style.opacity).toBe('1')
    expect(original.showPopover).toHaveBeenCalledOnce()
    original.dataset.oneworksCursorClosing = 'true'
    original.popoverOpen = false
    original.style.opacity = '0'
    await vi.advanceTimersByTimeAsync(200)
    expect(original.style.opacity).toBe('0')
    expect(original.showPopover).toHaveBeenCalledOnce()
  })

  it('restarts the visibility guard after an active BFCache restore', async () => {
    const { addListener, listeners, original, removeListener, sendMessage } = await setupRuntime()
    listeners.get('pagehide')?.()
    expect(original.style.visibility).toBe('hidden')
    original.style.opacity = '0'
    await vi.advanceTimersByTimeAsync(200)
    expect(original.style.opacity).toBe('0')
    expect(removeListener).toHaveBeenCalledOnce()
    listeners.get('pageshow')?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'oneworks:external-browser:cursor-session-active',
      cursor_session_id: 'cursor-session'
    })
    expect(original.style).toMatchObject({ opacity: '1', visibility: 'visible' })
    expect(addListener).toHaveBeenCalledTimes(2)
  })

  it('discards a cursor whose session closed while its document was cached', async () => {
    const { cursorState, listeners, original } = await setupRuntime({ active: false, sessionId: 'closed-session' })
    listeners.get('pagehide')?.()
    listeners.get('pageshow')?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(original.hidePopover).toHaveBeenCalledOnce()
    expect(original.remove).toHaveBeenCalledOnce()
    expect(original.style.opacity).toBe('0')
    expect(cursorState.element).toBeUndefined()
  })

  it('ignores an old inactive response after the same element moves to a new session', async () => {
    const { cursorState, listeners, original, resolveValidation } = await setupRuntime({
      deferred: true,
      sessionId: 'old-session'
    })
    listeners.get('pagehide')?.()
    listeners.get('pageshow')?.()
    original.dataset.oneworksCursorSessionId = 'new-session'
    cursorState.sessionId = 'new-session'
    resolveValidation({ ok: true, result: { active: false } })
    await vi.advanceTimersByTimeAsync(0)
    expect(original.remove).not.toHaveBeenCalled()
    expect(original.dataset.oneworksCursorClosing).toBeUndefined()
    expect(cursorState.element).toBe(original)
  })

  it('discards a replacement cursor that still belongs to the inactive session', async () => {
    const { listeners, original, resolveValidation, setCurrentElement } = await setupRuntime({
      deferred: true,
      sessionId: 'old-session'
    })
    listeners.get('pagehide')?.()
    listeners.get('pageshow')?.()
    const replacement = new FakeCursorElement('old-session')
    original.isConnected = false
    setCurrentElement(replacement)
    resolveValidation({ ok: true, result: { active: false } })
    await vi.advanceTimersByTimeAsync(0)
    expect(replacement.remove).toHaveBeenCalledOnce()
    expect(replacement.dataset.oneworksCursorClosing).toBe('true')
    expect(replacement.style.opacity).toBe('0')
  })

  it('preserves a replacement cursor that belongs to a newer session', async () => {
    const { listeners, original, resolveValidation, setCurrentElement } = await setupRuntime({
      deferred: true,
      sessionId: 'old-session'
    })
    listeners.get('pagehide')?.()
    listeners.get('pageshow')?.()
    const replacement = new FakeCursorElement('new-session')
    original.isConnected = false
    setCurrentElement(replacement)
    resolveValidation({ ok: true, result: { active: false } })
    await vi.advanceTimersByTimeAsync(0)
    expect(replacement.remove).not.toHaveBeenCalled()
    expect(replacement.dataset.oneworksCursorClosing).toBeUndefined()
    expect(replacement.style.opacity).toBe('1')
  })

  it('does not revive an inactive cursor that reattaches after validation', async () => {
    const { listeners, original, resolveValidation, setCurrentElement } = await setupRuntime({
      deferred: true,
      sessionId: 'old-session'
    })
    listeners.get('pagehide')?.()
    listeners.get('pageshow')?.()
    original.isConnected = false
    setCurrentElement(original)
    resolveValidation({ ok: true, result: { active: false } })
    await vi.advanceTimersByTimeAsync(0)
    const showCountAfterValidation = original.showPopover.mock.calls.length
    original.isConnected = true
    delete original.dataset.oneworksCursorClosing
    original.style.opacity = '1'
    await vi.advanceTimersByTimeAsync(100)
    expect(original.remove).toHaveBeenCalledTimes(2)
    expect(original.style.opacity).toBe('0')
    expect(original.showPopover).toHaveBeenCalledTimes(showCountAfterValidation)
  })
})
