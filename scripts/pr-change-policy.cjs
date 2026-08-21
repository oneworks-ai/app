const {
  classifyChangedPaths,
  getPresentChangedFiles,
  isDocumentationPath
} = require('./pr-validation-scope.cjs')

const productChangeTypes = new Set(['feat', 'fix'])

const parseCommitType = (subject) => (
  /^([a-z]+)(?:\([^)]+\))?!?:/i.exec(subject.trim())?.[1]?.toLowerCase()
)

const isFeatureOrFixPr = (commitSubjects) => (
  commitSubjects.some(subject => {
    const type = parseCommitType(subject)
    return type != null && productChangeTypes.has(type)
  })
)

const isChangelogFile = (filePath) => (
  /^changelog\/[^/]+\/[^/]+\.md$/u.test(filePath) && !filePath.endsWith('/AGENTS.md')
)

const isToolingPath = (filePath) => (
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

const isTestPath = (filePath) => (
  /(?:^|\/)__tests__\//u.test(filePath) ||
  /\.(?:spec|test)\.[jt]sx?$/u.test(filePath)
)

const isProductPath = (filePath) => (
  !isDocumentationPath(filePath) && !isToolingPath(filePath) && !isTestPath(filePath)
)

const isUiSurfacePath = (filePath) => (
  !isDocumentationPath(filePath) && (
    /^apps\/client\/src\/(?:components|routes|resources|styles|assets)\//u.test(filePath) ||
    /^apps\/client\/src\/.*\.(?:css|scss|tsx|jsx)$/u.test(filePath) ||
    /^apps\/desktop\/src\/.*\.(?:css|scss|tsx|jsx)$/u.test(filePath)
  )
)

const hasScreenshotEvidence = (body) => {
  if (body == null || body.trim() === '') return false
  return /!\[[^\]]*\]\([^)]+\)/u.test(body) ||
    /<img\s[^>]*src=/iu.test(body) ||
    /github\.com\/user-attachments\/assets\//u.test(body) ||
    /private-user-images\.githubusercontent\.com/u.test(body) ||
    /\.(?:png|jpe?g|webp|gif)(?:\)|\s|$)/iu.test(body)
}

const hasCheckedItem = (section, pattern) => (
  section.split('\n').some(line => /^\s*[-*]\s+\[x\]\s+/iu.test(line) && pattern.test(line))
)

const hasExperienceReviewChecklist = (body) => {
  if (body == null || body.trim() === '') return false
  const sectionMatch = /^##\s+Experience Review\s*$/imu.exec(body)
  if (sectionMatch == null) return false

  const sectionStart = sectionMatch.index + sectionMatch[0].length
  const nextSectionOffset = body.slice(sectionStart).search(/^##\s+/mu)
  const sectionEnd = nextSectionOffset < 0 ? undefined : sectionStart + nextSectionOffset
  const section = body.slice(sectionStart, sectionEnd)

  return hasCheckedItem(section, /已判断是否需要沉淀经验/u) &&
    hasCheckedItem(section, /\$post-task-experience-review/u) &&
    hasCheckedItem(
      section,
      /reviewer\s+(?:PASS|`?PASS`?\s*\/\s*`?NOT APPLICABLE`?)/u
    )
}

const hasPolicyConflictReviewChecklist = (body) => {
  if (body == null || body.trim() === '') return false
  const sectionMatch = /^##\s+Policy Conflict Review\s*$/imu.exec(body)
  if (sectionMatch == null) return false

  const sectionStart = sectionMatch.index + sectionMatch[0].length
  const nextSectionOffset = body.slice(sectionStart).search(/^##\s+/mu)
  const sectionEnd = nextSectionOffset < 0 ? undefined : sectionStart + nextSectionOffset
  const section = body.slice(sectionStart, sectionEnd)

  return hasCheckedItem(
    section,
    /independent read-only reviewer.*(?:conflict|workflow|permission|release).*PASS/iu
  )
}

const evaluatePrChangePolicy = (input) => {
  const validationScope = classifyChangedPaths(input.changedFiles)
  const isProductFeatureOrFix = isFeatureOrFixPr(input.commitSubjects) && input.changedFiles.some(isProductPath)
  const requiresChangelog = isProductFeatureOrFix
  const requiresPolicyConflictReview = validationScope.policyDocs
  const requiresScreenshot = isProductFeatureOrFix && input.changedFiles.some(isUiSurfacePath)
  const presentChangedFiles = input.changedPathEntries == null
    ? input.changedFiles
    : getPresentChangedFiles(input.changedPathEntries)
  const hasChangelog = presentChangedFiles.some(isChangelogFile)
  const hasExperienceReview = hasExperienceReviewChecklist(input.prBody)
  const hasPolicyConflictReview = hasPolicyConflictReviewChecklist(input.prBody)
  const hasScreenshot = hasScreenshotEvidence(input.prBody)
  const violations = []

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
      'PR body must include a completed ## Experience Review checklist confirming experience judgment, $post-task-experience-review when needed, and reviewer PASS / NOT APPLICABLE before merge.'
    )
  }

  if (requiresPolicyConflictReview && !hasPolicyConflictReview) {
    violations.push(
      'Workflow, permission, and release-rule documentation changes require a completed ## Policy Conflict Review checklist recording an independent read-only reviewer PASS.'
    )
  }

  return {
    hasChangelog,
    hasExperienceReview,
    hasPolicyConflictReview,
    hasScreenshot,
    requiresChangelog,
    requiresPolicyConflictReview,
    requiresScreenshot,
    violations
  }
}

module.exports = {
  evaluatePrChangePolicy,
  hasExperienceReviewChecklist,
  hasPolicyConflictReviewChecklist
}
