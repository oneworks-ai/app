import { spawn } from 'node:child_process'

import type { WorkspaceExternalOpenResponse } from '@oneworks/types'

import { getWorkspaceFolder } from '#~/services/config/index.js'
import { internalServerError, notFound } from '#~/utils/http.js'

import { openWorkspaceInFileManager } from './file-manager.js'
import type { ResolvedFileOpener } from './file-opener-descriptors.js'
import { normalizeRequestedOpener, selectFileOpener } from './file-opener-detection.js'
import { isWorkspaceTerminalOpenerId, openWorkspaceInTerminalOpener } from './workspace-terminal-openers.js'

const buildWorkspaceUriLocation = (scheme: string, workspaceFolder: string) => {
  const encodedPath = encodeURI(workspaceFolder).replaceAll('#', '%23').replaceAll('?', '%3F')
  return `${scheme}://file${encodedPath}`
}

const buildWorkspaceLaunchCommand = ({
  opener,
  workspaceFolder
}: {
  opener: ResolvedFileOpener
  workspaceFolder: string
}) => {
  if (opener.command != null) {
    if (opener.launchKind === 'vscodeLike') {
      return {
        command: opener.command,
        args: ['--reuse-window', workspaceFolder]
      }
    }

    return {
      command: opener.command,
      args: [workspaceFolder]
    }
  }

  if (opener.source === 'uri' && opener.uriScheme != null) {
    return {
      command: 'open',
      args: [buildWorkspaceUriLocation(opener.uriScheme, workspaceFolder)]
    }
  }

  if (opener.source === 'macApp' && opener.appName != null) {
    return {
      command: 'open',
      args: ['-a', opener.appName, workspaceFolder]
    }
  }

  throw notFound('Workspace opener is not available', { opener: opener.id }, 'workspace_opener_not_available')
}

const stripPrivateOpenerFields = ({
  appName: _appName,
  command: _command,
  launchKind: _launchKind,
  uriScheme: _uriScheme,
  ...opener
}: ResolvedFileOpener) => opener

export const openWorkspaceInExternalOpener = async (
  options: {
    opener?: unknown
    workspaceFolder?: string
  } = {}
): Promise<WorkspaceExternalOpenResponse> => {
  if (options.opener === 'fileManager') {
    return openWorkspaceInFileManager({ workspaceFolder: options.workspaceFolder })
  }

  const workspaceFolder = options.workspaceFolder ?? getWorkspaceFolder()
  if (isWorkspaceTerminalOpenerId(options.opener)) {
    return openWorkspaceInTerminalOpener(options.opener, workspaceFolder)
  }

  const opener = await selectFileOpener(normalizeRequestedOpener(options.opener))
  const command = buildWorkspaceLaunchCommand({ opener, workspaceFolder })

  try {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  } catch (error) {
    throw internalServerError('Failed to open workspace in external app', {
      cause: error,
      code: 'workspace_open_failed',
      details: { opener: opener.id }
    })
  }

  return {
    ok: true,
    opener: stripPrivateOpenerFields(opener),
    path: ''
  }
}
