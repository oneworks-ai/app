import { describe, expect, it, vi } from 'vitest'

import {
  createAssetTransaction,
  executeAssetCreate
} from '#~/components/knowledge-base/components/asset-create-transaction'

describe('knowledge asset create transaction', () => {
  it('claims synchronously before validation can await, making duplicate submits a no-op', () => {
    const transaction = createAssetTransaction()
    transaction.activate()

    const first = transaction.claim()
    const duplicate = transaction.claim()

    expect(first).toBeDefined()
    expect(duplicate).toBeUndefined()
  })

  it('invalidates a stale modal generation without allowing it to settle the next modal', () => {
    const transaction = createAssetTransaction()
    transaction.activate()
    const stale = transaction.claim()!
    transaction.activate()
    const current = transaction.claim()!

    expect(transaction.isCurrent(stale)).toBe(false)
    expect(transaction.complete(stale)).toBe(false)
    expect(transaction.isCurrent(current)).toBe(true)
  })

  it('closes a successful generation exactly once so refresh retry cannot re-post', () => {
    const transaction = createAssetTransaction()
    transaction.activate()
    const claimed = transaction.claim()!

    expect(transaction.complete(claimed)).toBe(true)
    expect(transaction.complete(claimed)).toBe(false)
    expect(transaction.claim()).toBeUndefined()
  })

  it('claims before validation awaits and makes a concurrent Enter/click submit a no-op', async () => {
    const transaction = createAssetTransaction()
    transaction.activate()
    let resolveValidation!: (value: string) => void
    const validate = () =>
      new Promise<string>(resolve => {
        resolveValidation = resolve
      })
    const post = vi.fn(async () => undefined)
    const options = {
      transaction,
      validate,
      post,
      refresh: async () => undefined,
      onClaim: vi.fn(),
      closeCommitted: vi.fn(),
      onCreateFailure: vi.fn(),
      onRefreshFailure: vi.fn(),
      onSettled: vi.fn()
    }

    const first = executeAssetCreate(options)
    const duplicate = await executeAssetCreate(options)
    resolveValidation('review')

    await expect(first).resolves.toMatchObject({ state: 'created' })
    expect(duplicate).toEqual({ state: 'duplicate' })
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('does not let an old generation settlement clear the new modal loading owner', async () => {
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

  it('returns a refresh-only retry after POST has committed', async () => {
    const transaction = createAssetTransaction()
    transaction.activate()
    const post = vi.fn(async () => undefined)
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)

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

    expect(result.state).toBe('created-refresh-failed')
    expect(post).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('closes and reconciles a returned indeterminate commit without another POST', async () => {
    const transaction = createAssetTransaction()
    transaction.activate()
    const post = vi.fn(async () => 'committed-indeterminate' as const)
    const refresh = vi.fn(async () => undefined)
    const closeCommitted = vi.fn()
    const onIndeterminate = vi.fn()

    const result = await executeAssetCreate({
      transaction,
      validate: async () => 'review',
      post,
      refresh,
      onClaim: () => undefined,
      closeCommitted,
      onCreateFailure: vi.fn(),
      onIndeterminate,
      onRefreshFailure: vi.fn(),
      onSettled: () => undefined
    })

    expect(result).toEqual({ state: 'indeterminate' })
    expect(post).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(closeCommitted).toHaveBeenCalledTimes(1)
    expect(onIndeterminate).toHaveBeenCalledTimes(1)
    expect(transaction.claim()).toBeUndefined()
  })

  it('turns a lost POST response into refresh-only retry without releasing the claim', async () => {
    const transaction = createAssetTransaction()
    transaction.activate()
    const lostResponse = new Error('response lost')
    const post = vi.fn(async () => {
      throw lostResponse
    })
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    const onCreateFailure = vi.fn()

    const result = await executeAssetCreate({
      transaction,
      validate: async () => 'review',
      post,
      refresh,
      isIndeterminateFailure: error => error === lostResponse,
      onClaim: () => undefined,
      closeCommitted: () => undefined,
      onCreateFailure,
      onIndeterminate: () => undefined,
      onRefreshFailure: () => undefined,
      onSettled: () => undefined
    })
    await result.retryRefresh?.()

    expect(result.state).toBe('indeterminate-refresh-failed')
    expect(post).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(onCreateFailure).not.toHaveBeenCalled()
    expect(transaction.claim()).toBeUndefined()
  })

  it('releases only an explicit pre-commit failure for a deliberate retry', async () => {
    const transaction = createAssetTransaction()
    transaction.activate()
    const post = vi.fn()
      .mockRejectedValueOnce(new Error('committed false'))
      .mockResolvedValueOnce('committed' as const)
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
