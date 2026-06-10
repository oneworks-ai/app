/* eslint-disable max-lines -- desktop file search keeps relative workspace and absolute filesystem traversal together. */
import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path'

import { matchesPinyinSearch, normalizePinyinSearchQuery } from '@oneworks/utils/pinyin-search'

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.logs',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules'
])

const MAX_MATCHED_FILE_RESULTS = 180
const MAX_SCANNED_DIRECTORIES = 260
const DEFAULT_FILE_RESULT_LIMIT = 80
type SearchPathMode = 'absolute' | 'relative'

export interface WorkspaceFileSearchResult {
  directory: string
  name: string
  path: string
  type: 'directory' | 'file'
}

const isPathInside = (parentPath: string, childPath: string) => {
  const childRelativePath = relative(parentPath, childPath)
  return childRelativePath === '' || (!childRelativePath.startsWith(`..${sep}`) && childRelativePath !== '..' &&
    !isAbsolute(childRelativePath))
}

const normalizeRelativePath = (workspaceFolder: string, rawPath: string) => {
  const trimmed = rawPath.trim()
  if (trimmed === '' || isAbsolute(trimmed)) {
    return undefined
  }

  const normalizedPath = relative(workspaceFolder, resolve(workspaceFolder, trimmed)).replaceAll('\\', '/')
  if (normalizedPath === '' || normalizedPath === '.' || normalizedPath === '..' || normalizedPath.startsWith('../')) {
    return undefined
  }
  return normalizedPath
}

const getDirectory = (path: string, name: string) => (
  path.endsWith(`/${name}`) ? path.slice(0, -name.length - 1) : ''
)

const getFilesystemSearchRoot = () => parse(homedir()).root

const matchesQuery = (path: string, query: string) => matchesPinyinSearch(query, [path])

const scoreSearchResult = (query: string) => (left: WorkspaceFileSearchResult, right: WorkspaceFileSearchResult) => {
  const leftScore = scorePath(left.path, left.name, query)
  const rightScore = scorePath(right.path, right.name, query)
  if (leftScore !== rightScore) return leftScore - rightScore
  return left.path.localeCompare(right.path)
}

const scorePath = (path: string, name: string, query: string) => {
  const normalizedPath = normalizePinyinSearchQuery(path)
  const normalizedName = normalizePinyinSearchQuery(name)
  if (normalizedName === query) return 0
  if (normalizedName.startsWith(query)) return 1
  if (normalizedPath.includes(`/${query}`)) return 2
  if (normalizedPath.includes(query)) return 3
  return 4
}

export const resolveWorkspaceFilePath = async (workspaceFolder: string, rawPath: string) => {
  const normalizedPath = normalizeRelativePath(workspaceFolder, rawPath)
  if (normalizedPath == null) {
    throw new Error('Workspace file path must be relative.')
  }

  const workspaceRealPath = await realpath(workspaceFolder)
  const targetPath = resolve(workspaceFolder, normalizedPath)
  const targetRealPath = await realpath(targetPath)
  if (!isPathInside(workspaceRealPath, targetRealPath)) {
    throw new Error('Workspace file path escapes the workspace root.')
  }

  const targetStat = await stat(targetRealPath)
  if (!targetStat.isFile()) {
    throw new Error('Workspace path is not a file.')
  }
  return targetRealPath
}

export const resolveWorkspaceDirectoryPath = async (workspaceFolder: string, rawPath: string) => {
  const normalizedPath = normalizeRelativePath(workspaceFolder, rawPath)
  if (normalizedPath == null) {
    throw new Error('Workspace directory path must be relative.')
  }

  const workspaceRealPath = await realpath(workspaceFolder)
  const targetPath = resolve(workspaceFolder, normalizedPath)
  const targetRealPath = await realpath(targetPath)
  if (!isPathInside(workspaceRealPath, targetRealPath)) {
    throw new Error('Workspace directory path escapes the workspace root.')
  }

  const targetStat = await stat(targetRealPath)
  if (!targetStat.isDirectory()) {
    throw new Error('Workspace path is not a directory.')
  }
  return targetRealPath
}

const resolveAbsoluteExistingPath = async (rawPath: string, expectedType: 'directory' | 'file') => {
  const trimmed = rawPath.trim()
  if (trimmed === '' || !isAbsolute(trimmed)) {
    throw new Error(`Filesystem ${expectedType} path must be absolute.`)
  }

  const targetRealPath = await realpath(trimmed)
  const targetStat = await stat(targetRealPath)
  if (expectedType === 'directory' && !targetStat.isDirectory()) {
    throw new Error('Filesystem path is not a directory.')
  }
  if (expectedType === 'file' && !targetStat.isFile()) {
    throw new Error('Filesystem path is not a file.')
  }
  return targetRealPath
}

