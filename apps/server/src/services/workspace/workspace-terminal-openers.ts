/* eslint-disable max-lines -- terminal opener detection and launch commands stay colocated. */
import { spawn } from 'node:child_process'
import { platform } from 'node:os'

import type {
  WorkspaceExternalOpenResponse,
  WorkspaceTerminalOpenerId,
  WorkspaceTerminalOpenerInfo
} from '@oneworks/types'

import { internalServerError, notFound } from '#~/utils/http.js'

import { findWorkspaceCommand } from './file-opener-detection.js'
import { resolveMacAppPath, resolveWorkspaceOpenerIconUrl } from './workspace-opener-icons.js'

interface ResolvedWorkspaceTerminalOpener extends WorkspaceTerminalOpenerInfo {
  command?: string
}

const TERMINAL_OPENER_IDS = new Set<WorkspaceTerminalOpenerId>(['terminal', 'warp'])

const resolveMacAppName = async (appName: string) => {
  if (platform() !== 'darwin') return undefined
  return await resolveMacAppPath(appName) == null ? undefined : appName
}

const stripPrivateTerminalOpenerFields = ({
  command: _command,
  ...opener
}: ResolvedWorkspaceTerminalOpener) => opener

const resolveTerminalOpener = async (): Promise<ResolvedWorkspaceTerminalOpener> => {
  const currentPlatform = platform()
  if (currentPlatform === 'darwin') {
    const appName = await resolveMacAppName('Terminal')
    const iconUrl = await resolveWorkspaceOpenerIconUrl('terminal', ['Terminal'])
    return {
      available: appName != null,
      id: 'terminal',
      ...(iconUrl != null ? { iconUrl } : {}),
      ...(appName != null ? { source: 'macApp' } : {}),
      title: 'Terminal'
    }
  }

  if (currentPlatform === 'win32') {
    const command = await findWorkspaceCommand('wt')
    return {
      available: command != null,
      id: 'terminal',
      ...(command != null ? { command, source: 'path' } : {}),
      title: 'Windows Terminal'
    }
  }

  const command = await findWorkspaceCommand('x-terminal-emulator') ??
    await findWorkspaceCommand('gnome-terminal') ??
    await findWorkspaceCommand('konsole')
  return {
    available: command != null,
    id: 'terminal',
    ...(command != null ? { command, source: 'path' } : {}),
    title: 'Terminal'
  }
}

const resolveWarpOpener = async (): Promise<ResolvedWorkspaceTerminalOpener> => {
  if (platform() === 'darwin') {
    const appName = await resolveMacAppName('Warp')
    const iconUrl = await resolveWorkspaceOpenerIconUrl('warp', ['Warp'])
    return {
      available: appName != null,
      id: 'warp',
      ...(iconUrl != null ? { iconUrl } : {}),
      ...(appName != null ? { source: 'uri' } : {}),
      title: 'Warp'
    }
  }

  const command = await findWorkspaceCommand('warp-terminal')
  return {
    available: command != null,
    id: 'warp',
    ...(command != null ? { command, source: 'uri' } : {}),
    title: 'Warp'
  }
}

const resolveWorkspaceTerminalOpener = async (id: WorkspaceTerminalOpenerId) => (
  id === 'warp' ? resolveWarpOpener() : resolveTerminalOpener()
)

export const isWorkspaceTerminalOpenerId = (value: unknown): value is WorkspaceTerminalOpenerId => (
  typeof value === 'string' && TERMINAL_OPENER_IDS.has(value as WorkspaceTerminalOpenerId)
)

export const listWorkspaceTerminalOpeners = async (): Promise<WorkspaceTerminalOpenerInfo[]> => {
  const openers = await Promise.all([
    resolveTerminalOpener(),
    resolveWarpOpener()
  ])
  return openers.map(stripPrivateTerminalOpenerFields)
}

const buildWarpUri = (workspaceFolder: string) => {
  const encodedPath = encodeURIComponent(workspaceFolder)
  return `warp://action/new_tab?path=${encodedPath}`
}

const buildTerminalLaunchCommand = (
  opener: ResolvedWorkspaceTerminalOpener,
  workspaceFolder: string
) => {
  if (opener.id === 'warp') {
    const uri = buildWarpUri(workspaceFolder)
    if (platform() === 'win32') {
      return {
        command: 'cmd.exe',
        args: ['/c', 'start', '', uri]
      }
    }
    return {
      command: platform() === 'darwin' ? 'open' : 'xdg-open',
      args: [uri]
    }
  }

  const currentPlatform = platform()
  if (currentPlatform === 'darwin') {
    return {
      command: 'open',
      args: ['-a', 'Terminal', workspaceFolder]
    }
  }

  if (currentPlatform === 'win32' && opener.command != null) {
    return {
      command: opener.command,
      args: ['-d', workspaceFolder]
    }
  }

  if (opener.command?.endsWith('gnome-terminal') || opener.command === 'gnome-terminal') {
    return {
      command: opener.command,
      args: ['--working-directory', workspaceFolder]
    }
  }

  if (opener.command?.endsWith('konsole') || opener.command === 'konsole') {
    return {
      command: opener.command,
      args: ['--workdir', workspaceFolder]
    }
  }

  if (opener.command != null) {
    return {
      command: opener.command,
      args: []
    }
  }

  throw notFound(
    'Workspace terminal opener is not available',
    { opener: opener.id },
    'workspace_terminal_opener_not_available'
  )
}

export const openWorkspaceInTerminalOpener = async (
  openerId: WorkspaceTerminalOpenerId,
  workspaceFolder: string
): Promise<WorkspaceExternalOpenResponse> => {
  const opener = await resolveWorkspaceTerminalOpener(openerId)
  if (!opener.available) {
    throw notFound(
      'Workspace terminal opener is not available',
      { opener: openerId },
      'workspace_terminal_opener_not_available'
    )
  }
  const command = buildTerminalLaunchCommand(opener, workspaceFolder)

  try {
    const child = spawn(command.command, command.args, {
      cwd: workspaceFolder,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  } catch (error) {
    throw internalServerError('Failed to open workspace in terminal app', {
      cause: error,
      code: 'workspace_open_terminal_failed',
      details: { opener: opener.id }
    })
  }

  return {
    ok: true,
    opener: stripPrivateTerminalOpenerFields(opener),
    path: ''
  }
}
