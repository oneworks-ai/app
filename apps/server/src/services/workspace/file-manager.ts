import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { dirname } from 'node:path'

import type { WorkspaceExternalOpenResponse, WorkspacePathActionCapabilities } from '@oneworks/types'

import { getWorkspaceFolder } from '#~/services/config/index.js'
import { internalServerError, notFound } from '#~/utils/http.js'

import { findWorkspaceCommand } from './file-opener-detection.js'
import { resolveWorkspaceEntryPath } from './file.js'
import { resolveWorkspaceOpenerIconUrl } from './workspace-opener-icons.js'
import { listWorkspaceTerminalOpeners } from './workspace-terminal-openers.js'

export const getWorkspaceFileManagerCapability = async (): Promise<WorkspacePathActionCapabilities['fileManager']> => {
  const currentPlatform = platform()
  if (currentPlatform === 'darwin') {
    const iconUrl = await resolveWorkspaceOpenerIconUrl('fileManager')
    return {
      available: true,
      canRevealFile: true,
      ...(iconUrl != null ? { iconUrl } : {}),
      kind: 'finder',
      title: 'Finder'
    }
  }

  if (currentPlatform === 'win32') {
    return {
      available: true,
      canRevealFile: true,
      kind: 'explorer',
      title: 'File Explorer'
    }
  }

  return {
    available: await findWorkspaceCommand('xdg-open') != null,
    canRevealFile: false,
    kind: 'fileManager',
    title: 'File Manager'
  }
}

export const getWorkspacePathActionCapabilities = async (): Promise<WorkspacePathActionCapabilities> => ({
  fileManager: await getWorkspaceFileManagerCapability(),
  terminalOpeners: await listWorkspaceTerminalOpeners()
})

const buildRevealCommand = (
  filePath: string,
  isDirectory: boolean,
  fileManager: WorkspacePathActionCapabilities['fileManager']
) => {
  if (fileManager.kind === 'finder') {
    return {
      command: 'open',
      args: ['-R', filePath]
    }
  }

  if (fileManager.kind === 'explorer') {
    return {
      command: 'explorer.exe',
      args: [`/select,${filePath}`]
    }
  }

  return {
    command: 'xdg-open',
    args: [isDirectory ? filePath : dirname(filePath)]
  }
}

const buildOpenWorkspaceCommand = (
  workspaceFolder: string,
  fileManager: WorkspacePathActionCapabilities['fileManager']
) => {
  if (fileManager.kind === 'finder') {
    return {
      command: 'open',
      args: [workspaceFolder]
    }
  }

  if (fileManager.kind === 'explorer') {
    return {
      command: 'explorer.exe',
      args: [workspaceFolder]
    }
  }

  return {
    command: 'xdg-open',
    args: [workspaceFolder]
  }
}

export const openWorkspaceInFileManager = async (
  options: {
    workspaceFolder?: string
  } = {}
): Promise<WorkspaceExternalOpenResponse> => {
  const workspaceFolder = options.workspaceFolder ?? getWorkspaceFolder()
  const fileManager = await getWorkspaceFileManagerCapability()
  if (!fileManager.available) {
    throw notFound(
      'Workspace file manager is not available',
      undefined,
      'workspace_file_manager_not_available'
    )
  }
  const command = buildOpenWorkspaceCommand(workspaceFolder, fileManager)

  try {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  } catch (error) {
    throw internalServerError('Failed to open workspace in file manager', {
      cause: error,
      code: 'workspace_open_file_manager_failed'
    })
  }

  return {
    ok: true,
    opener: fileManager,
    path: ''
  }
}

export const revealWorkspacePathInFileManager = async (
  rawPath: string | undefined,
  options: {
    workspaceFolder?: string
  } = {}
) => {
  const workspaceFolder = options.workspaceFolder ?? getWorkspaceFolder()
  const { filePath, fileStat, normalizedPath } = await resolveWorkspaceEntryPath(rawPath, { workspaceFolder })
  const fileManager = await getWorkspaceFileManagerCapability()
  if (!fileManager.available) {
    throw notFound(
      'Workspace file manager is not available',
      { path: normalizedPath },
      'workspace_file_manager_not_available'
    )
  }
  const command = buildRevealCommand(filePath, fileStat.isDirectory(), fileManager)

  try {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  } catch (error) {
    throw internalServerError('Failed to reveal workspace path in file manager', {
      cause: error,
      code: 'workspace_path_reveal_failed',
      details: { path: normalizedPath }
    })
  }

  return {
    ok: true,
    path: normalizedPath
  }
}
