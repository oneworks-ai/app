import { userInfo } from 'node:os'
import process from 'node:process'

import type { TerminalShellKind } from '@oneworks/types'

const TERMINAL_SHELL_KINDS = new Set<TerminalShellKind>([
  'default',
  'zsh',
  'bash',
  'sh',
  'powershell',
  'cmd'
])

export const normalizeTerminalShellKind = (value: string | null | undefined): TerminalShellKind => {
  return TERMINAL_SHELL_KINDS.has(value as TerminalShellKind) ? value as TerminalShellKind : 'default'
}

const normalizeShellPath = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed == null || trimmed === '' ? undefined : trimmed
}

const resolveUserLoginShell = () => {
  try {
    return normalizeShellPath(userInfo().shell)
  } catch {
    return undefined
  }
}

export const resolveDefaultPosixShell = () => {
  return normalizeShellPath(process.env.SHELL) ??
    resolveUserLoginShell() ??
    (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
}

export const resolveTerminalShell = (shellKind: TerminalShellKind = 'default') => {
  if (process.platform === 'win32') {
    switch (shellKind) {
      case 'cmd':
        return process.env.COMSPEC?.trim() || 'cmd.exe'
      case 'powershell':
      case 'default':
      case 'zsh':
      case 'bash':
      case 'sh':
        return process.env.COMSPEC?.trim() || 'powershell.exe'
    }
  }

  switch (shellKind) {
    case 'zsh':
      return 'zsh'
    case 'bash':
      return 'bash'
    case 'sh':
      return 'sh'
    case 'powershell':
      return 'pwsh'
    case 'cmd':
    case 'default':
      return resolveDefaultPosixShell()
  }
}
