import type { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { GitChangedFile } from '@oneworks/types'

import { runGit } from '#~/services/git/runner.js'
import { parseGitNumstat } from '#~/services/git/summary-parsers.js'
import type { ParsedGitNumstatEntry } from '#~/services/git/summary-parsers.js'

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const MAX_UNTRACKED_LINE_COUNT_BYTES = 512 * 1024

const hashText = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

const isMissingHeadError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false
  }

  return /does not have any commits yet/i.test(error.message) || /ambiguous argument 'HEAD'/i.test(error.message)
}

const getSafeWorkspacePath = (repositoryRoot: string, relativePath: string) => {
  const resolvedPath = path.resolve(repositoryRoot, relativePath)
  const relative = path.relative(repositoryRoot, resolvedPath)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined
  }
  return resolvedPath
}

const countTextLines = (content: Buffer) => {
  if (content.length === 0 || content.includes(0)) {
    return 0
  }

  const text = content.toString('utf8')
  if (text === '') {
    return 0
  }

  const newlineCount = text.split('\n').length - 1
  return text.endsWith('\n') ? newlineCount : newlineCount + 1
}

const readUntrackedLineCount = async (repositoryRoot: string, relativePath: string) => {
  const filePath = getSafeWorkspacePath(repositoryRoot, relativePath)
  if (filePath == null) {
    return 0
  }

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size > MAX_UNTRACKED_LINE_COUNT_BYTES) {
      return 0
    }
    return countTextLines(await readFile(filePath))
  } catch {
    return 0
  }
}

const getTrackedDiffOutput = async (repositoryRoot: string, relativePath: string) => {
  try {
    return (await runGit(['diff', 'HEAD', '--', relativePath], repositoryRoot)).stdout
  } catch (error) {
    if (!isMissingHeadError(error)) {
      throw error
    }
    return (await runGit(['diff', EMPTY_TREE_HASH, '--', relativePath], repositoryRoot)).stdout
  }
}

const getUntrackedSignature = async (repositoryRoot: string, relativePath: string) => {
  const filePath = getSafeWorkspacePath(repositoryRoot, relativePath)
  if (filePath == null) {
    return 'untracked:outside'
  }

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size > MAX_UNTRACKED_LINE_COUNT_BYTES) {
      return `untracked:${fileStat.size}:${fileStat.mtimeMs}`
    }
    return `untracked:${hashText(await readFile(filePath))}`
  } catch {
    return 'untracked:missing'
  }
}

export const getWorkspaceChangeFileSignature = async (repositoryRoot: string, file: GitChangedFile) => {
  const statusSignature = JSON.stringify({
    path: file.path,
    staged: file.staged,
    unstaged: file.unstaged,
    untracked: file.untracked,
    submodule: file.submodule
  })
  const contentSignature = file.untracked
    ? await getUntrackedSignature(repositoryRoot, file.path)
    : await getTrackedDiffOutput(repositoryRoot, file.path).catch(error =>
      `diff-error:${error instanceof Error ? error.message : String(error)}`
    )

  return hashText(`${statusSignature}\n${contentSignature}`)
}

const getTrackedNumstatEntries = async (repositoryRoot: string): Promise<ParsedGitNumstatEntry[]> => {
  try {
    return parseGitNumstat((await runGit(['diff', 'HEAD', '--numstat'], repositoryRoot)).stdout)
  } catch (error) {
    if (!isMissingHeadError(error)) {
      throw error
    }
    return parseGitNumstat((await runGit(['diff', EMPTY_TREE_HASH, '--numstat'], repositoryRoot)).stdout)
  }
}

export const getWorkspaceChangeFileStats = async (repositoryRoot: string, files: GitChangedFile[]) => {
  const trackedEntries = await getTrackedNumstatEntries(repositoryRoot)
  const statsByPath = new Map<string, { additions: number; deletions: number }>()

  for (const entry of trackedEntries) {
    const existing = statsByPath.get(entry.path) ?? { additions: 0, deletions: 0 }
    existing.additions += entry.additions
    existing.deletions += entry.deletions
    statsByPath.set(entry.path, existing)
  }

  await Promise.all(files.map(async (file) => {
    if (!file.untracked || statsByPath.has(file.path)) {
      return
    }

    statsByPath.set(file.path, {
      additions: await readUntrackedLineCount(repositoryRoot, file.path),
      deletions: 0
    })
  }))

  return statsByPath
}
