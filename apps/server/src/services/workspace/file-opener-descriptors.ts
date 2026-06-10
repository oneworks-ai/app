import { join } from 'node:path'

import type { WorkspaceFileOpenerId, WorkspaceFileOpenerInfo } from '@oneworks/types'

export interface FileOpenerDescriptor {
  appNames?: string[]
  cliPaths?: (homeDir: string) => string[]
  commands: string[]
  id: WorkspaceFileOpenerId
  launchKind: 'vscodeLike' | 'jetbrains' | 'simpleFile'
  title: string
  uriScheme?: string
}

export interface ResolvedFileOpener extends WorkspaceFileOpenerInfo {
  appName?: string
  command?: string
  launchKind: FileOpenerDescriptor['launchKind']
  uriScheme?: string
}

export const FILE_OPENER_DESCRIPTORS: FileOpenerDescriptor[] = [
  {
    id: 'vscode',
    title: 'Visual Studio Code',
    commands: ['code'],
    uriScheme: 'vscode',
    launchKind: 'vscodeLike',
    appNames: ['Visual Studio Code'],
    cliPaths: homeDir => [
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      join(homeDir, 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code')
    ]
  },
  {
    id: 'cursor',
    title: 'Cursor',
    commands: ['cursor'],
    uriScheme: 'cursor',
    launchKind: 'vscodeLike',
    appNames: ['Cursor'],
    cliPaths: homeDir => [
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
      join(homeDir, 'Applications/Cursor.app/Contents/Resources/app/bin/cursor')
    ]
  },
  {
    id: 'windsurf',
    title: 'Windsurf',
    commands: ['windsurf'],
    uriScheme: 'windsurf',
    launchKind: 'vscodeLike',
    appNames: ['Windsurf'],
    cliPaths: homeDir => [
      '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf',
      join(homeDir, 'Applications/Windsurf.app/Contents/Resources/app/bin/windsurf')
    ]
  },
  {
    id: 'zed',
    title: 'Zed',
    commands: ['zed'],
    launchKind: 'simpleFile',
    appNames: ['Zed']
  },
  {
    id: 'intellij',
    title: 'IntelliJ IDEA',
    commands: ['idea'],
    launchKind: 'jetbrains',
    appNames: ['IntelliJ IDEA']
  },
  {
    id: 'webstorm',
    title: 'WebStorm',
    commands: ['webstorm'],
    launchKind: 'jetbrains',
    appNames: ['WebStorm']
  },
  {
    id: 'pycharm',
    title: 'PyCharm',
    commands: ['pycharm'],
    launchKind: 'jetbrains',
    appNames: ['PyCharm']
  },
  {
    id: 'goland',
    title: 'GoLand',
    commands: ['goland'],
    launchKind: 'jetbrains',
    appNames: ['GoLand']
  },
  {
    id: 'textedit',
    title: 'TextEdit',
    commands: [],
    launchKind: 'simpleFile',
    appNames: ['TextEdit']
  }
]

export const FILE_OPENER_IDS = new Set(FILE_OPENER_DESCRIPTORS.map(opener => opener.id))
