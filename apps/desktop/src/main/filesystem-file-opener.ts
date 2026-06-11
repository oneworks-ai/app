/* eslint-disable max-lines -- desktop filesystem opener keeps local app detection and launch commands together. */
import { execFile, spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { shell } from 'electron'

import { resolveFilesystemFilePath } from './workspace-file-search'

const execFileAsync = promisify(execFile)
const COMMAND_LOOKUP_TIMEOUT_MS = 1500

type FilesystemFileOpenerId =
  | 'cursor'
  | 'goland'
  | 'intellij'
  | 'pycharm'
  | 'textedit'
  | 'vscode'
  | 'webstorm'
  | 'windsurf'
  | 'zed'
type RequestedFilesystemFileOpener = 'auto' | FilesystemFileOpenerId

interface FilesystemFileOpenerDescriptor {
  appNames?: string[]
  cliPaths?: (homeDir: string) => string[]
  commands: string[]
  id: FilesystemFileOpenerId
  launchKind: 'jetbrains' | 'simpleFile' | 'vscodeLike'
}

interface ResolvedFilesystemFileOpener {
  appName?: string
  command?: string
  id: FilesystemFileOpenerId
  launchKind: FilesystemFileOpenerDescriptor['launchKind']
  source: 'macApp' | 'path'
}

const filesystemFileOpenerDescriptors: FilesystemFileOpenerDescriptor[] = [
  {
    appNames: ['Visual Studio Code'],
    cliPaths: homeDir => [
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      join(homeDir, 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code')
    ],
    commands: ['code'],
    id: 'vscode',
    launchKind: 'vscodeLike'
  },
  {
    appNames: ['Cursor'],
    cliPaths: homeDir => [
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
      join(homeDir, 'Applications/Cursor.app/Contents/Resources/app/bin/cursor')
    ],
    commands: ['cursor'],
    id: 'cursor',
    launchKind: 'vscodeLike'
  },
  {
    appNames: ['Windsurf'],
    cliPaths: homeDir => [
      '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf',
      join(homeDir, 'Applications/Windsurf.app/Contents/Resources/app/bin/windsurf')
    ],
    commands: ['windsurf'],
    id: 'windsurf',
    launchKind: 'vscodeLike'
  },
  { appNames: ['Zed'], commands: ['zed'], id: 'zed', launchKind: 'simpleFile' },
  { appNames: ['IntelliJ IDEA'], commands: ['idea'], id: 'intellij', launchKind: 'jetbrains' },
  { appNames: ['WebStorm'], commands: ['webstorm'], id: 'webstorm', launchKind: 'jetbrains' },
  { appNames: ['PyCharm'], commands: ['pycharm'], id: 'pycharm', launchKind: 'jetbrains' },
  { appNames: ['GoLand'], commands: ['goland'], id: 'goland', launchKind: 'jetbrains' },
  { appNames: ['TextEdit'], commands: [], id: 'textedit', launchKind: 'simpleFile' }
]

const filesystemFileOpenerIds = new Set(filesystemFileOpenerDescriptors.map(opener => opener.id))

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

const findCommand = async (command: string) => {
  const lookup = commandLookupTool()
  try {
    const result = await execFileAsync(lookup.command, [...lookup.args, command], {
      timeout: COMMAND_LOOKUP_TIMEOUT_MS,
      windowsHide: true
    })
    return String(result.stdout ?? '')
      .split(/\r?\n/)
      .map(item => item.trim())
      .find(Boolean)
  } catch {
    return undefined
  }
}

const resolveCliPath = async (descriptor: FilesystemFileOpenerDescriptor) => {
  for (const command of descriptor.commands) {
    const resolvedCommand = await findCommand(command)
    if (resolvedCommand != null) return resolvedCommand
  }

  const candidates = descriptor.cliPaths?.(homedir()) ?? []
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate
  }

  return undefined
}

const resolveMacAppName = async (descriptor: FilesystemFileOpenerDescriptor) => {
  if (platform() !== 'darwin') return undefined

  for (const appName of descriptor.appNames ?? []) {
    const candidates = [
      `/Applications/${appName}.app`,
      join(homedir(), 'Applications', `${appName}.app`),
      `/System/Applications/${appName}.app`
    ]
    for (const candidate of candidates) {
      if (await pathExists(candidate)) return appName
    }
  }

  return undefined
}

const resolveOpener = async (
  descriptor: FilesystemFileOpenerDescriptor
): Promise<ResolvedFilesystemFileOpener | undefined> => {
  const command = await resolveCliPath(descriptor)
  if (command != null) {
    return {
      command,
      id: descriptor.id,
      launchKind: descriptor.launchKind,
      source: 'path'
    }
  }

  const appName = await resolveMacAppName(descriptor)
  if (appName != null) {
    return {
      appName,
      id: descriptor.id,
      launchKind: descriptor.launchKind,
      source: 'macApp'
    }
  }

  return undefined
}

const normalizeRequestedOpener = (value: unknown): RequestedFilesystemFileOpener => {
  if (value == null || value === '' || value === 'auto') return 'auto'
  if (typeof value === 'string' && filesystemFileOpenerIds.has(value as FilesystemFileOpenerId)) {
    return value as FilesystemFileOpenerId
  }
  throw new TypeError('Unsupported filesystem file opener.')
}

const selectOpener = async (requestedOpener: RequestedFilesystemFileOpener) => {
  const resolvedOpeners = await Promise.all(filesystemFileOpenerDescriptors.map(resolveOpener))
  if (requestedOpener === 'auto') {
    return resolvedOpeners.find((opener): opener is ResolvedFilesystemFileOpener => opener != null)
  }

  return resolvedOpeners.find((opener): opener is ResolvedFilesystemFileOpener => (
    opener != null && opener.id === requestedOpener
  ))
}

const buildLaunchCommand = (filePath: string, opener: ResolvedFilesystemFileOpener) => {
  if (opener.source === 'path' && opener.command != null) {
    if (opener.launchKind === 'vscodeLike') {
      return {
        command: opener.command,
        args: ['--reuse-window', '--goto', filePath]
      }
    }
    return {
      command: opener.command,
      args: [filePath]
    }
  }

  if (opener.source === 'macApp' && opener.appName != null) {
    return {
      command: 'open',
      args: ['-a', opener.appName, filePath]
    }
  }

  return undefined
}

const openWithSystemDefault = async (filePath: string) => {
  const errorMessage = await shell.openPath(filePath)
  if (errorMessage !== '') {
    throw new Error(errorMessage)
  }
}

export const openFilesystemFileInExternalOpener = async (rawPath: string, opener?: unknown) => {
  const filePath = await resolveFilesystemFilePath(rawPath)
  const selectedOpener = await selectOpener(normalizeRequestedOpener(opener))
  const command = selectedOpener == null ? undefined : buildLaunchCommand(filePath, selectedOpener)
  if (command == null) {
    await openWithSystemDefault(filePath)
    return
  }

  const child = spawn(command.command, command.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
}
