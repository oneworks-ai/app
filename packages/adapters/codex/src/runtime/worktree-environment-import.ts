import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

import type {
  AdapterWorktreeEnvironmentImportCandidate,
  AdapterWorktreeEnvironmentImportDiscoverer
} from '@oneworks/types'
import { parse } from 'smol-toml'

import { readBoundedRegularFileNoFollow } from './bounded-regular-file-read'
import {
  buildCodexWorktreeEnvironmentCandidate,
  resolveUniqueSuggestedIds
} from './worktree-environment-import-candidate'

const CODEX_ENVIRONMENT_FILE_PATTERN = /\.toml$/i
const MAX_ENVIRONMENT_FILES = 32
const MAX_ENVIRONMENT_FILE_BYTES = 1024 * 1024

const compareEnvironmentFileNames = (left: string, right: string) => {
  if (left === 'environment.toml') return right === 'environment.toml' ? 0 : -1
  if (right === 'environment.toml') return 1

  const getNumberedIndex = (fileName: string) => {
    const match = /^environment-(\d+)\.toml$/i.exec(fileName)
    return match == null ? undefined : Number(match[1])
  }
  const leftIndex = getNumberedIndex(left)
  const rightIndex = getNumberedIndex(right)
  if (leftIndex != null && rightIndex != null) {
    return leftIndex - rightIndex || left.localeCompare(right, 'en')
  }
  if (leftIndex != null) return -1
  if (rightIndex != null) return 1
  return left.localeCompare(right, 'en')
}

const isPathInside = (parent: string, child: string) => {
  const pathFromParent = relative(parent, child)
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent))
}

export const discoverCodexWorktreeEnvironments: AdapterWorktreeEnvironmentImportDiscoverer = async ({ cwd }) => {
  const codexDirectory = join(cwd, '.codex')
  const environmentDirectory = join(codexDirectory, 'environments')

  try {
    const [workspaceStat, codexStat, environmentStat] = await Promise.all([
      lstat(cwd),
      lstat(codexDirectory),
      lstat(environmentDirectory)
    ])
    if (
      !workspaceStat.isDirectory() || workspaceStat.isSymbolicLink() ||
      !codexStat.isDirectory() || codexStat.isSymbolicLink() ||
      !environmentStat.isDirectory() || environmentStat.isSymbolicLink()
    ) {
      return { environments: [], found: false, skippedActionCount: 0, skippedEnvironmentCount: 0 }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { environments: [], found: false, skippedActionCount: 0, skippedEnvironmentCount: 0 }
    }
    throw error
  }

  const [canonicalWorkspace, canonicalEnvironmentDirectory] = await Promise.all([
    realpath(cwd),
    realpath(environmentDirectory)
  ])
  if (!isPathInside(canonicalWorkspace, canonicalEnvironmentDirectory)) {
    return { environments: [], found: false, skippedActionCount: 0, skippedEnvironmentCount: 0 }
  }

  const entries = (await readdir(environmentDirectory, { withFileTypes: true }))
    .filter(entry => CODEX_ENVIRONMENT_FILE_PATTERN.test(entry.name))
    .sort((left, right) => compareEnvironmentFileNames(left.name, right.name))
  const selectedEntries = entries.slice(0, MAX_ENVIRONMENT_FILES)
  let skippedActionCount = 0
  let skippedEnvironmentCount = Math.max(0, entries.length - selectedEntries.length)
  const candidates: AdapterWorktreeEnvironmentImportCandidate[] = []

  for (const entry of selectedEntries) {
    const filePath = join(environmentDirectory, entry.name)
    try {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        skippedEnvironmentCount += 1
        continue
      }
      const content = await readBoundedRegularFileNoFollow({
        canonicalParent: canonicalEnvironmentDirectory,
        filePath,
        maxBytes: MAX_ENVIRONMENT_FILE_BYTES
      })
      if (content == null) {
        skippedEnvironmentCount += 1
        continue
      }
      const built = buildCodexWorktreeEnvironmentCandidate(entry.name, parse(content))
      if (built == null) {
        skippedEnvironmentCount += 1
        continue
      }
      skippedActionCount += built.skippedActionCount
      if (built.candidate == null) {
        skippedEnvironmentCount += 1
        continue
      }
      candidates.push(built.candidate)
    } catch {
      skippedEnvironmentCount += 1
    }
  }

  return {
    environments: resolveUniqueSuggestedIds(candidates),
    found: entries.length > 0,
    skippedActionCount,
    skippedEnvironmentCount
  }
}
