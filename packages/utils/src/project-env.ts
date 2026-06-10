import { resolve } from 'node:path'
import process from 'node:process'

import {
  PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV,
  PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV,
  PROJECT_WORKSPACE_FOLDER_ENV,
  PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV
} from './ai-path'

const normalizeDirPath = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  if (trimmed == null || trimmed === '') return undefined
  return trimmed.replace(/[\\/]+$/, '')
}

export const mergeProcessEnvWithProjectEnv = (
  env: Record<string, string | null | undefined> | undefined,
  options: {
    workspaceFolder?: string
  } = {}
): NodeJS.ProcessEnv => {
  const hasProvidedKey = (key: string) => Object.prototype.hasOwnProperty.call(env ?? {}, key)
  const hasExplicitProjectValue = (key: string) => hasProvidedKey(key) && env?.[key] !== process.env[key]
  const nextEnv = { ...process.env }
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value == null) {
      delete nextEnv[key]
      continue
    }
    nextEnv[key] = value
  }

  const inheritedWorkspaceFolder = normalizeDirPath(process.env[PROJECT_WORKSPACE_FOLDER_ENV])
  const explicitWorkspaceFolder = hasExplicitProjectValue(PROJECT_WORKSPACE_FOLDER_ENV)
    ? normalizeDirPath(env?.[PROJECT_WORKSPACE_FOLDER_ENV])
    : undefined
  const optionWorkspaceFolder = normalizeDirPath(options.workspaceFolder)
  const targetWorkspaceFolder = explicitWorkspaceFolder ??
    optionWorkspaceFolder ??
    normalizeDirPath(nextEnv[PROJECT_WORKSPACE_FOLDER_ENV])
  if (explicitWorkspaceFolder == null && optionWorkspaceFolder != null) {
    nextEnv[PROJECT_WORKSPACE_FOLDER_ENV] = resolve(optionWorkspaceFolder)
    nextEnv[PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV] = resolve(optionWorkspaceFolder)
  }

  if (
    inheritedWorkspaceFolder != null &&
    targetWorkspaceFolder != null &&
    resolve(inheritedWorkspaceFolder) !== resolve(targetWorkspaceFolder)
  ) {
    if (!hasExplicitProjectValue(PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV)) {
      delete nextEnv[PROJECT_PRIMARY_WORKSPACE_FOLDER_ENV]
    }
    if (!hasExplicitProjectValue(PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV)) {
      delete nextEnv[PROJECT_ONEWORKS_HOME_PROJECT_DIR_ENV]
    }
  }

  return nextEnv
}
