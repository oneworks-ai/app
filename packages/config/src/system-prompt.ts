import process from 'node:process'

import type { Config } from '@oneworks/types'

import { buildConfigJsonVariables, loadConfig } from './load'

export const resolveInjectDefaultSystemPromptValue = (options: {
  cliValue?: boolean
  projectConfig?: Config
  userConfig?: Config
}) => (
  options.cliValue ??
    options.userConfig?.conversation?.injectDefaultSystemPrompt ??
    options.projectConfig?.conversation?.injectDefaultSystemPrompt ??
    true
)

export async function loadInjectDefaultSystemPromptValue(
  cwd: string,
  cliValue?: boolean,
  env: Record<string, string | null | undefined> = process.env
) {
  if (cliValue != null) return cliValue

  const [projectConfig, userConfig] = await loadConfig({
    cwd,
    env,
    jsonVariables: buildConfigJsonVariables(cwd, env)
  })

  return resolveInjectDefaultSystemPromptValue({
    projectConfig,
    userConfig
  })
}

export const mergeSystemPrompts = (options: {
  generatedSystemPrompt?: string
  userSystemPrompt?: string
  injectDefaultSystemPrompt?: boolean
}) => {
  const value = [
    options.injectDefaultSystemPrompt === false ? undefined : options.generatedSystemPrompt,
    options.userSystemPrompt
  ]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join('\n\n')

  return value === '' ? undefined : value
}
