import type { MutationCommitState } from '@oneworks/types'

import { ApiError } from './base'

export class AssetCreateCommitIndeterminateError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    super('Data asset creation may have committed; reconcile before retrying.')
    this.name = 'AssetCreateCommitIndeterminateError'
    this.cause = cause
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const getCommittedDetail = (error: ApiError) => isRecord(error.details) ? error.details.committed : undefined

const isDefinitePreCommitError = (error: unknown): error is ApiError =>
  error instanceof ApiError &&
  (error.status < 200 || error.status >= 300) &&
  getCommittedDetail(error) === false

export const isAssetCreateCommitIndeterminateError = (error: unknown) => {
  if (error instanceof AssetCreateCommitIndeterminateError) return true
  if (error instanceof ApiError) return !isDefinitePreCommitError(error)
  return false
}

export const normalizeAssetCreateFailure = (error: unknown): Error => {
  if (error instanceof AssetCreateCommitIndeterminateError || isDefinitePreCommitError(error)) return error
  return new AssetCreateCommitIndeterminateError(error)
}

interface AssetCreateResponse {
  asset: {
    commitState?: MutationCommitState
    kind: 'entity' | 'rule' | 'spec'
    path: string
    warnings?: string[]
  }
}

export const isAssetCreatePendingResponse = (
  value: unknown,
  status: number
): value is { operation: { id: string; state: 'pending' } } => (
  status === 202 && isRecord(value) && isRecord(value.operation) &&
  typeof value.operation.id === 'string' && value.operation.state === 'pending'
)

export const isAssetCreateStatusResponse = (
  value: unknown,
  status: number
): value is AssetCreateResponse => {
  if (!isRecord(value) || !isRecord(value.asset)) return false
  const { asset } = value
  const validAsset = (asset.kind === 'entity' || asset.kind === 'rule' || asset.kind === 'spec') &&
    typeof asset.path === 'string' &&
    (
      asset.commitState == null ||
      asset.commitState === 'committed' ||
      asset.commitState === 'committed-degraded' ||
      asset.commitState === 'committed-indeterminate'
    )
  if (!validAsset) return false
  if (status === 202) return asset.commitState === 'committed-indeterminate'
  if (status === 200) return asset.commitState !== 'committed-indeterminate'
  return false
}

const operationPollIntervalMs = 25
const operationTimeoutMs = 15_000

export const pollAssetCreateOperation = async (
  operationId: string,
  fetchStatus: (path: string) => Promise<{ data: unknown; status: number }>
) => {
  const deadline = Date.now() + operationTimeoutMs
  let poll = 0
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, operationPollIntervalMs))
    const status = await fetchStatus(
      `/api/ai/assets/operations/${encodeURIComponent(operationId)}?poll=${poll++}`
    )
    if (isAssetCreatePendingResponse(status.data, status.status)) continue
    if (isAssetCreateStatusResponse(status.data, status.status)) return status.data
    throw new AssetCreateCommitIndeterminateError(new Error('Invalid asset operation status'))
  }
  throw new AssetCreateCommitIndeterminateError(new Error('Asset operation status timed out'))
}
