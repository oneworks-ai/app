import changeCheckCore from './pr-change-check.cjs'

import type { PrChangePolicyResult } from './pr-change-policy'
import type { ChangedPathEntry } from './pr-validation-scope.cjs'

export interface RunPrChangeCheckInput {
  base?: string
  body?: string
  bodyFile?: string
  head?: string
}

export interface PrChangeInspection {
  base?: string
  changedPathEntries: ChangedPathEntry[]
  changedFiles: string[]
  commitSubjects: string[]
  head: string
  result: PrChangePolicyResult
}

export {
  evaluatePrChangePolicy,
  hasExperienceReviewChecklist,
  hasPolicyConflictReviewChecklist
} from './pr-change-policy'
export type { PrChangePolicyInput, PrChangePolicyResult } from './pr-change-policy'

export const getWorkingTreeChanges: () => string[] = changeCheckCore.getWorkingTreeChanges

export const inspectPrChange: (
  input: RunPrChangeCheckInput,
  defaultBase?: string
) => PrChangeInspection = changeCheckCore.inspectPrChange

export const runPrChangeCheck = async (input: RunPrChangeCheckInput) => {
  changeCheckCore.runPrChangeCheck(input)
}
