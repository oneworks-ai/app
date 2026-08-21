import type { PrChangePolicyResult } from './pr-change-policy.cjs'
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

declare const changeCheckCore: {
  getWorkingTreeChanges(): string[]
  inspectPrChange(input: RunPrChangeCheckInput, defaultBase?: string): PrChangeInspection
  runPrChangeCheck(input: RunPrChangeCheckInput): void
}

export = changeCheckCore
