import { describe, expect, it, vi } from 'vitest'

import {
  createAssetTransaction,
  executeAssetCreate
} from '#~/components/knowledge-base/components/asset-create-transaction'

describe('knowledge asset create transaction', () => {
  it('claims synchronously before validation can await, making duplicate submits a no-op', () => {
    const transaction = createAssetTransaction()
    transaction.activate()
    expect(transaction.claim()).toBeDefined()
    expect(transaction.claim()).toBeUndefined()
  })

  it('invalidates stale close, switch, and unmount generations', () => {
    const transaction = createAssetTransaction()
    transaction.activate()
    const stale = transaction.claim()!
    transaction.activate()
    const current = transaction.claim()!
    expect(transaction.complete(stale)).toBe(false)
    expect(transaction.isCurrent(current)).toBe(true)
    transaction.invalidate()
    expect(transaction.isCurrent(current)).toBe(false)
  })

  it('claims before validation awaits and makes concurrent Enter/click submit a no-op', async () => {
    const transaction = createAssetTransaction()
    transaction.activate()
    let resolveValidation!: (value: string) => void
    const post = vi.fn(async () => undefined)
    const options = {
      transaction,
      validate: () =>
        new Promise<string>(resolve => {
          resolveValidation = resolve
        }),
      post,
      refresh: async () => undefined,
      onClaim: vi.fn(),
      closeCommitted: vi.fn(),
      onCreateFailure: vi.fn(),
      onRefreshFailure: vi.fn(),
      onSettled: vi.fn()
    }

    const first = executeAssetCreate(options)
    await expect(executeAssetCreate(options)).resolves.toEqual({ state: 'duplicate' })
    resolveValidation('review')
    await expect(first).resolves.toEqual({ state: 'created' })
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('does not let an old settlement clear the new modal loading owner', async () => {
    const transaction = createAssetTransaction()
    transaction.activate()
    let resolveOld!: (value: string) => void
    let loadingGeneration: number | undefined
    const settled = (generation: number) => {
      if (loadingGeneration === generation) loadingGeneration = undefined
    }
    const oldExecution = executeAssetCreate({
      transaction,
      validate: () =>
        new Promise<string>(resolve => {
          resolveOld = resolve
        }),
      post: async () => undefined,
      refresh: async () => undefined,
      onClaim: generation => {
        loadingGeneration = generation
      },
      closeCommitted: () => undefined,
      onCreateFailure: () => undefined,
      onRefreshFailure: () => undefined,
      onSettled: settled
    })
    transaction.activate()
    let resolveCurrent!: (value: string) => void
    const currentExecution = executeAssetCreate({
      transaction,
      validate: () =>
        new Promise<string>(resolve => {
          resolveCurrent = resolve
        }),
      post: async () => undefined,
      refresh: async () => undefined,
      onClaim: generation => {
        loadingGeneration = generation
      },
      closeCommitted: () => undefined,
      onCreateFailure: () => undefined,
      onRefreshFailure: () => undefined,
      onSettled: settled
    })
    const currentLoading = loadingGeneration
    resolveOld('stale')
    await expect(oldExecution).resolves.toEqual({ state: 'stale' })
    expect(loadingGeneration).toBe(currentLoading)
    resolveCurrent('current')
    await expect(currentExecution).resolves.toEqual({ state: 'created' })
    expect(loadingGeneration).toBeUndefined()
  })

  it('returns refresh-only retry after confirmed or indeterminate POST', async () => {
    for (const commitState of ['committed', 'committed-indeterminate'] as const) {
      const transaction = createAssetTransaction()
      transaction.activate()
      const post = vi.fn(async () => commitState)
      const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
      const result = await executeAssetCreate({
        transaction,
        validate: async () => 'review',
        post,
        refresh,
        onClaim: () => undefined,
        closeCommitted: () => undefined,
        onCreateFailure: () => undefined,
        onRefreshFailure: () => undefined,
        onSettled: () => undefined
      })
      await result.retryRefresh?.()
      expect(post).toHaveBeenCalledTimes(1)
      expect(refresh).toHaveBeenCalledTimes(2)
      expect(transaction.claim()).toBeUndefined()
    }
  })

  it('releases only explicit pre-commit failures for deliberate retry', async () => {
    const transaction = createAssetTransaction()
    transaction.activate()
    const post = vi.fn().mockRejectedValueOnce(new Error('committed false')).mockResolvedValueOnce('committed')
    const options = {
      transaction,
      validate: async () => 'review',
      post,
      refresh: async () => undefined,
      isIndeterminateFailure: () => false,
      onClaim: () => undefined,
      closeCommitted: () => undefined,
      onCreateFailure: () => undefined,
      onRefreshFailure: () => undefined,
      onSettled: () => undefined
    }
    await expect(executeAssetCreate(options)).resolves.toEqual({ state: 'failed' })
    await expect(executeAssetCreate(options)).resolves.toEqual({ state: 'created' })
    expect(post).toHaveBeenCalledTimes(2)
  })
})
