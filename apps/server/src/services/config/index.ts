import { cwd as processCwd, env as processEnv } from 'node:process'

import {
  buildConfigJsonVariables as buildWorkspaceConfigJsonVariables,
  loadConfigState as loadWorkspaceConfigState
} from '@oneworks/config'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

export function getWorkspaceFolder() {
  const workspaceFolder = processEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  if (workspaceFolder != null && workspaceFolder.trim() !== '') {
    return workspaceFolder
  }

  if (processEnv.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager') {
    return resolveProjectHomePath(processCwd(), processEnv, 'workspace')
  }

  return processCwd()
}

export function buildConfigJsonVariables(
  workspaceFolder = getWorkspaceFolder(),
  env: NodeJS.ProcessEnv = processEnv
): Record<string, string | null | undefined> {
  return buildWorkspaceConfigJsonVariables(workspaceFolder, env)
}

export async function loadConfigState(
  workspaceFolder = getWorkspaceFolder(),
  env: NodeJS.ProcessEnv = processEnv
) {
  const {
    effectiveProjectConfig,
    globalConfig,
    projectConfig,
    userConfig,
    mergedConfig,
    globalSource,
    projectSource,
    userSource
  } = await loadWorkspaceConfigState({
    cwd: workspaceFolder,
    env,
    jsonVariables: buildConfigJsonVariables(workspaceFolder, env)
  })
  return {
    workspaceFolder,
    effectiveProjectConfig,
    globalConfig,
    projectConfig,
    userConfig,
    mergedConfig,
    globalSource,
    projectSource,
    userSource
  }
}

export function isAgentRoomExperimentEnabled(config: unknown) {
  if (config == null || typeof config !== 'object' || Array.isArray(config)) {
    return false
  }

  const experiments = (config as { experiments?: unknown }).experiments
  return experiments != null &&
    typeof experiments === 'object' &&
    !Array.isArray(experiments) &&
    (experiments as { agentRoom?: unknown }).agentRoom === true
}

export async function loadAgentRoomExperimentEnabled(workspaceFolder = getWorkspaceFolder()) {
  const { mergedConfig } = await loadConfigState(workspaceFolder)
  return isAgentRoomExperimentEnabled(mergedConfig)
}
