import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { promisify } from 'node:util'

import type { MessageWorkspaceFileOpener, WorkspaceFileOpenersResponse } from '@oneworks/types'

import { badRequest, notFound } from '#~/utils/http.js'

import { FILE_OPENER_DESCRIPTORS, FILE_OPENER_IDS } from './file-opener-descriptors.js'
import type { FileOpenerDescriptor, ResolvedFileOpener } from './file-opener-descriptors.js'
import { resolveMacAppPath, resolveWorkspaceOpenerIconUrl } from './workspace-opener-icons.js'

const execFileAsync = promisify(execFile)
const COMMAND_LOOKUP_TIMEOUT_MS = 1500

const pathExists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const commandLookupTool = () => (
  platform() === 'win32'
    ? { command: 'where.exe', args: [] as string[] }
    : { command: 'which', args: [] as string[] }
)

export const findWorkspaceCommand = async (command: string) => {
  const lookup = commandLookupTool()
  try {
    const result = await execFileAsync(lookup.command, [...lookup.args, command], {
      timeout: COMMAND_LOOKUP_TIMEOUT_MS,
      windowsHide: true
    })
    const stdout = typeof result === 'object' && result != null && 'stdout' in result
      ? result.stdout
      : result
    return String(stdout ?? '')
      .split(/\r?\n/)
      .map(item => item.trim())
      .find(Boolean)
  } catch {
    return undefined
  }
}

const resolveCliPath = async (descriptor: FileOpenerDescriptor) => {
  for (const command of descriptor.commands) {
    const resolvedCommand = await findWorkspaceCommand(command)
    if (resolvedCommand != null) {
      return resolvedCommand
    }
  }

  const candidates = descriptor.cliPaths?.(homedir()) ?? []
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return undefined
}

const resolveMacAppName = async (descriptor: FileOpenerDescriptor) => {
  if (platform() !== 'darwin') {
    return undefined
  }

  for (const appName of descriptor.appNames ?? []) {
    if (await resolveMacAppPath(appName) != null) return appName
  }

  return undefined
}

const descriptorToUnavailableInfo = (descriptor: FileOpenerDescriptor): ResolvedFileOpener => ({
  available: false,
  id: descriptor.id,
  launchKind: descriptor.launchKind,
  title: descriptor.title
})

const resolveFileOpener = async (descriptor: FileOpenerDescriptor): Promise<ResolvedFileOpener> => {
  const iconUrl = await resolveWorkspaceOpenerIconUrl(descriptor.id, descriptor.appNames)
  const command = await resolveCliPath(descriptor)
  if (command != null) {
    return {
      available: true,
      command,
      ...(iconUrl != null ? { iconUrl } : {}),
      id: descriptor.id,
      launchKind: descriptor.launchKind,
      source: 'path',
      title: descriptor.title
    }
  }

  const appName = await resolveMacAppName(descriptor)
  if (appName != null && descriptor.uriScheme != null) {
    return {
      appName,
      available: true,
      ...(iconUrl != null ? { iconUrl } : {}),
      id: descriptor.id,
      launchKind: descriptor.launchKind,
      source: 'uri',
      title: descriptor.title,
      uriScheme: descriptor.uriScheme
    }
  }

  if (appName != null) {
    return {
      appName,
      available: true,
      ...(iconUrl != null ? { iconUrl } : {}),
      id: descriptor.id,
      launchKind: descriptor.launchKind,
      source: 'macApp',
      title: descriptor.title
    }
  }

  return descriptorToUnavailableInfo(descriptor)
}

const stripPrivateOpenerFields = ({
  appName: _appName,
  command: _command,
  launchKind: _launchKind,
  uriScheme: _uriScheme,
  ...opener
}: ResolvedFileOpener) => opener

export const listWorkspaceFileOpeners = async (): Promise<WorkspaceFileOpenersResponse> => {
  const openers = await Promise.all(FILE_OPENER_DESCRIPTORS.map(resolveFileOpener))
  const defaultOpener = openers.find(opener => opener.available)?.id
  return {
    ...(defaultOpener != null ? { defaultOpener } : {}),
    openers: openers.map(stripPrivateOpenerFields)
  }
}

export const normalizeRequestedOpener = (value: unknown): MessageWorkspaceFileOpener => {
  if (value == null || value === '' || value === 'auto') {
    return 'auto'
  }
  if (typeof value === 'string' && FILE_OPENER_IDS.has(value as Exclude<MessageWorkspaceFileOpener, 'auto'>)) {
    return value as Exclude<MessageWorkspaceFileOpener, 'auto'>
  }
  throw badRequest('Unsupported workspace file opener', { opener: value }, 'workspace_file_opener_unsupported')
}

export const selectFileOpener = async (requestedOpener: MessageWorkspaceFileOpener) => {
  const openers = await Promise.all(FILE_OPENER_DESCRIPTORS.map(resolveFileOpener))
  if (requestedOpener === 'auto') {
    const opener = openers.find(item => item.available)
    if (opener == null) {
      throw notFound('No supported file opener was found', undefined, 'workspace_file_opener_not_found')
    }
    return opener
  }

  const opener = openers.find(item => item.id === requestedOpener)
  if (opener == null || !opener.available) {
    throw notFound(
      'Workspace file opener is not available',
      { opener: requestedOpener },
      'workspace_file_opener_not_available'
    )
  }
  return opener
}
