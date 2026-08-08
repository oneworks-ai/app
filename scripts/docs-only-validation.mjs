#!/usr/bin/env node

/* eslint-disable max-lines -- Documentation validation keeps one auditable scope, privacy, link, and release preflight boundary. */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  classifyChangedPaths,
  getChangedFilesFromEntries,
  getChangedPathEntries,
  isDocumentationPath,
  isReleaseDocumentationPath
} from './pr-validation-scope.cjs'

const releaseVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u
const secretPatterns = [
  { label: 'GitHub token', pattern: /\b(?:gho|ghp|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/u },
  { label: 'GitHub fine-grained token', pattern: /\bgithub_pat_\w{20,}\b/u },
  { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { label: 'OpenAI-style secret', pattern: /\bsk-[\w-]{20,}\b/u },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/u }
]
const privatePathPatterns = [
  {
    label: 'personal macOS home path',
    pattern:
      /\/Users\/(?!<(?:user|username)>|\{(?:user|username)\}|\$(?:USER(?:NAME)?|\{USER(?:NAME)?\})\/|USER(?:NAME)?\/)[^/\s`]+\//u
  },
  {
    label: 'personal Linux home path',
    pattern:
      /\/home\/(?!<(?:user|username)>|\{(?:user|username)\}|\$(?:USER(?:NAME)?|\{USER(?:NAME)?\})\/|USER(?:NAME)?\/)[^/\s`]+\//u
  },
  { label: 'Codex worktree identifier', pattern: /\.codex\/worktrees\/[0-9a-f-]{4,}\//iu },
  { label: 'session worktree identifier', pattern: /\.oo\/worktrees\/sessions\/[\w-]{4,}\//u }
]

const runGit = (args, options = {}) =>
  execFileSync('git', args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    stdio: ['ignore', 'pipe', 'pipe']
  })

const getDiffRange = (base, head) => `${base}...${head}`

const stripFencedCodeBlocks = (content) => {
  let fence = ''
  const visibleLines = []
  for (const line of content.split('\n')) {
    const trimmedLine = line.trimStart()
    if (fence === '' && (trimmedLine.startsWith('```') || trimmedLine.startsWith('~~~'))) {
      fence = trimmedLine.slice(0, 3)
      continue
    }
    if (fence !== '' && trimmedLine.startsWith(fence)) {
      fence = ''
      continue
    }
    if (fence === '') visibleLines.push(line)
  }
  return visibleLines.join('\n')
}

const slugifyHeading = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/gu, '')
    .replace(/[`*_~]/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')

export const collectMarkdownAnchors = (content) => {
  const anchors = new Set()
  const occurrences = new Map()

  for (const line of content.split('\n')) {
    const marker = /^(#{1,6})[\t ]+/u.exec(line)
    if (marker == null) continue
    const heading = line.slice(marker[0].length).trim().replace(/[\t ]+#+[\t ]*$/u, '')
    const explicitAnchor = /[\t ]+\{#([^}]+)\}[\t ]*$/u.exec(heading)
    const baseAnchor = explicitAnchor?.[1] ?? slugifyHeading(heading.replace(/[\t ]+\{#[^}]+\}[\t ]*$/u, ''))
    if (baseAnchor === '') continue
    const occurrence = occurrences.get(baseAnchor) ?? 0
    occurrences.set(baseAnchor, occurrence + 1)
    anchors.add(occurrence === 0 ? baseAnchor : `${baseAnchor}-${occurrence}`)
  }

  return anchors
}

const collectLocalLinkTargets = (content) => {
  const targets = []
  const strippedContent = stripFencedCodeBlocks(content)
  const markdownLinkPattern = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/gu
  const htmlLinkPattern = /\b(?:href|src)=["']([^"']+)["']/giu
  const htmlSrcsetPattern = /\bsrcset=["']([^"']+)["']/giu
  const referenceDefinitionPattern =
    /^[\t ]{0,3}\[[^\]]+\]:[\t ]*(?:<([^>\n]+)>|(\S+))(?:[\t ]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[\t ]*$/gmu

  for (const match of strippedContent.matchAll(markdownLinkPattern)) {
    targets.push(match[1] ?? match[2])
  }
  for (const match of strippedContent.matchAll(htmlLinkPattern)) targets.push(match[1])
  for (const match of strippedContent.matchAll(htmlSrcsetPattern)) {
    for (const candidate of match[1].split(',')) {
      const target = candidate.trim().split(/\s+/u)[0]
      if (target !== '') targets.push(target)
    }
  }
  for (const match of strippedContent.matchAll(referenceDefinitionPattern)) {
    targets.push(match[1] ?? match[2])
  }

  return targets
}

const isExternalTarget = (target) => (
  /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target) ||
  target.startsWith('/')
)

const resolveLinkTarget = (root, sourceFile, targetPath) => {
  const decodedTarget = decodeURIComponent(targetPath)
  const absoluteTarget = path.resolve(root, path.dirname(sourceFile), decodedTarget)
  const rootPrefix = `${path.resolve(root)}${path.sep}`
  if (absoluteTarget !== path.resolve(root) && !absoluteTarget.startsWith(rootPrefix)) {
    return { error: `escapes the repository: ${targetPath}` }
  }

  const candidates = [absoluteTarget]
  if (path.extname(absoluteTarget) === '') {
    candidates.push(`${absoluteTarget}.md`, path.join(absoluteTarget, 'README.md'))
  }

  const existingTarget = candidates.find(candidate => existsSync(candidate))
  return existingTarget == null
    ? { error: `does not exist: ${targetPath}` }
    : { path: existingTarget }
}

const listGitlinks = (root) =>
  runGit(['ls-files', '--stage'], { cwd: root })
    .split('\n')
    .map(line => /^160000\s+[0-9a-f]+\s+\d+\t(.+)$/u.exec(line)?.[1])
    .filter(Boolean)

const isInsideGitlink = (filePath, gitlinks) =>
  gitlinks.some(gitlink => (
    filePath === gitlink || filePath.startsWith(`${gitlink}/`)
  ))

const normalizeRepositoryPath = (filePath) => path.posix.normalize(filePath.replaceAll('\\', '/')).replace(/^\.\//u, '')

const getRepositoryTargetCandidates = (sourceFile, target) => {
  if (target == null || target === '' || isExternalTarget(target)) return []
  const [targetWithQuery] = target.split('#', 1)
  const targetPath = targetWithQuery.split('?', 1)[0]
  if (targetPath === '') return []

  const decodedTarget = decodeURIComponent(targetPath).replaceAll('\\', '/')
  const resolvedTarget = normalizeRepositoryPath(path.posix.join(path.posix.dirname(sourceFile), decodedTarget))
  if (resolvedTarget === '..' || resolvedTarget.startsWith('../') || resolvedTarget.startsWith('/')) return []

  const candidates = [resolvedTarget]
  if (path.posix.extname(resolvedTarget) === '') {
    candidates.push(`${resolvedTarget}.md`, path.posix.join(resolvedTarget, 'README.md'))
  }
  return candidates
}

export const collectRemovedDocumentationPaths = (changes) =>
  changes.flatMap(change => {
    const status = change.status.at(0)
    if (status === 'D') return change.paths.slice(0, 1)
    if (status === 'R') return change.paths.slice(0, 1)
    return []
  })

const listTrackedMarkdownFiles = (root) =>
  runGit(['ls-files', '-z', '--', '*.md'], { cwd: root })
    .split('\0')
    .filter(Boolean)

export const validateImpactedDocumentationLinks = ({
  changedFiles = [],
  readFile = readFileSync,
  removedFiles,
  root = process.cwd(),
  trackedMarkdownFiles = listTrackedMarkdownFiles(root)
}) => {
  const removedPaths = new Set(removedFiles.map(normalizeRepositoryPath))
  const changedPaths = new Set(changedFiles.map(normalizeRepositoryPath))
  const violations = []

  if (removedPaths.size === 0 && changedPaths.size === 0) return violations

  for (const filePath of trackedMarkdownFiles) {
    const normalizedFilePath = normalizeRepositoryPath(filePath)
    if (changedPaths.has(normalizedFilePath) || removedPaths.has(normalizedFilePath)) continue
    const absolutePath = path.join(root, normalizedFilePath)
    if (!existsSync(absolutePath)) continue

    for (const target of collectLocalLinkTargets(readFile(absolutePath, 'utf8'))) {
      const removedTarget = getRepositoryTargetCandidates(normalizedFilePath, target)
        .find(candidate => removedPaths.has(candidate))
      if (removedTarget != null) {
        violations.push(`${normalizedFilePath}: links to removed documentation path ${removedTarget}`)
        continue
      }

      const changedTarget = getRepositoryTargetCandidates(normalizedFilePath, target)
        .find(candidate => changedPaths.has(candidate))
      const rawFragment = target.split('#', 2)[1]
      if (changedTarget != null && rawFragment != null && rawFragment !== '') {
        const changedTargetPath = path.join(root, changedTarget)
        if (!existsSync(changedTargetPath) || path.extname(changedTargetPath).toLowerCase() !== '.md') continue
        const fragment = decodeURIComponent(rawFragment).toLowerCase()
        const anchors = collectMarkdownAnchors(readFile(changedTargetPath, 'utf8'))
        if (!anchors.has(fragment)) {
          violations.push(`${normalizedFilePath}: missing anchor #${rawFragment} in ${changedTarget}`)
        }
      }
    }
  }

  return [...new Set(violations)]
}

