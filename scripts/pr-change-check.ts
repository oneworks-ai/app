import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const productChangeTypes = new Set(['feat', 'fix'])

export interface PrChangePolicyInput {
  changedFiles: string[]
  commitSubjects: string[]
  prBody?: string
}

export interface PrChangePolicyResult {
  requiresChangelog: boolean
  requiresScreenshot: boolean
  violations: string[]
}

export interface RunPrChangeCheckInput {
  base?: string
  body?: string
  bodyFile?: string
  head?: string
}

const parseCommitType = (subject: string) => (
  /^([a-z]+)(?:\([^)]+\))?!?:/i.exec(subject.trim())?.[1]?.toLowerCase()
)

const isFeatureOrFixPr = (commitSubjects: string[]) => (
  commitSubjects.some(subject => {
    const type = parseCommitType(subject)
    return type != null && productChangeTypes.has(type)
  })
)

const isChangelogFile = (filePath: string) => (
  /^changelog\/[^/]+\/[^/]+\.md$/u.test(filePath) && !filePath.endsWith('/AGENTS.md')
)

const isDocsPath = (filePath: string) => (
  filePath === 'AGENTS.md' ||
  filePath.endsWith('/AGENTS.md') ||
  filePath.startsWith('.oo/docs/') ||
  // `.oo/docs` is the content source; this path remains the homepage docs VitePress shell.
  filePath.startsWith('assets/homepage/apps/docs/') ||
  filePath.startsWith('.oo/rules/') ||
  filePath.startsWith('docs/') ||
  filePath.startsWith('changelog/') ||
  /(?:^|\/)readme\.md$/iu.test(filePath) ||
  filePath.endsWith('.md')
)

const isToolingPath = (filePath: string) => (
  filePath.startsWith('.github/') ||
  filePath.startsWith('infra/') ||
  filePath.startsWith('scripts/') ||
  filePath === 'package.json' ||
  filePath === 'pnpm-lock.yaml' ||
  filePath === 'pnpm-workspace.yaml' ||
  filePath === 'dprint.json' ||
  filePath === 'eslint.config.mjs' ||
  filePath === 'vitest.workspace.ts' ||
  /^tsconfig(?:\.[^.]+)?\.json$/u.test(filePath)
)

const isTestPath = (filePath: string) => (
  /(?:^|\/)__tests__\//u.test(filePath) ||
  /\.(?:spec|test)\.[jt]sx?$/u.test(filePath)
)

const isProductPath = (filePath: string) => (
  !isDocsPath(filePath) && !isToolingPath(filePath) && !isTestPath(filePath)
)

const isUiSurfacePath = (filePath: string) => (
  /^apps\/client\/src\/(?:components|routes|resources|styles|assets)\//u.test(filePath) ||
  /^apps\/client\/src\/.*\.(?:css|scss|tsx|jsx)$/u.test(filePath) ||
  /^apps\/desktop\/src\/.*\.(?:css|scss|tsx|jsx)$/u.test(filePath)
)

const hasScreenshotEvidence = (body: string | undefined) => {
  if (body == null || body.trim() === '') return false
  return /!\[[^\]]*\]\([^)]+\)/u.test(body) ||
    /<img\s[^>]*src=/iu.test(body) ||
    /github\.com\/user-attachments\/assets\//u.test(body) ||
    /private-user-images\.githubusercontent\.com/u.test(body) ||
    /\.(?:png|jpe?g|webp|gif)(?:\)|\s|$)/iu.test(body)
}

export const evaluatePrChangePolicy = (input: PrChangePolicyInput): PrChangePolicyResult => {
  const isProductFeatureOrFix = isFeatureOrFixPr(input.commitSubjects) && input.changedFiles.some(isProductPath)
  const requiresChangelog = isProductFeatureOrFix
  const requiresScreenshot = isProductFeatureOrFix && input.changedFiles.some(isUiSurfacePath)
  const violations: string[] = []

  if (requiresChangelog && !input.changedFiles.some(isChangelogFile)) {
    violations.push(
      'Feature/fix PRs that change product code must update changelog/<version>/<package>.md or readme.md.'
    )
  }

  if (requiresScreenshot && !hasScreenshotEvidence(input.prBody)) {
    violations.push('Feature/fix PRs that change UI surfaces must include a screenshot in the PR body.')
  }

  return {
    requiresChangelog,
    requiresScreenshot,
    violations
  }
}

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

export const runPrChangeCheck = async (input: RunPrChangeCheckInput) => {
  const head = normalizeRef(input.head) ?? 'HEAD'
  const base = normalizeRef(input.base)
  const result = evaluatePrChangePolicy({
    changedFiles: getChangedFiles(base, head),
    commitSubjects: getCommitSubjects(base, head),
    prBody: readPrBody(input)
  })

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
