/* eslint-disable max-lines -- release tag planning keeps git diff loading and candidate formatting together. */
import type { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

import { buildPackageReleaseTag } from './cli-package-release'

export interface PackageManifestSnapshot {
  name?: unknown
  private?: unknown
  version?: unknown
}

export interface PackageManifestChange {
  after: null | PackageManifestSnapshot
  before: null | PackageManifestSnapshot
  path: string
}

export interface ReleaseTagCandidate {
  isNewPackage: boolean
  name: string
  path: string
  previousVersion: null | string
  private: boolean
  tag: string
  version: string
}

export interface ReleaseTagPlan {
  base: string
  head: string
  tags: ReleaseTagCandidate[]
}

interface GitNameStatusChange {
  oldPath?: string
  path: string
  status: string
}

export const isWorkspacePackageManifestPath = (filePath: string) => (
  filePath !== 'package.json' && filePath.endsWith('/package.json')
)

const readPackageIdentity = (manifest: null | PackageManifestSnapshot) => {
  if (manifest == null || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    return null
  }

  const name = manifest.name.trim()
  const version = manifest.version.trim()
  if (!name || !version) return null

  return {
    name,
    version,
    private: manifest.private === true
  }
}

export const createReleaseTagPlanFromManifestChanges = (
  changes: PackageManifestChange[],
  input: {
    base: string
    head: string
  }
): ReleaseTagPlan => {
  const tags = new Map<string, ReleaseTagCandidate>()

  for (const change of changes) {
    if (!isWorkspacePackageManifestPath(change.path)) continue

    const after = readPackageIdentity(change.after)
    if (after == null) continue

    const before = readPackageIdentity(change.before)
    const hasReleaseIdentityChange = before == null ||
      before.name !== after.name ||
      before.version !== after.version
    if (!hasReleaseIdentityChange) continue

    const tag = buildPackageReleaseTag(after.name, after.version)
    if (tags.has(tag)) {
      throw new Error(`Duplicate release tag candidate: ${tag}`)
    }

    tags.set(tag, {
      isNewPackage: before == null,
      name: after.name,
      path: change.path,
      previousVersion: before?.version ?? null,
      private: after.private,
      tag,
      version: after.version
    })
  }

  return {
    base: input.base,
    head: input.head,
    tags: [...tags.values()].sort((left, right) => left.tag.localeCompare(right.tag))
  }
}

export const parseGitNameStatusZ = (output: Buffer): GitNameStatusChange[] => {
  const entries = output.toString('utf8').split('\0').filter(Boolean)
  const changes: GitNameStatusChange[] = []

  for (let index = 0; index < entries.length;) {
    const status = entries[index++]
    if (status == null) break

    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = entries[index++]
      const newPath = entries[index++]
      if (oldPath != null && newPath != null) {
        changes.push({
          oldPath,
          path: newPath,
          status
        })
      }
      continue
    }

    const filePath = entries[index++]
    if (filePath != null) {
      changes.push({
        path: filePath,
        status
      })
    }
  }

  return changes
}

const runGit = (args: string[], options: { cwd: string }) => (
  execFileSync('git', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10
  })
)

const runGitBuffer = (args: string[], options: { cwd: string }) => (
  execFileSync('git', args, {
    cwd: options.cwd,
    maxBuffer: 1024 * 1024 * 10
  })
)

const resolveBaseRef = (base: string, head: string, cwd: string) => {
  if (base && !/^0+$/u.test(base)) return base
  return runGit(['rev-parse', `${head}^`], { cwd }).trim()
}

const readPackageAtRef = (cwd: string, ref: string, filePath: string) => {
  try {
    return JSON.parse(runGit(['show', `${ref}:${filePath}`], { cwd })) as PackageManifestSnapshot
  } catch {
    return null
  }
}

const listPackageManifestPathsAtRef = (cwd: string, ref: string) => (
  runGitBuffer([
    'ls-tree',
    '-r',
    '-z',
    '--name-only',
    ref,
    '--',
    'apps',
    'packages'
  ], { cwd })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter(isWorkspacePackageManifestPath)
    .sort()
)

export const loadReleaseTagPlan = (input: {
  base: string
  cwd?: string
  head: string
}) => {
  const cwd = input.cwd ?? process.cwd()
  if (!input.base || /^0+$/u.test(input.base)) {
    const changes = listPackageManifestPathsAtRef(cwd, input.head)
      .map((filePath): PackageManifestChange => ({
        path: filePath,
        before: null,
        after: readPackageAtRef(cwd, input.head, filePath)
      }))

    return createReleaseTagPlanFromManifestChanges(changes, {
      base: '',
      head: input.head
    })
  }

  const base = resolveBaseRef(input.base, input.head, cwd)
  const diffOutput = runGitBuffer([
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    base,
    input.head,
    '--',
    ':(glob)**/package.json'
  ], { cwd })

  const changes = parseGitNameStatusZ(diffOutput)
    .filter(change => change.status !== 'D')
    .map((change): PackageManifestChange => ({
      path: change.path,
      before: readPackageAtRef(cwd, base, change.oldPath ?? change.path),
      after: readPackageAtRef(cwd, input.head, change.path)
    }))

  return createReleaseTagPlanFromManifestChanges(changes, {
    base,
    head: input.head
  })
}

export const formatReleaseTagPlan = (plan: ReleaseTagPlan) => {
  if (plan.tags.length === 0) return '[release-tags] no package version changes'

  return [
    `[release-tags] ${plan.tags.length} tag candidate(s)`,
    ...plan.tags.map((tag) => {
      const versionPart = tag.previousVersion == null
        ? tag.version
        : `${tag.previousVersion} -> ${tag.version}`
      return `- ${tag.tag} (${tag.name}@${versionPart}, ${tag.path})`
    })
  ].join('\n')
}

export const runReleaseTagsPlan = async (input: {
  base: string
  cwd?: string
  head: string
  json?: boolean
}) => {
  const plan = loadReleaseTagPlan(input)
  if (input.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    return plan
  }

  process.stdout.write(`${formatReleaseTagPlan(plan)}\n`)
  return plan
}
