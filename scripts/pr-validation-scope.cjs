#!/usr/bin/env node

/* eslint-disable max-lines -- The versioned classifier keeps all changed-path categories in one auditable contract. */

const { execFileSync } = require('node:child_process')
const { appendFileSync } = require('node:fs')
const process = require('node:process')

const prValidationScopeVersion = 1

const markdownPathPattern = /\.md$/iu
const documentationMediaPathPattern = /\.(?:avif|gif|jpe?g|mp4|png|svg|webm|webp)$/iu
const publicReadmePaths = new Set(['README.md', 'README.zh-Hans.md'])
const documentationBasenamePattern = /^(?:AGENTS|DEBUGGING|HANDOFF|README(?:\.[^/]+)?)\.md$/iu
const policyRulePaths = new Set([
  'AGENTS.md',
  '.oo/rules/MAINTENANCE.md',
  '.oo/rules/RELEASE.md',
  '.oo/rules/maintenance/code-delivery-quality.md',
  '.oo/rules/maintenance/pr-experience-review.md',
  '.oo/rules/maintenance/task-planning.md'
])

const normalizePath = (filePath) => filePath.replaceAll('\\', '/')
const hasUnsafePathCharacter = (filePath) =>
  [...filePath].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })

const isDocumentationPath = (filePath) => {
  const normalizedPath = normalizePath(filePath)
  if (hasUnsafePathCharacter(normalizedPath) || normalizedPath.startsWith('/')) return false
  if (normalizedPath.split('/').includes('..')) return false
  if (normalizedPath.startsWith('.oo/docs/')) {
    return markdownPathPattern.test(normalizedPath) || documentationMediaPathPattern.test(normalizedPath)
  }
  if (!markdownPathPattern.test(normalizedPath)) return false

  const segments = normalizedPath.split('/')
  const basename = segments.at(-1) ?? ''
  return segments.length === 1 ||
    documentationBasenamePattern.test(basename) ||
    normalizedPath.startsWith('.github/') ||
    normalizedPath.startsWith('.oo/rules/') ||
    normalizedPath.startsWith('changelog/') ||
    normalizedPath.startsWith('docs/') ||
    normalizedPath.startsWith('scripts/') ||
    segments.includes('debugging')
}

const isPublicDocumentationPath = (filePath) => {
  const normalizedPath = normalizePath(filePath)
  return publicReadmePaths.has(normalizedPath) ||
    normalizedPath === '.oo/docs' ||
    normalizedPath.startsWith('.oo/docs/')
}

const isReleaseDocumentationPath = (filePath) => {
  const normalizedPath = normalizePath(filePath)
  return normalizedPath === '.oo/rules/RELEASE.md' ||
    normalizedPath.startsWith('.oo/rules/release/') ||
    normalizedPath === 'changelog/AGENTS.md' ||
    (normalizedPath.startsWith('changelog/') && markdownPathPattern.test(normalizedPath))
}

const isPolicyDocumentationPath = (filePath) => {
  const normalizedPath = normalizePath(filePath)
  return policyRulePaths.has(normalizedPath) ||
    (normalizedPath.startsWith('.github/') && markdownPathPattern.test(normalizedPath)) ||
    (normalizedPath.startsWith('.codex/') && markdownPathPattern.test(normalizedPath)) ||
    (normalizedPath.startsWith('.oo/rules/release/') && markdownPathPattern.test(normalizedPath)) ||
    /^\.oo\/rules\/maintenance\/model-routing(?:-[^/]+)?\.md$/u.test(normalizedPath)
}

const classifyChangedPaths = (changedFiles, options = {}) => {
  const normalizedFiles = [...new Set(changedFiles.map(normalizePath).filter(filePath => filePath !== ''))].sort()
  const nonDocsFiles = normalizedFiles.filter(filePath => !isDocumentationPath(filePath))
  const docsOnly = options.forceFull !== true && normalizedFiles.length > 0 && nonDocsFiles.length === 0

  return {
    version: prValidationScopeVersion,
    changedFiles: normalizedFiles,
    docsChanged: normalizedFiles.some(isDocumentationPath),
    docsOnly,
    full: !docsOnly,
    nonDocsFiles,
    policyDocs: normalizedFiles.some(isPolicyDocumentationPath),
    publicDocs: normalizedFiles.some(isPublicDocumentationPath),
    releaseDocs: normalizedFiles.some(isReleaseDocumentationPath)
  }
}

const runGitBuffer = (args, cwd) =>
  execFileSync('git', args, {
    cwd,
    maxBuffer: 1024 * 1024 * 20,
    stdio: ['ignore', 'pipe', 'pipe']
  })

