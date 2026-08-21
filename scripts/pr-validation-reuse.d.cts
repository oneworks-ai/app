import type { Buffer } from 'node:buffer'

export interface RevisionReuseChange {
  paths: string[]
  status: string
}

export interface AutofixCandidateResult {
  candidate: boolean
  changes: RevisionReuseChange[]
  reason: string
}

export interface ValidationReusePlanInput {
  action: string
  base: string
  baseChanged?: boolean
  before: string
  cwd?: string
  eventName: string
  head: string
}

export interface ValidationReusePlan {
  candidate: boolean
  evidenceBase: string
  evidenceHead: string
  mode: 'none' | 'exact' | 'eslint-autofix'
  reason: string
  safe: boolean
  version: number
}

export interface VerifyEslintAutofixInput {
  before: string
  cwd?: string
  eslintFix?: (input: { cwd: string; filePath: string; source: string }) => string
  head: string
}

export interface VerifyEslintAutofixResult extends AutofixCandidateResult {
  safe: boolean
}

export const maximumAutofixFiles: number
export function parseRawDiff(output: Buffer):
  | Array<{
    newMode: string
    oldMode: string
    status: string
  }>
  | null
export const prValidationReuseVersion: number
export const reusableSourcePathPattern: RegExp
export function classifyAutofixCandidate(input: {
  before: string
  cwd?: string
  head: string
}): AutofixCandidateResult
export function planValidationReuse(input: ValidationReusePlanInput): ValidationReusePlan
export function runEslintFix(input: { cwd: string; filePath: string; source: string }): string
export function verifyEslintAutofix(input: VerifyEslintAutofixInput): VerifyEslintAutofixResult
export function runPrValidationReuse(args?: string[]): ValidationReusePlan
