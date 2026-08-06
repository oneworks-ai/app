/**
 * Shared truth contract for mutations whose visibility and durability settle at
 * different points. A committed-indeterminate result must never be retried as a
 * new destructive mutation without reconciliation.
 */
export type MutationCommitState =
  | 'committed'
  | 'committed-degraded'
  | 'committed-indeterminate'

export interface MutationCommitResult {
  commitState: MutationCommitState
  warnings?: string[]
}

export interface MutationPreCommitFailureDetails {
  committed: false
  privateStaging?: 'retained'
}
