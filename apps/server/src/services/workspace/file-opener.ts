import { spawn } from 'node:child_process'

import type { WorkspaceFileOpenResponse } from '@oneworks/types'

import { getWorkspaceFolder, loadConfigState } from '#~/services/config/index.js'
import { badRequest, internalServerError, notFound } from '#~/utils/http.js'

import type { ResolvedFileOpener } from './file-opener-descriptors.js'
import { normalizeRequestedOpener, selectFileOpener } from './file-opener-detection.js'
import { resolveWorkspaceFileEntryPath } from './file.js'

export { listWorkspaceFileOpeners } from './file-opener-detection.js'

const normalizeLocationPart = (value: unknown, field: 'line' | 'column') => {
  if (value == null) {
    return undefined
  }
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
    ? Number.parseInt(value, 10)
    : Number.NaN
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    throw badRequest(
      'Workspace file location must be a positive integer',
      { [field]: value },
      'workspace_file_location_invalid'
    )
  }
  return numberValue
}

const buildLocation = (filePath: string, line?: number, column?: number) => (
  line == null
    ? filePath
    : column == null
    ? `${filePath}:${line}`
    : `${filePath}:${line}:${column}`
)

const buildUriLocation = (scheme: string, filePath: string, line?: number, column?: number) => {
  const encodedPath = encodeURI(filePath).replaceAll('#', '%23').replaceAll('?', '%3F')
  return `${scheme}://file${buildLocation(encodedPath, line, column)}`
}

const buildLaunchCommand = ({
  filePath,
  line,
  column,
  opener,
  workspaceFolder
}: {
  filePath: string
  line?: number
  column?: number
  opener: ResolvedFileOpener
  workspaceFolder: string
}) => {
  const location = buildLocation(filePath, line, column)
  if (opener.command != null) {
    if (opener.launchKind === 'vscodeLike') {
      return {
        command: opener.command,
        args: ['--reuse-window', workspaceFolder, '--goto', location]
      }
    }
    if (opener.launchKind === 'jetbrains') {
      return {
        command: opener.command,
        args: line == null ? [filePath] : ['--line', String(line), filePath]
      }
    }
    return {
      command: opener.command,
      args: [location]
    }
  }

  if (opener.source === 'uri' && opener.uriScheme != null) {
    return {
      command: 'open',
      args: [buildUriLocation(opener.uriScheme, filePath, line, column)]
    }
  }

  if (opener.source === 'macApp' && opener.appName != null) {
    return {
      command: 'open',
      args: ['-a', opener.appName, filePath]
    }
  }

  throw notFound('Workspace file opener is not available', { opener: opener.id }, 'workspace_file_opener_not_available')
}

const stripPrivateOpenerFields = ({
  appName: _appName,
  command: _command,
  launchKind: _launchKind,
  uriScheme: _uriScheme,
  ...opener
}: ResolvedFileOpener) => opener

export const openWorkspaceFileInExternalOpener = async (
  rawPath: string | undefined,
  options: {
    column?: unknown
    line?: unknown
    opener?: unknown
    workspaceFolder?: string
  } = {}
): Promise<WorkspaceFileOpenResponse> => {
  const workspaceFolder = options.workspaceFolder ?? getWorkspaceFolder()
  const { filePath, normalizedPath } = await resolveWorkspaceFileEntryPath(rawPath, { workspaceFolder })
  const configState = options.opener == null ? await loadConfigState(workspaceFolder).catch(() => undefined) : undefined
  const configuredOpener = configState?.mergedConfig.messageLinks?.workspaceFileOpener
  const opener = await selectFileOpener(normalizeRequestedOpener(options.opener ?? configuredOpener))
  const line = normalizeLocationPart(options.line, 'line')
  const column = normalizeLocationPart(options.column, 'column')
  const command = buildLaunchCommand({ filePath, line, column, opener, workspaceFolder })

  try {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  } catch (error) {
    throw internalServerError('Failed to open workspace file in external app', {
      cause: error,
      code: 'workspace_file_open_failed',
      details: { opener: opener.id, path: normalizedPath }
    })
  }

  return {
    ok: true,
    opener: stripPrivateOpenerFields(opener),
    path: normalizedPath
  }
}
