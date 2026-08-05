import type { MutationCommitState } from '@oneworks/types'

/** Keeps a modal submission tied to the generation that claimed it. */
export const createAssetTransaction = () => {
  let active = false
  let generation = 0
  let claimedGeneration: number | undefined

  const activate = () => {
    active = true
    generation += 1
    claimedGeneration = undefined
    return generation
  }

  const invalidate = () => {
    active = false
    generation += 1
    claimedGeneration = undefined
    return generation
  }

  return {
    activate,
    claim: () => {
      if (!active || claimedGeneration === generation) return undefined
      claimedGeneration = generation
      return generation
    },
    complete: (claimed: number) => {
      if (generation !== claimed) return false
      invalidate()
      return true
    },
    invalidate,
    isPending: () => active && claimedGeneration === generation,
    isCurrent: (claimed: number) => generation === claimed,
    release: (claimed: number) => {
      if (generation === claimed) claimedGeneration = undefined
    }
  }
}

export type AssetTransaction = ReturnType<typeof createAssetTransaction>

interface ExecuteAssetCreateOptions<T> {
  closeCommitted: () => void
  isIndeterminateFailure?: (error: unknown) => boolean
  onClaim: (generation: number) => void
  onCreateFailure: (error: unknown) => void
  onIndeterminate?: (error?: unknown) => void
  onRefreshFailure: (error: unknown, indeterminate: boolean) => void
  onSettled: (generation: number) => void
  post: (value: T) => Promise<MutationCommitState | undefined>
  refresh: () => Promise<unknown>
  transaction: AssetTransaction
  validate: () => Promise<T>
}

export interface AssetCreateExecution {
  state:
    | 'created'
    | 'created-refresh-failed'
    | 'duplicate'
    | 'failed'
    | 'indeterminate'
    | 'indeterminate-refresh-failed'
    | 'stale'
  retryRefresh?: () => Promise<unknown>
}

/** Owns the exact POST/refresh boundary for a claimed modal generation. */
export const executeAssetCreate = async <T>(
  options: ExecuteAssetCreateOptions<T>
): Promise<AssetCreateExecution> => {
  const generation = options.transaction.claim()
  if (generation == null) return { state: 'duplicate' }
  options.onClaim(generation)
  const settle = async (
    indeterminate: boolean,
    error?: unknown
  ): Promise<AssetCreateExecution> => {
    if (!options.transaction.complete(generation)) return { state: 'stale' }
    options.closeCommitted()
    if (indeterminate) options.onIndeterminate?.(error)
    try {
      await options.refresh()
      return { state: indeterminate ? 'indeterminate' : 'created' }
    } catch (refreshError) {
      options.onRefreshFailure(refreshError, indeterminate)
      return {
        state: indeterminate ? 'indeterminate-refresh-failed' : 'created-refresh-failed',
        retryRefresh: options.refresh
      }
    }
  }
  try {
    const value = await options.validate()
    if (!options.transaction.isCurrent(generation)) return { state: 'stale' }
    const commitState = await options.post(value)
    if (!options.transaction.isCurrent(generation)) return { state: 'stale' }
    return settle(commitState === 'committed-indeterminate')
  } catch (error) {
    if (!options.transaction.isCurrent(generation)) return { state: 'stale' }
    if (options.isIndeterminateFailure?.(error) === true) {
      return settle(true, error)
    }
    options.transaction.release(generation)
    options.onCreateFailure(error)
    return { state: 'failed' }
  } finally {
    options.onSettled(generation)
  }
}
