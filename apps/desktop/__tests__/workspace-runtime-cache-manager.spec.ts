import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWorkspaceRuntimeCacheManager } from '../src/main/workspace-runtime-cache-manager'

const createDeferred = <T>() => {
  let reject!: (reason: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise
    resolve = resolvePromise
  })
  return { promise, reject, resolve }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('workspace runtime cache manager', () => {
  it('deduplicates concurrent refresh requests', async () => {
    const refresh = createDeferred<{ changed: number; source: 'bundled'; total: number }>()
    const runRefresh = vi.fn(() => refresh.promise)
    const manager = createWorkspaceRuntimeCacheManager({ runRefresh })

    const first = manager.refresh()
    const second = manager.refresh()

    await Promise.resolve()
    expect(runRefresh).toHaveBeenCalledTimes(1)
    refresh.resolve({ changed: 2, source: 'bundled', total: 15 })
    await expect(first).resolves.toMatchObject({ attempts: 1, status: 'ready' })
    await expect(second).resolves.toMatchObject({ attempts: 1, status: 'ready' })
  })

  it('aborts and waits for an active refresh during shutdown', async () => {
    let activeSignal: AbortSignal | undefined
    const runRefresh = vi.fn((signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        activeSignal = signal
        signal.addEventListener('abort', () => reject(new Error('refresh aborted')), { once: true })
      })
    )
    const manager = createWorkspaceRuntimeCacheManager({ runRefresh })
    const refresh = manager.refresh()
    const refreshRejected = expect(refresh).rejects.toThrow('refresh aborted')

    await Promise.resolve()
    await manager.stop()

    await refreshRejected
    expect(activeSignal?.aborted).toBe(true)
    expect(manager.getSnapshot()).toMatchObject({ status: 'stopped' })
  })

  it('allows a retry after a failed optional refresh', async () => {
    const runRefresh = vi.fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce({ changed: 0, source: 'bundled', total: 15 })
    const manager = createWorkspaceRuntimeCacheManager({ runRefresh })

    await expect(manager.refresh()).rejects.toThrow('disk unavailable')
    expect(manager.getSnapshot()).toMatchObject({ attempts: 1, status: 'error' })

    await expect(manager.refresh()).resolves.toMatchObject({ attempts: 2, status: 'ready' })
    expect(runRefresh).toHaveBeenCalledTimes(2)
  })

  it('recovers when a refresh runner throws before returning a promise', async () => {
    const runRefresh = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('runner setup failed')
      })
      .mockResolvedValueOnce({ changed: 0, source: 'bundled', total: 15 })
    const manager = createWorkspaceRuntimeCacheManager({ runRefresh })

    await expect(manager.refresh()).rejects.toThrow('runner setup failed')
    await expect(manager.refresh()).resolves.toMatchObject({ attempts: 2, status: 'ready' })
  })

  it('replaces a fallback schedule when core readiness permits an earlier refresh', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const runRefresh = vi.fn().mockResolvedValue({ changed: 0, source: 'bundled', total: 15 })
    const manager = createWorkspaceRuntimeCacheManager({ runRefresh })

    manager.schedule(30_000)
    manager.schedule(1_000)
    await vi.advanceTimersByTimeAsync(999)
    expect(runRefresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(runRefresh).toHaveBeenCalledTimes(1)
  })

  it('keeps built-in cache materialization out of the server startup path', async () => {
    const source = await readFile(path.resolve(__dirname, '../src/server-child.cjs'), 'utf8')

    expect(source).not.toContain('ensureBuiltinRuntimePackageCache')
    expect(source).not.toContain('ensureBuiltinAdapterPackageCache')
    expect(source).not.toContain('ensureBuiltinPluginPackageCache')
  })

  it('publishes extension caches before the selectable server runtime cache', async () => {
    const source = await readFile(path.resolve(__dirname, '../src/main/workspace-runtime-cache-refresh.ts'), 'utf8')

    expect(source.indexOf('ensureBuiltinPluginPackageCache')).toBeLessThan(
      source.indexOf('ensureBuiltinAdapterPackageCache')
    )
    expect(source.indexOf('ensureBuiltinAdapterPackageCache')).toBeLessThan(
      source.indexOf('ensureBuiltinRuntimePackageCache')
    )
  })
})
