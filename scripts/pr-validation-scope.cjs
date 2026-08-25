#!/usr/bin/env node

/* eslint-disable max-lines -- The versioned classifier keeps all changed-path categories in one auditable contract. */

const { execFileSync } = require('node:child_process')
const { appendFileSync } = require('node:fs')
const process = require('node:process')

const prValidationScopeVersion = 3

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
const fullTypecheckScopes = [
  'bundler',
  'bundler:test',
  'web',
  'web:test',
  'node',
  'node:test'
]
const knownTopLevelPaths = new Set([
  '.codex',
  '.github',
  '.oo',
  'apps',
  'assets',
  'changelog',
  'docs',
  'infra',
  'packages',
  'scripts'
])
const knownRootPaths = new Set([
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.gitmodules',
  '.node-version',
  '.npmrc',
  '.oo.config.json',
  'AGENTS.md',
  'CODE_OF_CONDUCT.md',
  'LICENSE',
  'README.md',
  'README.zh-Hans.md',
  'dprint.json',
  'eslint.config.mjs',
  'eslint.max-lines-baseline.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'rfc.md',
  'tsconfig.json',
  'vitest.workspace.ts'
])
const dependencyGraphPathPattern = /(?:^|\/)package\.json$/u
const typecheckConfigPathPattern = /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/u
const sourceCoupledGitlinkPaths = new Set(['assets/avatar', 'assets/demo-video'])
const lintablePathPattern = /\.(?:astro|cjs|cts|js|json|json5|jsx|mjs|mts|svelte|ts|tsx|vue|ya?ml)$/iu
const typecheckPathPattern = /\.(?:cts|mts|ts|tsx)$/iu
const environmentContractPathPattern = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/iu

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
    normalizedPath === 'assets/homepage' ||
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

const isKnownPath = (filePath) => {
  if (knownRootPaths.has(filePath)) return true
  const [topLevelPath] = filePath.split('/')
  return knownTopLevelPaths.has(topLevelPath)
}

const isDependencyGraphPath = (filePath) =>
  dependencyGraphPathPattern.test(filePath) ||
  typecheckConfigPathPattern.test(filePath) ||
  sourceCoupledGitlinkPaths.has(filePath) ||
  filePath === '.gitmodules' ||
  filePath === '.node-version' ||
  filePath === 'pnpm-lock.yaml' ||
  filePath === 'pnpm-workspace.yaml' ||
  filePath === 'vitest.workspace.ts' ||
  filePath.startsWith('packages/tsconfigs/')

// Avatar is consumed by the client production bundle, not Desktop's packaged runtime.
// Keep it dependency-coupled for full typecheck, but do not spend a macOS package smoke on
// an avatar-only gitlink pointer update.
const isDesktopDependencyGraphPath = (filePath) => filePath !== 'assets/avatar' && isDependencyGraphPath(filePath)

const isClientTypecheckPath = (filePath) =>
  filePath.startsWith('apps/client/src/') || filePath.startsWith('apps/client/__tests__/')

const isClientProductionPath = (filePath) =>
  filePath === 'assets/avatar' ||
  filePath.startsWith('apps/client/src/') ||
  filePath.startsWith('apps/client/public/') ||
  filePath === 'apps/client/index.html' ||
  filePath === 'apps/client/vite.config.ts' ||
  /^packages\/(?:adapters|avatar|components|cursor|icon|route-layout)\//u.test(filePath) ||
  /^packages\/plugins\/(?:china-red|focus-workbench|neo-workshop|warm-cowork)-theme\//u.test(filePath)

const isWebTypecheckPath = (filePath) =>
  isClientTypecheckPath(filePath) ||
  filePath.startsWith('apps/relay-admin/src/') ||
  filePath.startsWith('apps/relay-admin/__tests__/')

const isNodeTypecheckPath = (filePath) =>
  /^(?:apps\/(?:cli|relay-server|server|vscode-extension)\/(?:src|__tests__)\/|scripts\/)/u.test(filePath) ||
  filePath === '.oo.config.ts' ||
  filePath === '.oo.dev.config.ts' ||
  filePath === 'vitest.workspace.ts' ||
  /^(?:apps\/client|apps\/relay-admin)\/vite\.config\.ts$/u.test(filePath)

const getTypecheckScopes = (nonDocsFiles, options = {}) => {
  if (options.forceFull === true || nonDocsFiles.some(isDependencyGraphPath)) {
    return [...fullTypecheckScopes]
  }

  const typecheckFiles = nonDocsFiles.filter(filePath =>
    typecheckPathPattern.test(filePath) ||
    (filePath.startsWith('apps/client/src/') && filePath.endsWith('.json'))
  )
  if (typecheckFiles.length === 0) return []

  const scopes = new Set()
  for (const filePath of typecheckFiles) {
    if (isWebTypecheckPath(filePath)) {
      scopes.add('web')
      scopes.add('web:test')
      continue
    }
    if (isNodeTypecheckPath(filePath)) {
      scopes.add('node')
      scopes.add('node:test')
      continue
    }
    return [...fullTypecheckScopes]
  }

  return fullTypecheckScopes.filter(scope => scopes.has(scope))
}

