import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

import { evaluatePrChangePolicy } from './pr-change-policy'

export interface RunPrChangeCheckInput {
  base?: string
  body?: string
  bodyFile?: string
  head?: string
}

export { evaluatePrChangePolicy, hasExperienceReviewChecklist } from './pr-change-policy'
export type { PrChangePolicyInput, PrChangePolicyResult } from './pr-change-policy'

const runGit = (args: string[]) => (
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
)

const splitLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean)

const normalizeRef = (value: string | undefined) => {
  const ref = value?.trim()
  return ref == null || ref === '' || /^0+$/u.test(ref) ? undefined : ref
}

const readPrBody = (input: RunPrChangeCheckInput) => {
  if (input.bodyFile != null && input.bodyFile.trim() !== '') {
    return readFileSync(input.bodyFile, 'utf8')
  }
  return input.body
}

const getChangedFiles = (base: string | undefined, head: string) => {
  if (base == null) return splitLines(runGit(['diff', '--name-only', '--diff-filter=ACMRT', head]))
  try {
    return splitLines(runGit(['diff', '--name-only', '--diff-filter=ACMRT', `${base}...${head}`]))
  } catch {
    return splitLines(runGit(['diff', '--name-only', '--diff-filter=ACMRT', `${base}..${head}`]))
  }
}

const getCommitSubjects = (base: string | undefined, head: string) => (
  splitLines(runGit(['log', '--format=%s', base == null ? head : `${base}..${head}`]))
)

export const getWorkingTreeChanges = () => splitLines(runGit(['status', '--porcelain']))

export const inspectPrChange = (
  input: RunPrChangeCheckInput,
  defaultBase?: string
) => {
  const head = normalizeRef(input.head) ?? 'HEAD'
  const base = normalizeRef(input.base) ?? defaultBase
  const changedFiles = getChangedFiles(base, head)
  const commitSubjects = getCommitSubjects(base, head)
  const result = evaluatePrChangePolicy({
    changedFiles,
    commitSubjects,
    prBody: readPrBody(input)
  })

  return {
    base,
    changedFiles,
    commitSubjects,
    head,
    result
  }
}

export const runPrChangeCheck = async (input: RunPrChangeCheckInput) => {
  const { result } = inspectPrChange(input)

  if (result.violations.length === 0) {
    console.log('[pr-change-check] ok')
    return
  }

  console.error('[pr-change-check] failed')
  for (const violation of result.violations) {
    console.error(`- ${violation}`)
  }
  process.exitCode = 1
}
