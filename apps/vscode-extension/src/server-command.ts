import process from 'node:process'

import type * as vscode from 'vscode'

import { createSearchPath, findExecutable } from './path-search'
import { normalizeOptionalString } from './utils'

const BOOTSTRAP_COMMAND_CANDIDATES = ['oneworks', 'ow', 'owo']

export interface ResolvedBootstrapCommand {
  command: string
  shell: boolean
  source: string
}

const getConfiguredBootstrapCommand = () => (
  normalizeOptionalString(process.env.ONEWORKS_VSCODE_BOOTSTRAP_COMMAND)
)

export const resolveBootstrapCommand = (
  workspaceFolder: vscode.WorkspaceFolder,
  configuredCommand: string | undefined
): ResolvedBootstrapCommand | undefined => {
  const searchPaths = createSearchPath(workspaceFolder.uri.fsPath)
  if (configuredCommand != null) {
    const executable = findExecutable(configuredCommand, searchPaths)
    return {
      command: executable ?? configuredCommand,
      shell: executable == null,
      source: executable == null ? 'settings' : `settings:${executable}`
    }
  }

  const envCommand = getConfiguredBootstrapCommand()
  if (envCommand != null) {
    const executable = findExecutable(envCommand, searchPaths)
    return {
      command: executable ?? envCommand,
      shell: executable == null,
      source: executable == null ? 'env' : `env:${executable}`
    }
  }

  for (const candidate of BOOTSTRAP_COMMAND_CANDIDATES) {
    const executable = findExecutable(candidate, searchPaths)
    if (executable != null) {
      return {
        command: executable,
        shell: false,
        source: executable
      }
    }
  }

  return undefined
}

export const createMissingBootstrapCommandMessage = () => (
  [
    'One Works bootstrap command was not found.',
    '',
    'Install the One Works bootstrap launcher:',
    'pnpm add -D oneworks',
    '',
    'Or configure `oneworks.bootstrapCommand` with a `oneworks` executable or wrapper command.'
  ].join('\n')
)
