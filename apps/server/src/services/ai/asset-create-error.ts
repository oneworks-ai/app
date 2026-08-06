import type { MutationPreCommitFailureDetails } from '@oneworks/types'

import { internalServerError, isHttpError } from '#~/utils/http.js'

export const ASSET_PRE_COMMIT_DETAILS: MutationPreCommitFailureDetails = {
  committed: false
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

export const markAssetPreCommitFailure = (
  error: unknown,
  message = 'Failed to create data asset',
  code = 'asset_create_failed'
) => {
  if (isHttpError(error)) {
    if (isRecord(error.details) && Object.hasOwn(error.details, 'committed')) return error
    error.details = {
      ...(isRecord(error.details) ? error.details : {}),
      committed: false
    }
    return error
  }
  return internalServerError(message, {
    cause: error,
    code,
    details: ASSET_PRE_COMMIT_DETAILS
  })
}