const parseNameStatus = (output) => {
  const entries = output.toString('utf8').split('\0').filter(Boolean)
  const changes = []

  for (let index = 0; index < entries.length;) {
    const status = entries[index++]
    if (status == null) break

    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = entries[index++]
      const newPath = entries[index++]
      if (oldPath != null && newPath != null) {
        changes.push({ paths: [oldPath, newPath], status })
      }
      continue
    }

    const filePath = entries[index++]
    if (filePath != null) changes.push({ paths: [filePath], status })
  }

  return changes
}

const getChangedPathEntries = ({ base, cwd = process.cwd(), head = 'HEAD' }) => {
  const normalizedBase = base?.trim()
  const diffArgs = [
    'diff',
    '--name-status',
    '-z',
    '--find-renames'
  ]
  diffArgs.push(
    normalizedBase == null || normalizedBase === '' || /^0+$/u.test(normalizedBase)
      ? head
      : `${normalizedBase}...${head}`
  )

  return parseNameStatus(runGitBuffer(diffArgs, cwd))
}

const getChangedFilesFromEntries = (changes) => changes.flatMap(change => change.paths)

const getPresentChangedFiles = (changes) =>
  changes.flatMap(change => {
    const status = change.status.at(0)
    if (status === 'D') return []
    if (status === 'R' || status === 'C') return change.paths.slice(-1)
    return change.paths
  })

const getChangedFiles = (input) => getChangedFilesFromEntries(getChangedPathEntries(input))

const classifyPrValidationRange = (input) => {
  if (input.base == null || input.base.trim() === '' || /^0+$/u.test(input.base)) {
    throw new Error('PR validation scope requires a non-empty base commit.')
  }
  return classifyChangedPaths(
    getChangedFiles(input),
    { forceFull: input.forceFull }
  )
}

const parseArguments = (args) => {
  const parsed = {
    assertDocsOnly: false,
    base: '',
    forceFull: false,
    githubOutput: '',
    head: 'HEAD',
    json: false
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--assert-docs-only') parsed.assertDocsOnly = true
    else if (argument === '--base') parsed.base = args[++index] ?? ''
    else if (argument === '--force-full') parsed.forceFull = true
    else if (argument === '--github-output') parsed.githubOutput = args[++index] ?? ''
    else if (argument === '--head') parsed.head = args[++index] ?? 'HEAD'
    else if (argument === '--json') parsed.json = true
    else throw new Error(`Unknown PR validation scope argument: ${argument}`)
  }

  return parsed
}

const writeGithubOutputs = (outputPath, scope) => {
  const outputs = {
    docs_changed: scope.docsChanged,
    docs_only: scope.docsOnly,
    full: scope.full,
    policy_docs: scope.policyDocs,
    public_docs: scope.publicDocs,
    release_docs: scope.releaseDocs
  }
  appendFileSync(
    outputPath,
    `${Object.entries(outputs).map(([key, value]) => `${key}=${String(value)}`).join('\n')}\n`
  )
}

const runPrValidationScope = (args = process.argv.slice(2)) => {
  const input = parseArguments(args)
  const scope = input.forceFull
    ? classifyChangedPaths([], { forceFull: true })
    : classifyPrValidationRange({ base: input.base, head: input.head })

  if (input.githubOutput !== '') writeGithubOutputs(input.githubOutput, scope)

  if (input.json) process.stdout.write(`${JSON.stringify(scope, null, 2)}\n`)
  else {
    process.stdout.write(
      `[pr-validation-scope] ${scope.docsOnly ? 'docs-only' : 'full'} ` +
        `(${scope.changedFiles.length} path(s))\n`
    )
  }

  if (input.assertDocsOnly && !scope.docsOnly) {
    const unexpectedPaths = scope.nonDocsFiles.length > 0
      ? scope.nonDocsFiles.join(', ')
      : 'no changed paths'
    throw new Error(`Expected a docs-only PR scope; full validation is required for: ${unexpectedPaths}`)
  }

  return scope
}

module.exports = {
  classifyChangedPaths,
  classifyPrValidationRange,
  getChangedFilesFromEntries,
  getChangedPathEntries,
  getChangedFiles,
  getPresentChangedFiles,
  isDocumentationPath,
  isPolicyDocumentationPath,
  isPublicDocumentationPath,
  isReleaseDocumentationPath,
  prValidationScopeVersion,
  runPrValidationScope
}

if (require.main === module) {
  try {
    runPrValidationScope()
  } catch (error) {
    process.stderr.write(`[pr-validation-scope] ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
