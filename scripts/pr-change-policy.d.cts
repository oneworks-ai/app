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

declare const policyCore: {
  evaluatePrChangePolicy(input: PrChangePolicyInput): PrChangePolicyResult
  hasExperienceReviewChecklist(body: string | undefined): boolean
  hasPolicyConflictReviewChecklist(body: string | undefined): boolean
}

export = policyCore
