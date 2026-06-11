/* eslint-disable max-lines -- clone support keeps git execution and destination directory browsing together. */
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { normalizeWorkspaceFolder } from '../workspace-state.cjs'

interface GitCommandError extends Error {
  code?: number | string | null
  stderr?: string
  stdout?: string
}

interface GitCommandResult {
  stderr: string
  stdout: string
}

export interface CloneDestinationDirectory {
  name: string
  path: string
}

export interface CloneDestinationDirectoryList {
  currentDirectory: string
  directories: CloneDestinationDirectory[]
  parentDirectory?: string
}

const gitMaxBuffer = 1024 * 1024
const invalidFileNameCharacters = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

const runGitCommand = async (args: string[], cwd?: string): Promise<GitCommandResult> => (
  await new Promise<GitCommandResult>((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: gitMaxBuffer
      },
      (error, stdout, stderr) => {
        if (error != null) {
          reject(Object.assign(error, { stderr, stdout }))
          return
        }

        resolve({
          stderr: stderr.trim(),
          stdout: stdout.trim()
        })
      }
    )
  })
)

const formatGitErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) {
    const gitError = error as GitCommandError
    const stderr = gitError.stderr?.trim()
    if (stderr != null && stderr !== '') return stderr

    const stdout = gitError.stdout?.trim()
    if (stdout != null && stdout !== '') return stdout

    if (error.message.trim() !== '') return error.message.trim()
  }

  return fallback
}

const normalizeGitRepositoryUrl = (repositoryUrl: unknown) => {
  if (typeof repositoryUrl !== 'string') {
    throw new TypeError('A Git repository URL is required.')
  }

  const normalizedUrl = repositoryUrl.trim()
  if (normalizedUrl === '') {
    throw new TypeError('A Git repository URL is required.')
  }
  if (/[\r\n]/u.test(normalizedUrl)) {
    throw new TypeError('A Git repository URL must be one line.')
  }

  return normalizedUrl
}

const sanitizeRepositoryFolderName = (value: string) => (
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || invalidFileNameCharacters.has(character) ? '-' : character
  }).join('')
)

export const isGitAvailable = async () => {
  try {
    await runGitCommand(['--version'])
    return true
  } catch {
    return false
  }
}

export const inferRepositoryFolderName = (repositoryUrl: string) => {
  const normalizedUrl = repositoryUrl
    .trim()
    .replace(/[?#].*$/u, '')
    .replace(/\/+$/u, '')
  const lastSegment = normalizedUrl.split(/[/:\\]/u).filter(Boolean).at(-1) ?? 'repository'
  const folderName = sanitizeRepositoryFolderName(lastSegment.replace(/\.git$/iu, ''))
    .replace(/^\.+/u, '')
    .trim()

  return folderName === '' ? 'repository' : folderName
}

const resolveDefaultCloneDestinationDirectory = () => (
  normalizeWorkspaceFolder(homedir()) ?? path.parse(homedir()).root
)

const resolveCloneDestinationDirectory = (rawDirectory?: unknown) => {
  if (typeof rawDirectory === 'string' && rawDirectory.trim() !== '') {
    const normalizedDirectory = normalizeWorkspaceFolder(path.resolve(rawDirectory.trim()))
    if (normalizedDirectory != null) return normalizedDirectory
  }

  return resolveDefaultCloneDestinationDirectory()
}

export const listCloneDestinationDirectories = async (
  rawDirectory?: unknown
): Promise<CloneDestinationDirectoryList> => {
  const currentDirectory = resolveCloneDestinationDirectory(rawDirectory)
  const rootDirectory = path.parse(currentDirectory).root
  const parentCandidate = path.dirname(currentDirectory)
  const parentDirectory = parentCandidate === currentDirectory || currentDirectory === rootDirectory
    ? undefined
    : normalizeWorkspaceFolder(parentCandidate)
  const entries = await readdir(currentDirectory, { withFileTypes: true }).catch(() => [])
  const directories = (
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) return undefined

      const entryPath = path.resolve(currentDirectory, entry.name)
      const entryStat = await stat(entryPath).catch(() => undefined)
      if (entryStat?.isDirectory() !== true) return undefined

      const normalizedEntryPath = normalizeWorkspaceFolder(entryPath)
      if (normalizedEntryPath == null) return undefined

      return {
        name: entry.name,
        path: normalizedEntryPath
      }
    }))
  )
    .filter((entry): entry is CloneDestinationDirectory => entry != null)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))

  return {
    currentDirectory,
    directories,
    ...(parentDirectory == null ? {} : { parentDirectory })
  }
}

export const cloneGitRepositoryIntoDirectory = async ({
  destinationDirectory,
  repositoryUrl
}: {
  destinationDirectory: unknown
  repositoryUrl: unknown
}) => {
  if (!await isGitAvailable()) {
    throw new Error('Git is not available in PATH.')
  }

  const normalizedUrl = normalizeGitRepositoryUrl(repositoryUrl)
  if (typeof destinationDirectory !== 'string' || destinationDirectory.trim() === '') {
    throw new TypeError('A destination folder is required.')
  }

  const normalizedDestinationDirectory = normalizeWorkspaceFolder(path.resolve(destinationDirectory.trim()))
  if (normalizedDestinationDirectory == null) {
    throw new TypeError('A destination folder is required.')
  }

  const targetFolder = path.resolve(normalizedDestinationDirectory, inferRepositoryFolderName(normalizedUrl))
  try {
    await runGitCommand(['clone', '--', normalizedUrl, targetFolder], normalizedDestinationDirectory)
    const normalizedWorkspaceFolder = normalizeWorkspaceFolder(targetFolder)
    if (normalizedWorkspaceFolder == null) {
      throw new Error('The cloned project folder could not be opened.')
    }
    return normalizedWorkspaceFolder
  } catch (error) {
    throw new Error(formatGitErrorMessage(error, 'Failed to clone repository.'))
  }
}

export const cloneGitRepositoryToFolder = async ({
  repositoryUrl,
  targetFolder
}: {
  repositoryUrl: unknown
  targetFolder: string
}) => {
  if (!await isGitAvailable()) {
    throw new Error('Git is not available in PATH.')
  }

  const normalizedUrl = normalizeGitRepositoryUrl(repositoryUrl)
  const resolvedTargetFolder = path.resolve(targetFolder)
  const normalizedTargetParentFolder = normalizeWorkspaceFolder(path.dirname(resolvedTargetFolder))
  if (normalizedTargetParentFolder == null) {
    throw new TypeError('A target project folder is required.')
  }

  try {
    await runGitCommand(['clone', '--', normalizedUrl, resolvedTargetFolder], normalizedTargetParentFolder)
    const normalizedTargetFolder = normalizeWorkspaceFolder(resolvedTargetFolder)
    if (normalizedTargetFolder == null) {
      throw new Error('The cloned project folder could not be opened.')
    }
    return normalizedTargetFolder
  } catch (error) {
    throw new Error(formatGitErrorMessage(error, 'Failed to clone repository.'))
  }
}