export const validateMarkdownLinks = ({ content, filePath, gitlinks = [], root }) => {
  const violations = []

  for (const target of collectLocalLinkTargets(content)) {
    if (target == null || target === '' || isExternalTarget(target)) continue
    const [targetWithQuery, rawFragment] = target.split('#', 2)
    const targetPath = targetWithQuery.split('?', 1)[0]
    const sourceOrTargetPath = targetPath === '' ? filePath : targetPath
    const resolved = targetPath === ''
      ? { path: path.resolve(root, filePath) }
      : resolveLinkTarget(root, filePath, sourceOrTargetPath)
    if (resolved.error != null) {
      const repositoryRelativeTarget = path.normalize(path.join(path.dirname(filePath), sourceOrTargetPath))
        .replaceAll('\\', '/')
      if (!isInsideGitlink(repositoryRelativeTarget, gitlinks)) {
        violations.push(`${filePath}: ${resolved.error}`)
      }
      continue
    }

    if (rawFragment == null || rawFragment === '') continue
    if (!statSync(resolved.path).isFile() || path.extname(resolved.path).toLowerCase() !== '.md') continue

    const fragment = decodeURIComponent(rawFragment).toLowerCase()
    const anchors = collectMarkdownAnchors(readFileSync(resolved.path, 'utf8'))
    if (!anchors.has(fragment)) {
      violations.push(`${filePath}: missing anchor #${rawFragment} in ${sourceOrTargetPath}`)
    }
  }

  return violations
}

