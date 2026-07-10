#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import process from 'node:process'

const EMPTY_TREE_SHA = /^0+$/
const sharedFiles = [
  '.node-version',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts/vercel-ignore-build.mjs'
]
const adminPaths = [
  ...sharedFiles,
  'apps/relay-admin/api/',
  'apps/relay-admin/index.html',
  'apps/relay-admin/package.json',
  'apps/relay-admin/public/',
  'apps/relay-admin/scripts/prepare-platform-build.mjs',
  'apps/relay-admin/src/',
  'apps/relay-admin/tsconfig.json',
  'apps/relay-admin/vercel.json',
  'apps/relay-admin/vite.config.ts',
  'apps/relay-admin/vite.relayLoginDev.ts',
  'packages/components/',
  'packages/icon/',
  'packages/route-layout/',
  'packages/tsconfigs/'
]
const projectPaths = {
  'relay-admin': adminPaths,
  'relay-server': [
    ...adminPaths,
    'apps/relay-server/api/',
    'apps/relay-server/package.json',
    'apps/relay-server/scripts/prepare-vercel-build.mjs',
    'apps/relay-server/src/',
    'apps/relay-server/tsconfig.json',
    'apps/relay-server/vercel.json'
  ]
}
const ignoredBasenames = new Set(['.gitignore', '.npmignore', 'AGENTS.md', 'HANDOFF.md', 'README.md'])
const ignoredTestFileRe = /(?:^|[.-])(?:spec|test)\.[cm]?[jt]sx?$/

function parseArgs(args) {
  const parsed = { base: '', head: process.env.VERCEL_GIT_COMMIT_SHA || 'HEAD', project: '' }

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--base') {
      parsed.base = args[index + 1] || ''
      index += 1
    } else if (args[index] === '--head') {
      parsed.head = args[index + 1] || parsed.head
      index += 1
    } else if (!parsed.project) {
      parsed.project = args[index]
    } else {
      throw new Error(`unexpected argument: ${args[index]}`)
    }
  }

  return parsed
}

function runGit(args, options = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.silent ? 'ignore' : 'pipe']
  }).trim()
}

function tryGit(args, options = {}) {
  try {
    return runGit(args, options)
  } catch {
    return ''
  }
}

function gitSucceeds(args) {
  try {
    execFileSync('git', args, { stdio: ['ignore', 'ignore', 'ignore'] })
    return true
  } catch {
    return false
  }
}

function isZeroSha(value) {
  return value.length > 0 && EMPTY_TREE_SHA.test(value)
}

function hasCommit(ref) {
  return Boolean(ref) && !isZeroSha(ref) && gitSucceeds(['cat-file', '-e', `${ref}^{commit}`])
}

function fetchOriginMain() {
  tryGit(['fetch', '--depth=100', 'origin', 'main:refs/remotes/origin/main'], { silent: true })
  return hasCommit('origin/main')
}

function getMergeBase(head) {
  if (!fetchOriginMain()) return ''
  const mergeBase = tryGit(['merge-base', 'origin/main', head], { silent: true })
  return mergeBase && mergeBase !== head ? mergeBase : ''
}

function getPreviousBase() {
  return hasCommit(process.env.VERCEL_GIT_PREVIOUS_SHA || '') ? process.env.VERCEL_GIT_PREVIOUS_SHA || '' : ''
}

function resolveBase(explicitBase, head) {
  if (explicitBase) return hasCommit(explicitBase) ? explicitBase : ''

  const branch = process.env.VERCEL_GIT_COMMIT_REF || ''
  const productionBranch = process.env.VERCEL_GIT_PRODUCTION_BRANCH || 'main'
  const isProductionBranch = branch === productionBranch || branch === 'main'
  return isProductionBranch ? getPreviousBase() : getMergeBase(head) || getPreviousBase()
}

function getChangedFiles(base, head) {
  return runGit(['diff', '--name-only', '--diff-filter=ACMRT', `${base}..${head}`])
    .split('\n')
    .map(file => file.trim())
    .filter(Boolean)
}

function matchesPath(file, rule) {
  return rule.endsWith('/') ? file.startsWith(rule) : file === rule
}

function isIgnoredBuildFile(file) {
  const segments = file.split('/')
  const basename = segments.at(-1) || ''
  return ignoredBasenames.has(basename) || segments.includes('__tests__') || ignoredTestFileRe.test(basename)
}

function findRelevantFile(files, rules) {
  return files.find(file => !isIgnoredBuildFile(file) && rules.some(rule => matchesPath(file, rule))) || ''
}

function continueBuild(reason) {
  process.stderr.write(`[vercel-ignore] ${reason}; continuing build.\n`)
  process.exit(1)
}

function main() {
  const { base: explicitBase, head, project } = parseArgs(process.argv.slice(2))
  const relevantPaths = projectPaths[project]

  if (!relevantPaths) {
    continueBuild(`unknown project "${project}". Expected one of: ${Object.keys(projectPaths).join(', ')}`)
  }

  const repoRoot = tryGit(['rev-parse', '--show-toplevel'], { cwd: process.cwd(), silent: true })
  if (!repoRoot) continueBuild('cannot find git repository root')
  process.chdir(repoRoot)

  if (!hasCommit(head)) continueBuild(`cannot resolve head ref "${head}"`)

  const base = resolveBase(explicitBase, head)
  if (!base) continueBuild('cannot resolve a diff base')

  const relevantFile = findRelevantFile(getChangedFiles(base, head), relevantPaths)
  if (relevantFile) {
    process.stdout.write(
      `[vercel-ignore] ${project} build required; ${relevantFile} changed in ${base}..${head}.\n`
    )
    process.exit(1)
  }

  process.stdout.write(
    `[vercel-ignore] no ${project} deployment paths changed in ${base}..${head}; skipping Vercel build.\n`
  )
  process.exit(0)
}

main()
