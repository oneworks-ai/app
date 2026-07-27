const productChangeTypes = new Set(['feat', 'fix'])

export interface PrChangePolicyInput {
  changedFiles: string[]
  commitSubjects: string[]
  prBody?: string
}

export interface PrChangePolicyResult {
  hasChangelog: boolean
  hasExperienceReview: boolean
  hasScreenshot: boolean
  requiresChangelog: boolean
  requiresScreenshot: boolean
  violations: string[]
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
  !isDocsPath(filePath) && (
    /^apps\/client\/src\/(?:components|routes|resources|styles|assets)\//u.test(filePath) ||
    /^apps\/client\/src\/.*\.(?:css|scss|tsx|jsx)$/u.test(filePath) ||
    /^apps\/desktop\/src\/.*\.(?:css|scss|tsx|jsx)$/u.test(filePath)
  )
)

const hasScreenshotEvidence = (body: string | undefined) => {
  if (body == null || body.trim() === '') return false
  return /!\[[^\]]*\]\([^)]+\)/u.test(body) ||
    /<img\s[^>]*src=/iu.test(body) ||
    /github\.com\/user-attachments\/assets\//u.test(body) ||
    /private-user-images\.githubusercontent\.com/u.test(body) ||
    /\.(?:png|jpe?g|webp|gif)(?:\)|\s|$)/iu.test(body)
}

const hasCheckedItem = (section: string, pattern: RegExp) => (
  section.split('\n').some(line => /^\s*[-*]\s+\[x\]\s+/iu.test(line) && pattern.test(line))
)

export const hasExperienceReviewChecklist = (body: string | undefined) => {
  if (body == null || body.trim() === '') return false
  const sectionMatch = /^##\s+Experience Review\s*$/imu.exec(body)
  if (sectionMatch == null) return false

  const sectionStart = sectionMatch.index + sectionMatch[0].length
  const nextSectionOffset = body.slice(sectionStart).search(/^##\s+/mu)
  const sectionEnd = nextSectionOffset < 0 ? undefined : sectionStart + nextSectionOffset
  const section = body.slice(sectionStart, sectionEnd)

  return hasCheckedItem(section, /已判断是否需要沉淀经验/u) &&
    hasCheckedItem(section, /\$post-task-experience-review/u) &&
    hasCheckedItem(section, /reviewer\s+PASS/u)
}

export const evaluatePrChangePolicy = (input: PrChangePolicyInput): PrChangePolicyResult => {
  const isProductFeatureOrFix = isFeatureOrFixPr(input.commitSubjects) && input.changedFiles.some(isProductPath)
  const requiresChangelog = isProductFeatureOrFix
  const requiresScreenshot = isProductFeatureOrFix && input.changedFiles.some(isUiSurfacePath)
  const hasChangelog = input.changedFiles.some(isChangelogFile)
  const hasExperienceReview = hasExperienceReviewChecklist(input.prBody)
  const hasScreenshot = hasScreenshotEvidence(input.prBody)
  const violations: string[] = []

  if (requiresChangelog && !hasChangelog) {
    violations.push(
      'Feature/fix PRs that change product code must update changelog/<version>/<package>.md or readme.md.'
    )
  }

  if (requiresScreenshot && !hasScreenshot) {
    violations.push('Feature/fix PRs that change UI surfaces must include a screenshot in the PR body.')
  }

  if (!hasExperienceReview) {
    violations.push(
      'PR body must include a completed ## Experience Review checklist confirming experience judgment, $post-task-experience-review when needed, and reviewer PASS before merge.'
    )
  }

  return {
    hasChangelog,
    hasExperienceReview,
    hasScreenshot,
    requiresChangelog,
    requiresScreenshot,
    violations
  }
}
