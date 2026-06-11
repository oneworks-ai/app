import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { normalizeWorkspaceFolder } from '../workspace-state.cjs'

const isNodeError = (error: unknown): error is NodeJS.ErrnoException => (
  error instanceof Error && 'code' in error
)

export const ensureWorkspaceFolderExists = async (workspaceFolder: string) => {
  const trimmedWorkspaceFolder = workspaceFolder.trim()
  if (trimmedWorkspaceFolder === '') {
    throw new TypeError('A project folder path is required.')
  }

  const resolvedWorkspaceFolder = path.resolve(trimmedWorkspaceFolder)
  try {
    const stats = await stat(resolvedWorkspaceFolder)
    if (!stats.isDirectory()) {
      throw new Error('The selected path is not a folder.')
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error
    }

    await mkdir(resolvedWorkspaceFolder, { recursive: true })
  }

  const normalizedWorkspaceFolder = normalizeWorkspaceFolder(resolvedWorkspaceFolder)
  if (normalizedWorkspaceFolder == null) {
    throw new Error('The project folder could not be created.')
  }

  return normalizedWorkspaceFolder
}

const invalidProjectFolderNameCharacters = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

const normalizeProjectFolderName = (value: unknown) => {
  if (typeof value !== 'string') {
    throw new TypeError('A project folder name is required.')
  }

  const folderName = value.trim()
  if (folderName === '') {
    throw new TypeError('A project folder name is required.')
  }
  if (folderName === '.' || folderName === '..' || /[\r\n]/u.test(folderName)) {
    throw new TypeError('A project folder name is invalid.')
  }
  for (const character of folderName) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 32 || invalidProjectFolderNameCharacters.has(character)) {
      throw new TypeError('A project folder name is invalid.')
    }
  }

  return folderName
}

export const createWorkspaceFolderInDirectory = async ({
  parentDirectory,
  projectName
}: {
  parentDirectory: unknown
  projectName: unknown
}) => {
  if (typeof parentDirectory !== 'string' || parentDirectory.trim() === '') {
    throw new TypeError('A parent folder is required.')
  }

  const normalizedParentDirectory = normalizeWorkspaceFolder(path.resolve(parentDirectory.trim()))
  if (normalizedParentDirectory == null) {
    throw new TypeError('A parent folder is required.')
  }

  return await ensureWorkspaceFolderExists(
    path.resolve(normalizedParentDirectory, normalizeProjectFolderName(projectName))
  )
}
