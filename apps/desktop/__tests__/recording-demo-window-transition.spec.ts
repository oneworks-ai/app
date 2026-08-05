import { describe, expect, it, vi } from 'vitest'

import { runRecordingDemoWorkspaceTransition } from '../src/main/recording-demo-window-transition'

const createWindow = (bounds = { height: 560, width: 760, x: 10, y: 20 }) => {
  let currentBounds = bounds
  let destroyed = false
  return {
    destroy: () => {
      destroyed = true
    },
    focus: vi.fn(),
    getBounds: vi.fn(() => currentBounds),
    hide: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    moveTop: vi.fn(),
    setBounds: vi.fn((nextBounds) => {
      currentBounds = nextBounds
    }),
    setOpacity: vi.fn(),
    show: vi.fn(),
    showInactive: vi.fn()
  }
}

describe('recording demo workspace transition', () => {
  it('keeps the launcher visible until the workspace content is ready', async () => {
    vi.useFakeTimers()
    const sourceWindow = createWindow()
    const targetWindow = createWindow()
    let resolveLoad = () => {}
    const loadPromise = new Promise<void>(resolve => {
      resolveLoad = resolve
    })
    const resultPromise = runRecordingDemoWorkspaceTransition({
      loadPromise,
      sourceWindow: sourceWindow as never,
      targetBounds: { height: 1_050, width: 1_680, x: 100, y: 120 },
      targetWindow: targetWindow as never
    })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(sourceWindow.hide).not.toHaveBeenCalled()
    expect(targetWindow.setBounds).toHaveBeenCalledTimes(1)

    resolveLoad()
    await vi.runAllTimersAsync()
    await expect(resultPromise).resolves.toBe(true)
    expect(sourceWindow.hide).toHaveBeenCalledTimes(1)
    expect(targetWindow.setBounds).toHaveBeenLastCalledWith(
      { height: 1_050, width: 1_680, x: 100, y: 120 },
      false
    )
    vi.useRealTimers()
  })

  it('finishes at the workspace bounds and hides the source', async () => {
    vi.useFakeTimers()
    const sourceWindow = createWindow()
    const targetWindow = createWindow()
    const targetBounds = { height: 1_050, width: 1_680, x: 100, y: 120 }
    const resultPromise = runRecordingDemoWorkspaceTransition({
      loadPromise: Promise.resolve(),
      sourceWindow: sourceWindow as never,
      targetBounds,
      targetWindow: targetWindow as never
    })

    await vi.runAllTimersAsync()
    await expect(resultPromise).resolves.toBe(true)
    expect(targetWindow.setBounds).toHaveBeenLastCalledWith(targetBounds, false)
    expect(targetWindow.setOpacity).toHaveBeenLastCalledWith(1)
    expect(targetWindow.focus).toHaveBeenCalled()
    expect(sourceWindow.hide).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('keeps the source visible when the target is destroyed mid-transition', async () => {
    vi.useFakeTimers()
    const sourceWindow = createWindow()
    const targetWindow = createWindow()
    const resultPromise = runRecordingDemoWorkspaceTransition({
      loadPromise: Promise.resolve(),
      sourceWindow: sourceWindow as never,
      targetBounds: { height: 1_050, width: 1_680, x: 100, y: 120 },
      targetWindow: targetWindow as never
    })
    targetWindow.destroy()

    await vi.runAllTimersAsync()
    await expect(resultPromise).resolves.toBe(false)
    expect(sourceWindow.hide).not.toHaveBeenCalled()
    expect(sourceWindow.show).toHaveBeenCalled()
    expect(sourceWindow.focus).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('finishes the target when the source is destroyed mid-transition', async () => {
    vi.useFakeTimers()
    const sourceWindow = createWindow()
    const targetWindow = createWindow()
    const resultPromise = runRecordingDemoWorkspaceTransition({
      loadPromise: Promise.resolve(),
      sourceWindow: sourceWindow as never,
      targetBounds: { height: 1_050, width: 1_680, x: 100, y: 120 },
      targetWindow: targetWindow as never
    })
    sourceWindow.destroy()

    await vi.runAllTimersAsync()
    await expect(resultPromise).resolves.toBe(true)
    expect(targetWindow.show).toHaveBeenCalled()
    expect(targetWindow.focus).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('restores the source and hides the target when loading rejects', async () => {
    vi.useFakeTimers()
    const sourceWindow = createWindow()
    const targetWindow = createWindow()
    const resultPromise = runRecordingDemoWorkspaceTransition({
      loadPromise: Promise.reject(new Error('load failed')),
      sourceWindow: sourceWindow as never,
      targetBounds: { height: 1_050, width: 1_680, x: 100, y: 120 },
      targetWindow: targetWindow as never
    })
    const rejection = expect(resultPromise).rejects.toThrow('load failed')

    await vi.runAllTimersAsync()
    await rejection
    expect(sourceWindow.show).toHaveBeenCalled()
    expect(sourceWindow.focus).toHaveBeenCalled()
    expect(targetWindow.hide).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