export const validateAddedLinePrivacy = (addedLines) => {
  const violations = []
  for (const { filePath, line, lineNumber } of addedLines) {
    for (const check of [...secretPatterns, ...privatePathPatterns]) {
      if (check.pattern.test(line)) {
        violations.push(`${filePath}:${lineNumber}: added ${check.label}`)
      }
    }
  }
  return violations
}

const collectAddedLines = ({ base, cwd, documentationFiles, head }) => {
  if (documentationFiles.length === 0) return []
  const output = runGit([
    'diff',
    '--no-color',
    '--unified=0',
    getDiffRange(base, head),
    '--',
    ...documentationFiles
  ], { cwd })
  const addedLines = []
  let filePath = ''
  let nextLineNumber = 0

  for (const line of output.split('\n')) {
    const fileMatch = /^\+\+\+ b\/(.+)$/u.exec(line)
    if (fileMatch != null) {
      filePath = fileMatch[1]
      continue
    }
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line)
    if (hunkMatch != null) {
      nextLineNumber = Number.parseInt(hunkMatch[1], 10)
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines.push({ filePath, line: line.slice(1), lineNumber: nextLineNumber })
      nextLineNumber += 1
    }
  }

  return addedLines
}

export const validateReleaseDocumentation = ({
  changedFiles,
  readFile = readFileSync,
  root = process.cwd()
}) => {
  const violations = []
  for (const filePath of changedFiles.filter(isReleaseDocumentationPath)) {
    if (!filePath.startsWith('changelog/') || filePath === 'changelog/AGENTS.md') continue
    const segments = filePath.split('/')
    if (segments.length !== 3 || !releaseVersionPattern.test(segments[1]) || !segments[2].endsWith('.md')) {
      violations.push(`${filePath}: expected changelog/<semver>/<entry>.md`)
      continue
    }
    const absolutePath = path.join(root, filePath)
    if (!existsSync(absolutePath)) continue

    const content = readFile(absolutePath, 'utf8')
    const firstHeading = content
      .split('\n')
      .find(line => line.startsWith('# '))
      ?.slice(2)
      .trim()
    if (firstHeading == null) {
      violations.push(`${filePath}: changelog entry must have one level-one heading`)
    } else if (segments[2].toLowerCase() === 'readme.md' && !firstHeading.includes(segments[1])) {
      violations.push(`${filePath}: release heading must include version ${segments[1]}`)
    }
  }
  return violations
}

