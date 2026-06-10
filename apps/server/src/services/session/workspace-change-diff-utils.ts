import { Buffer } from 'node:buffer'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { GitChangedFile } from '@oneworks/types'

import { runGit } from '#~/services/git/runner.js'

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const MAX_DIFF_PATCH_BYTES = 128 * 1024

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

const truncatePatch = (patch: string) => {
  if (Buffer.byteLength(patch, 'utf8') <= MAX_DIFF_PATCH_BYTES) {
    return { patch, truncated: false }
  }

  return {
    patch: `${Buffer.from(patch).subarray(0, MAX_DIFF_PATCH_BYTES).toString('utf8')}\n`,
    truncated: true
  }
}

const getOmittedPatch = (relativePath: string, reason: string) => ({
  patch: [
    `diff --git a/${relativePath} b/${relativePath}`,
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    '@@ -0,0 +1 @@',
    `+${reason}`
  ].join('\n'),
  truncated: false
})

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

const getUntrackedDiffOutput = async (repositoryRoot: string, relativePath: string) => {
  const filePath = getSafeWorkspacePath(repositoryRoot, relativePath)
  if (filePath == null) {
    return getOmittedPatch(relativePath, 'Diff omitted: file is outside the repository.')
  }

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      return getOmittedPatch(relativePath, 'Diff omitted: path is not a regular file.')
    }
    if (fileStat.size > MAX_DIFF_PATCH_BYTES) {
      return getOmittedPatch(relativePath, 'Diff omitted: file is too large.')
    }

    const content = await readFile(filePath)
    if (content.includes(0)) {
      return getOmittedPatch(relativePath, 'Diff omitted: binary file.')
    }

    const text = content.toString('utf8')
    const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n')
    return {
      patch: [
        `diff --git a/${relativePath} b/${relativePath}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${relativePath}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map(line => `+${line}`)
      ].join('\n'),
      truncated: false
    }
  } catch {
    return getOmittedPatch(relativePath, 'Diff omitted: file could not be read.')
  }
}

export const getWorkspaceChangeFileDiffs = async (repositoryRoot: string, files: GitChangedFile[]) => {
  const entries = await Promise.all(files.map(async (file) => {
    const diff = file.untracked
      ? await getUntrackedDiffOutput(repositoryRoot, file.path)
      : truncatePatch(await getTrackedDiffOutput(repositoryRoot, file.path))
    return [file.path, diff] as const
  }))

  return new Map(entries)
}