export const resolveFilesystemDirectoryPath = async (rawPath: string) =>
  await resolveAbsoluteExistingPath(rawPath, 'directory')

export const resolveFilesystemFilePath = async (rawPath: string) => await resolveAbsoluteExistingPath(rawPath, 'file')

const createSearchResult = ({
  entryPath,
  name,
  pathMode,
  rootFolder,
  type
}: {
  entryPath: string
  name: string
  pathMode: SearchPathMode
  rootFolder: string
  type: WorkspaceFileSearchResult['type']
}): WorkspaceFileSearchResult => {
  if (pathMode === 'absolute') {
    const absolutePath = resolve(rootFolder, entryPath)
    return {
      directory: dirname(absolutePath),
      name,
      path: absolutePath,
      type
    }
  }

  return {
    directory: getDirectory(entryPath, name),
    name,
    path: entryPath,
    type
  }
}

const searchFiles = async ({
  includeDirectories = false,
  limit = DEFAULT_FILE_RESULT_LIMIT,
  pathMode,
  query,
  rootFolder
}: {
  includeDirectories?: boolean
  limit?: number
  pathMode: SearchPathMode
  query: string
  rootFolder: string
}) => {
  const normalizedQuery = normalizePinyinSearchQuery(query)
  if (normalizedQuery === '') {
    return []
  }

  const rootRealPath = await realpath(rootFolder)
  const directories = ['']
  const results: WorkspaceFileSearchResult[] = []
  let scannedDirectoryCount = 0

  while (
    directories.length > 0 &&
    results.length < MAX_MATCHED_FILE_RESULTS &&
    scannedDirectoryCount < MAX_SCANNED_DIRECTORIES
  ) {
    const directory = directories.shift() ?? ''
    scannedDirectoryCount += 1
    const directoryPath = resolve(rootFolder, directory)
    const directoryRealPath = await realpath(directoryPath).catch(() => undefined)
    if (directoryRealPath == null || !isPathInside(rootRealPath, directoryRealPath)) {
      continue
    }

    const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const entryPath = directory === '' ? entry.name : `${directory}/${entry.name}`
      if (entry.isSymbolicLink()) {
        const linkStat = await stat(resolve(rootFolder, entryPath)).catch(() => undefined)
        const linkRealPath = await realpath(resolve(rootFolder, entryPath)).catch(() => undefined)
        if (linkStat?.isFile() === true && linkRealPath != null && isPathInside(rootRealPath, linkRealPath)) {
          if (matchesQuery(entryPath, normalizedQuery)) {
            results.push(createSearchResult({
              entryPath,
              name: entry.name,
              pathMode,
              rootFolder,
              type: 'file'
            }))
          }
        }
        continue
      }

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          directories.push(entryPath)
          if (includeDirectories && matchesQuery(entryPath, normalizedQuery)) {
            results.push(createSearchResult({
              entryPath,
              name: entry.name,
              pathMode,
              rootFolder,
              type: 'directory'
            }))
          }
        }
        continue
      }

      if (entry.isFile() && matchesQuery(entryPath, normalizedQuery)) {
        results.push(createSearchResult({
          entryPath,
          name: entry.name,
          pathMode,
          rootFolder,
          type: 'file'
        }))
      }

      if (results.length >= MAX_MATCHED_FILE_RESULTS) break
    }
  }

  return results
    .sort(scoreSearchResult(normalizedQuery))
    .slice(0, limit)
}

export const searchWorkspaceFiles = async ({
  includeDirectories = false,
  limit = DEFAULT_FILE_RESULT_LIMIT,
  query,
  workspaceFolder
}: {
  includeDirectories?: boolean
  limit?: number
  query: string
  workspaceFolder: string
}) =>
  await searchFiles({
    includeDirectories,
    limit,
    pathMode: 'relative',
    query,
    rootFolder: workspaceFolder
  })

export const searchFilesystemFiles = async ({
  includeDirectories = false,
  limit = DEFAULT_FILE_RESULT_LIMIT,
  query,
  rootFolder = getFilesystemSearchRoot()
}: {
  includeDirectories?: boolean
  limit?: number
  query: string
  rootFolder?: string
}) =>
  await searchFiles({
    includeDirectories,
    limit,
    pathMode: 'absolute',
    query,
    rootFolder
  })
