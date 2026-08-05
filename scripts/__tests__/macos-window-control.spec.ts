import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildMacosWindowRaiseActions, raiseMacosWindow } from '../macos-window-control'

describe('macOS window control', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('raises, activates, and focuses the exact application process window', () => {
    expect(buildMacosWindowRaiseActions(4242)).toEqual([
      'tell application "System Events" to set frontmost of first application process whose unix id is 4242 to true',
      'tell application "System Events" to tell first application process whose unix id is 4242 to tell window 1 to perform action "AXRaise"',
      'tell application "System Events" to tell first application process whose unix id is 4242 to tell window 1 to set value of attribute "AXMain" to true',
      'tell application "System Events" to tell first application process whose unix id is 4242 to tell window 1 to set value of attribute "AXFocused" to true'
    ])
  })

  it('does not run an action when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const runAction = vi.fn()

    await expect(raiseMacosWindow({
      context: 'test',
      ownerPid: 4242,
      runAction,
      signal: controller.signal
    })).rejects.toThrow('aborted')
    expect(runAction).not.toHaveBeenCalled()
  })

  it('stops between actions when aborted during execution', async () => {
    const controller = new AbortController()
    const runAction = vi.fn(async () => {
      controller.abort()
    })

    await expect(raiseMacosWindow({
      context: 'test',
      ownerPid: 4242,
      runAction,
      signal: controller.signal
    })).rejects.toThrow('aborted')
    expect(runAction).toHaveBeenCalledTimes(1)
  })

  it('caps every action timeout at the remaining total deadline', async () => {
    let currentMs = 1_000
    const timeouts: number[] = []
    const runAction = vi.fn(async (_action: string, options: { timeoutMs: number }) => {
      timeouts.push(options.timeoutMs)
      currentMs += 40
    })

    await expect(raiseMacosWindow({
      context: 'test',
      now: () => currentMs,
      ownerPid: 4242,
      runAction,
      waitMs: 100
    })).rejects.toThrow('Could not raise macOS window')
    expect(timeouts).toEqual([100, 60, 20])
  })

  it('retries after an action failure and then succeeds', async () => {
    let currentMs = 1_000
    const runAction = vi.fn()
      .mockRejectedValueOnce(new Error('window not ready'))
      .mockResolvedValue(undefined)
    const wait = vi.fn(async (ms: number) => {
      currentMs += ms
    })

    await expect(raiseMacosWindow({
      context: 'test',
      now: () => currentMs,
      ownerPid: 4242,
      pollMs: 25,
      runAction,
      sleep: wait,
      waitMs: 200
    })).resolves.toBeUndefined()
    expect(wait).toHaveBeenCalledWith(25, undefined)
    expect(runAction).toHaveBeenCalledTimes(5)
  })

  it('preserves the final action failure as the timeout cause', async () => {
    let currentMs = 1_000
    const finalFailure = new Error('accessibility unavailable')

    await expect(raiseMacosWindow({
      context: 'test',
      now: () => currentMs,
      ownerPid: 4242,
      runAction: async () => {
        throw finalFailure
      },
      sleep: async ms => {
        currentMs += ms
      },
      waitMs: 50
    })).rejects.toMatchObject({ cause: finalFailure })
  })
})