const isDesktopPackageSafePath = (filePath) => {
  if (isDocumentationPath(filePath)) return true
  if (
    /^(?:apps\/(?:android|relay-admin|relay-server|vscode-extension|web)\/|assets\/|infra\/)/u.test(filePath)
  ) return true
  if (/^apps\/client\/(?:__tests__|public|src)\//u.test(filePath) || filePath === 'apps/client/index.html') {
    return true
  }
  if (
    /^packages\/(?:adapters|avatar|components|cursor|icon|route-layout)\//u.test(filePath)
  ) return true
  if (/^packages\/plugins\/(?:china-red|focus-workbench|neo-workshop|warm-cowork)-theme\//u.test(filePath)) {
    return true
  }
  if (filePath.startsWith('.codex/')) return true
  if (
    filePath.startsWith('.github/') &&
    filePath !== '.github/workflows/desktop-package.yml' &&
    !filePath.startsWith('.github/actions/setup-workspace/')
  ) {
    return true
  }
  if (filePath.startsWith('scripts/')) {
    return !(
      /^scripts\/(?:desktop-|package-|run-workspace-check|workspace-dependency-bootstrap)/u.test(filePath) ||
      /^scripts\/pr-validation-(?:reuse|scope)\.(?:cjs|d\.cts)$/u.test(filePath) ||
      filePath === 'scripts/__tests__/desktop-package-workflow.spec.ts' ||
      filePath === 'scripts/__tests__/workspace-dependency-bootstrap.spec.ts' ||
      /^scripts\/__tests__\/pr-validation-(?:reuse|scope)\.spec\.ts$/u.test(filePath)
    )
  }
  return false
}

const requiresDesktopPackage = (changedFiles, options = {}) =>
  options.forceFull === true ||
  changedFiles.length === 0 ||
  changedFiles.some(filePath => isDesktopDependencyGraphPath(filePath) || !isDesktopPackageSafePath(filePath))

const classifyChangedPaths = (changedFiles, options = {}) => {
  const normalizedFiles = [...new Set(changedFiles.map(normalizePath).filter(filePath => filePath !== ''))].sort()
  const nonDocsFiles = normalizedFiles.filter(filePath => !isDocumentationPath(filePath))
  const docsOnly = options.forceFull !== true && normalizedFiles.length > 0 && nonDocsFiles.length === 0
  const unknownFiles = normalizedFiles.filter(filePath => hasUnsafePathCharacter(filePath) || !isKnownPath(filePath))
  const forceFull = options.forceFull === true || normalizedFiles.length === 0 || unknownFiles.length > 0
  const typecheckScopes = getTypecheckScopes(nonDocsFiles, { forceFull })

  return {
    version: prValidationScopeVersion,
    changedFiles: normalizedFiles,
    clientBuild: forceFull || nonDocsFiles.some(isClientProductionPath),
    desktopPackage: requiresDesktopPackage(normalizedFiles, { forceFull }),
    docsChanged: normalizedFiles.some(isDocumentationPath),
    docsMedia: forceFull || normalizedFiles.some(filePath =>
      isPublicDocumentationPath(filePath) ||
      filePath === 'assets/demo-video' ||
      filePath.startsWith('assets/demo-video/') ||
      /^scripts\/(?:docs-media|docs-only-validation)/u.test(filePath) ||
      filePath === '.github/workflows/quality.yml'
    ),
    docsOnly,
    envContract: forceFull || nonDocsFiles.some(filePath =>
      environmentContractPathPattern.test(filePath) ||
      filePath === 'scripts/check-env-contract.mjs'
    ),
    format: forceFull || normalizedFiles.length > 0,
    full: !docsOnly,
    lint: forceFull || nonDocsFiles.some(filePath =>
      lintablePathPattern.test(filePath) ||
      filePath === 'eslint.config.mjs' ||
      filePath === 'eslint.max-lines-baseline.mjs' ||
      isDependencyGraphPath(filePath)
    ),
    nonDocsFiles,
    policyDocs: normalizedFiles.some(isPolicyDocumentationPath),
    publicDocs: normalizedFiles.some(isPublicDocumentationPath),
    releaseDocs: normalizedFiles.some(isReleaseDocumentationPath),
    typecheck: typecheckScopes.length > 0,
    typecheckScopes,
    unknown: forceFull,
    unknownFiles
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

const getChangedPathEntriesBetweenTrees = ({ before, cwd = process.cwd(), head = 'HEAD' }) =>
  parseNameStatus(runGitBuffer([
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    before,
    head,
    '--'
  ], cwd))

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
    client_build: scope.clientBuild,
    desktop_package: scope.desktopPackage,
    docs_changed: scope.docsChanged,
    docs_media: scope.docsMedia,
    docs_only: scope.docsOnly,
    env_contract: scope.envContract,
    format: scope.format,
    full: scope.full,
    lint: scope.lint,
    policy_docs: scope.policyDocs,
    public_docs: scope.publicDocs,
    release_docs: scope.releaseDocs,
    typecheck: scope.typecheck,
    typecheck_scopes: scope.typecheckScopes.join(' '),
    unknown: scope.unknown
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
  fullTypecheckScopes,
  getChangedFilesFromEntries,
  getChangedPathEntries,
  getChangedPathEntriesBetweenTrees,
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
