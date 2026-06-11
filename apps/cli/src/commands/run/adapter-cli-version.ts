import process from 'node:process'

import {
  buildConfigJsonVariables,
  buildConfigSections,
  loadConfigState,
  resolveConfigSectionPath,
  setConfigSectionValueAtPath,
  updateConfigFile,
  validateConfigSection
} from '@oneworks/config'

const normalizeAdapterEnvPrefix = (adapter: string) => (
  `__ONEWORKS_PROJECT_ADAPTER_${adapter.replace(/[^a-z0-9]+/giu, '_').toUpperCase()}`
)

const formatValidationIssues = (
  issues: Array<{
    path: Array<string | number>
    message: string
  }>
) =>
  issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '<root>'}: ${issue.message}`)
    .join('\n')

export const applyAdapterCliVersionEnv = (
  env: NodeJS.ProcessEnv,
  adapter: string,
  version: string
) => {
  env[`${normalizeAdapterEnvPrefix(adapter)}_INSTALL_VERSION__`] = version
}

export const persistAdapterCliVersionSelection = async (params: {
  adapter: string
  cwd: string
  env?: Record<string, string | null | undefined>
  version: string
}) => {
  const state = await loadConfigState({
    cwd: params.cwd,
    jsonVariables: buildConfigJsonVariables(params.cwd, params.env ?? process.env)
  })
  const path = resolveConfigSectionPath(['adapters', params.adapter, 'cli', 'version'])
  const updatedSections = setConfigSectionValueAtPath(
    buildConfigSections(state.userSource?.rawConfig),
    path,
    params.version
  )
  const parsed = await validateConfigSection('adapters', updatedSections.adapters, {
    cwd: params.cwd
  })

  if (!parsed.success) {
    throw new Error(`Invalid adapter CLI version config:\n${formatValidationIssues(parsed.error.issues)}`)
  }

  return await updateConfigFile({
    workspaceFolder: params.cwd,
    source: 'user',
    section: 'adapters',
    value: parsed.data
  })
}
