import { describe, expect, it, vi } from 'vitest'

import { PluginManager } from '#~/services/plugins/runtime.js'

interface ClientSourceCompileScheduler {
  runClientSourceCompile: <T>(compile: () => Promise<T>) => Promise<T>
}

describe('plugin client source runtime', () => {
  it('limits concurrent source compilation while draining queued modules', async () => {
    const manager = new PluginManager() as unknown as ClientSourceCompileScheduler
    let active = 0
    let completed = 0
    let maximumActive = 0
    let releaseCompiles = () => {}
    const compileGate = new Promise<void>((resolve) => {
      releaseCompiles = resolve
    })
    const compiles = Array.from({ length: 8 }, (_, index) =>
      manager.runClientSourceCompile(async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await compileGate
        active -= 1
        completed += 1
        return index
      }))

    await vi.waitFor(() => {
      expect(active).toBe(4)
    })
    expect(completed).toBe(0)

    releaseCompiles()
    await expect(Promise.all(compiles)).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(maximumActive).toBe(4)
    expect(completed).toBe(8)
  })
})
