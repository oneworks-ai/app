import process from 'node:process'

import {
  buildConfigJsonVariables,
  buildConfigSections,
  formatConfigValueAsYaml,
  loadConfigState,
  resolveConfigSectionWriteError
} from '@oneworks/config'
import type { ConfigSectionKey } from '@oneworks/config'
import type { Config, ConfigSource } from '@oneworks/types'

export type ConfigReadSource = ConfigSource | 'merged'
export type ConfigListSource = ConfigReadSource | 'all'

export const CONFIG_READ_SOURCES = ['global', 'project', 'user', 'merged'] as const
export const CONFIG_SET_SOURCES = ['global', 'project', 'user'] as const
export const CONFIG_LIST_SOURCES = ['all', ...CONFIG_READ_SOURCES] as const
export const CONFIG_VALUE_TYPES = ['auto', 'string', 'json', 'number', 'boolean', 'null'] as const

export type ConfigValueType = typeof CONFIG_VALUE_TYPES[number]

export interface ConfigListOptions {
  json?: boolean
  source?: ConfigListSource
}

export interface ConfigGetOptions {
  json?: boolean
  source?: ConfigReadSource
}

export interface ConfigSetOptions {
  json?: boolean
  source?: ConfigSource
  type?: ConfigValueType
}

export interface ConfigUnsetOptions {
  json?: boolean
  source?: ConfigSource
}

export interface LoadedConfigCommandState {
  workspaceFolder: string
  effectiveProjectConfig?: Config
  globalConfig?: Config
  globalSourceConfig?: Config
  projectSourceConfig?: Config
  projectConfig?: Config
  userSourceConfig?: Config
  userConfig?: Config
  mergedConfig: Config
  sections: {
    global: ReturnType<typeof buildConfigSections>
    project: ReturnType<typeof buildConfigSections>
    user: ReturnType<typeof buildConfigSections>
    merged: ReturnType<typeof buildConfigSections>
  }
  present: Record<ConfigReadSource, boolean>
}

export const isInteractiveTerminal = () => process.stdin.isTTY && process.stdout.isTTY

export const formatDisplayValue = (value: unknown) => formatConfigValueAsYaml(value)

export const formatErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const printJsonResult = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

export const loadCommandState = async (cwd: string): Promise<LoadedConfigCommandState> => {
  const configState = await loadConfigState({
    cwd,
    jsonVariables: buildConfigJsonVariables(cwd, process.env)
  })
  const globalSourceConfig = configState.globalSource?.rawConfig
  const projectSourceConfig = configState.projectSource?.rawConfig
  const userSourceConfig = configState.userSource?.rawConfig

  return {
    workspaceFolder: cwd,
    globalSourceConfig,
    projectSourceConfig,
    userSourceConfig,
    ...configState,
    sections: {
      global: buildConfigSections(globalSourceConfig),
      project: buildConfigSections(projectSourceConfig),
      user: buildConfigSections(userSourceConfig),
      merged: buildConfigSections(configState.mergedConfig)
    },
    present: {
      global: configState.globalSource?.configPath != null,
      project: configState.projectSource?.configPath != null,
      user: configState.userSource?.configPath != null,
      merged: true
    }
  }
}

export const resolveSourceConfig = (
  state: LoadedConfigCommandState,
  source: ConfigReadSource
) => {
  switch (source) {
    case 'global':
      return state.globalSourceConfig
    case 'project':
      return state.projectSourceConfig
    case 'user':
      return state.userSourceConfig
    case 'merged':
      return state.mergedConfig
  }
}

export const resolveSourceSections = (
  state: LoadedConfigCommandState,
  source: ConfigReadSource
) => state.sections[source]

export const assertWritableConfigSection = (source: ConfigSource, section: ConfigSectionKey) => {
  const writeError = resolveConfigSectionWriteError(source, section)
  if (writeError != null) {
    throw new Error(writeError)
  }
}

export const parseConfigValueInput = (
  rawValue: string | undefined,
  type: ConfigValueType
): unknown => {
  if (type === 'null') {
    return null
  }

  if (rawValue == null) {
    throw new TypeError('A config value is required.')
  }

  if (type === 'string') {
    return rawValue
  }

  const trimmed = rawValue.trim()

  if (type === 'json') {
    return JSON.parse(trimmed)
  }

  if (type === 'number') {
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      throw new TypeError(`Invalid number value "${rawValue}".`)
    }
    return parsed
  }

  if (type === 'boolean') {
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
    throw new TypeError(`Invalid boolean value "${rawValue}". Expected true or false.`)
  }

  if (trimmed === '') {
    return ''
  }

  const looksLikeJsonLiteral = trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('"') ||
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    /^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(trimmed)

  return looksLikeJsonLiteral ? JSON.parse(trimmed) : rawValue
}

export const formatValidationIssues = (
  error: {
    issues: Array<{
      path: Array<string | number>
      message: string
    }>
  }
) =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>'
      return `${path}: ${issue.message}`
    })
    .join('\n')