const runDiffCheck = ({ base, cwd, head }) => {
  const result = spawnSync('git', ['diff', '--check', getDiffRange(base, head)], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.status === 0) return []
  const details = `${result.stdout}${result.stderr}`.trim()
  return [details === '' ? 'git diff --check failed' : details]
}

const parseArguments = (args) => {
  const parsed = { allowMixed: false, base: '', head: 'HEAD', releasePreflight: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--allow-mixed') parsed.allowMixed = true
    else if (argument === '--base') parsed.base = args[++index] ?? ''
    else if (argument === '--head') parsed.head = args[++index] ?? 'HEAD'
    else if (argument === '--release-preflight') parsed.releasePreflight = true
    else throw new Error(`Unknown docs-only validation argument: ${argument}`)
  }
  return parsed
}

export const runDocsOnlyValidation = (args = process.argv.slice(2), options = {}) => {
  const input = parseArguments(args)
  const cwd = options.cwd ?? process.cwd()
  if (input.base.trim() === '' || /^0+$/u.test(input.base)) {
    throw new Error('Docs-only validation requires a non-empty base commit.')
  }
  const changedPathEntries = getChangedPathEntries({ base: input.base, cwd, head: input.head })
  const scope = classifyChangedPaths(getChangedFilesFromEntries(changedPathEntries))
  if (!scope.docsChanged) {
    throw new Error('Documentation validation requires at least one documentation content or media path.')
  }
  if (!scope.docsOnly && !input.allowMixed) {
    throw new Error(`Docs-only validation cannot cover non-documentation paths: ${scope.nonDocsFiles.join(', ')}`)
  }
  if (input.releasePreflight && !scope.releaseDocs) {
    throw new Error('Release docs preflight requires a changelog or release-rule documentation change.')
  }

  const gitlinks = listGitlinks(cwd)
  const documentationFiles = scope.changedFiles.filter(isDocumentationPath)
  const violations = [
    ...runDiffCheck({ base: input.base, cwd, head: input.head }),
    ...validateAddedLinePrivacy(collectAddedLines({
      base: input.base,
      cwd,
      documentationFiles,
      head: input.head
    })),
    ...validateImpactedDocumentationLinks({
      changedFiles: documentationFiles,
      removedFiles: collectRemovedDocumentationPaths(changedPathEntries),
      root: cwd
    })
  ]

  for (const filePath of documentationFiles.filter(file => file.toLowerCase().endsWith('.md'))) {
    const absolutePath = path.join(cwd, filePath)
    if (!existsSync(absolutePath)) continue
    violations.push(...validateMarkdownLinks({
      content: readFileSync(absolutePath, 'utf8'),
      filePath,
      gitlinks,
      root: cwd
    }))
  }

  if (input.releasePreflight) {
    violations.push(...validateReleaseDocumentation({ changedFiles: scope.changedFiles, root: cwd }))
  }

  if (violations.length > 0) {
    throw new Error(`Documentation validation failed:\n- ${violations.join('\n- ')}`)
  }

  process.stdout.write(
    `[docs-only-validation] ok (${scope.changedFiles.length} path(s)` +
      `${input.releasePreflight ? ', release preflight' : ''})\n`
  )
  return { scope, violations }
}

if (process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    runDocsOnlyValidation()
  } catch (error) {
    process.stderr.write(`[docs-only-validation] ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
