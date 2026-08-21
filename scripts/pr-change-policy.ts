import policyCore from './pr-change-policy.cjs'

import type { ChangedPathEntry } from './pr-validation-scope.cjs'

export interface PrChangePolicyInput {
  changedPathEntries?: ChangedPathEntry[]
  changedFiles: string[]
  commitSubjects: string[]
  prBody?: string
}

export interface PrChangePolicyResult {
  hasChangelog: boolean
  hasExperienceReview: boolean
  hasPolicyConflictReview: boolean
  hasScreenshot: boolean
  requiresChangelog: boolean
  requiresPolicyConflictReview: boolean
  requiresScreenshot: boolean
  violations: string[]
}

export const hasExperienceReviewChecklist: (body: string | undefined) => boolean =
  policyCore.hasExperienceReviewChecklist

export const hasPolicyConflictReviewChecklist: (body: string | undefined) => boolean =
  policyCore.hasPolicyConflictReviewChecklist

export const evaluatePrChangePolicy: (input: PrChangePolicyInput) => PrChangePolicyResult =
  policyCore.evaluatePrChangePolicy
