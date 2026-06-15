import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, resolve } from 'node:path'
import process from 'node:process'

import type { AdapterConfigEntry, Config } from '@oneworks/types'
import {
  DEFAULT_GLOBAL_OO_CONFIG_FILE,
  PROJECT_WORKSPACE_FOLDER_ENV,
  resolveGlobalOneWorksDir,
  resolvePrimaryWorkspaceFolder,
  resolveProjectConfigDir,
  resolveProjectWorkspaceFolder
} from '@oneworks/utils'
import { load } from 'js-yaml'

import { mergeDefaultChannelSessionPermissions } from './default-channel-session-permissions'
import { mergeDefaultOneworksMcpPermissions } from './default-oneworks-mcp'
import { mergeConfigs } from './merge'
import { applyPluginConfigHooks } from './plugin-config'

export interface LoadConfigOptions {
  cwd?: string
  env?: Record<string, string | null | undefined>
  jsonVariables?: Record<string, string | null | undefined>
  /**
   * Disables workspace-local `.oo.dev.config.*`.
   */
  disableDevConfig?: boolean
  /**
   * Completely skips reading global `~/.oneworks/.oo.config.json`.
   */
  disableGlobalConfig?: boolean
}

export interface ConfigSourceState {
  rawConfig?: Config
  resolvedConfig?: Config
  configPath?: string
  extendPath?: string
  extendPaths: string[]
  resolvedExtendPaths: string[]
  resolvedExtendSources?: ConfigSourceState[]
}

export interface ResolvedConfigState {
  effectiveProjectConfig?: Config
  globalConfig?: Config
  /**
   * @deprecated Use `effectiveProjectConfig` for runtime reads, or
   * `projectSource?.rawConfig` when writing back to the project source.
   */
  projectConfig?: Config
  userConfig?: Config
  mergedConfig: Config
  globalSource?: ConfigSourceState
  projectSource?: ConfigSourceState
  userSource?: ConfigSourceState
}

export interface ResolveConfigStateOptions {
  configState?: ResolvedConfigState
  configs?: readonly [Config?, Config?]
}

type AdapterConfigRecord = object

export const ADAPTER_COMMON_CONFIG_KEYS = [
  'defaultModel',
  'includeModels',
  'excludeModels',
  'defaultAccount',
  'accounts'
] as const

const LEGACY_ADAPTER_COMMON_CONFIG_KEYS = ['model'] as const

export type AdapterCommonConfigKey = typeof ADAPTER_COMMON_CONFIG_KEYS[number]
type LegacyAdapterCommonConfigKey = typeof LEGACY_ADAPTER_COMMON_CONFIG_KEYS[number]
type ResolvedAdapterCommonKey<
  TEntry extends AdapterConfigRecord,
  TExtraCommonKey extends keyof TEntry,
> = Extract<keyof TEntry, AdapterCommonConfigKey | LegacyAdapterCommonConfigKey | TExtraCommonKey>

export interface SplitAdapterConfigEntryOptions<
  TEntry extends AdapterConfigRecord,
  TExtraCommonKey extends keyof TEntry = never,
> {
  extraCommonKeys?: readonly TExtraCommonKey[]
}

export interface ResolveAdapterConfigEntryOptions<
  TEntry extends AdapterConfigRecord,
  TExtraCommonKey extends keyof TEntry = never,
> extends SplitAdapterConfigEntryOptions<TEntry, TExtraCommonKey> {
  deepMergeKeys?: readonly (keyof TEntry)[]
}

export interface AdapterConfigResolverContribution<
  TEntry extends AdapterConfigRecord = AdapterConfigRecord,
  TExtraCommonKey extends keyof TEntry = never,
> {
  adapterKey: string
  configEntry?: ResolveAdapterConfigEntryOptions<TEntry, TExtraCommonKey>
}

export interface ResolvedAdapterConfig<
  TEntry extends AdapterConfigRecord = AdapterConfigEntry<AdapterConfigRecord>,
  TExtraCommonKey extends keyof TEntry = never,
> {
  entry: TEntry
  common: Pick<TEntry, ResolvedAdapterCommonKey<TEntry, TExtraCommonKey>>
  native: Omit<TEntry, ResolvedAdapterCommonKey<TEntry, TExtraCommonKey>>
}

export interface ResolveAdapterConfigOptions extends ResolveConfigStateOptions {
  mergedConfig?: Config
}

interface ConfigWithExtend {
  extend?: string | string[]
}

const CONFIG_FILE_EXTENSIONS = new Set([
  '.json',
  '.yaml',
  '.yml'
])

const PACKAGE_DEFAULT_CONFIG_FILES = [
  '.oo.config.json',
  '.oo.config.yaml',
  '.oo.config.yml'
]

export const GLOBAL_CONFIG_RELATIVE_PATHS = [
  DEFAULT_GLOBAL_OO_CONFIG_FILE
] as const

const PROJECT_CONFIG_PATHS = [
  './.oo.config.json',
  './infra/.oo.config.json',
  './.oo.config.yaml',
  './.oo.config.yml',
  './infra/.oo.config.yaml',
  './infra/.oo.config.yml'
]

const USER_CONFIG_PATHS = [
  './.oo.dev.config.json',
  './infra/.oo.dev.config.json',
  './.oo.dev.config.yaml',
  './.oo.dev.config.yml',
  './infra/.oo.dev.config.yaml',
  './infra/.oo.dev.config.yml'
]

export const DISABLE_DEV_CONFIG_ENV = '__ONEWORKS_PROJECT_DISABLE_DEV_CONFIG__'
export const DISABLE_GLOBAL_CONFIG_ENV = '__ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__'

const serializeJsonVariables = (value: Record<string, string | null | undefined>) => (
  JSON.stringify(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
  )
)

export const resolveGlobalConfigDir = (
  env: Record<string, string | null | undefined> = process.env
) => resolveGlobalOneWorksDir(env)

const resolveConfigCacheKey = (options: LoadConfigOptions) => {
  const launchCwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const workspaceFolder = resolveProjectWorkspaceFolder(launchCwd, env)
  const configCwd = resolveProjectConfigDir(launchCwd, env) ?? workspaceFolder
  const globalConfigCwd = resolveGlobalConfigDir(env) ?? ''
  const disableDevConfig = options.disableDevConfig === true || env[DISABLE_DEV_CONFIG_ENV] === '1' ? '1' : '0'
  const disableGlobalConfig = options.disableGlobalConfig === true || env[DISABLE_GLOBAL_CONFIG_ENV] === '1'
    ? '1'
    : '0'
  const jsonVariables = serializeJsonVariables(options.jsonVariables ?? {})
  return [
    launchCwd,
    workspaceFolder,
    configCwd,
    globalConfigCwd,
    disableDevConfig,
    disableGlobalConfig,
    jsonVariables
  ].join('\n')
}

const resolveConfigPath = (cwd: string, filePath: string) => resolve(cwd, filePath)

const isExistingFilePath = (filePath: string) => {
  if (!existsSync(filePath)) return false

  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

const replaceJsonVariables = (
  content: string,
  jsonVariables: Record<string, string | null | undefined>
) => (
  content.replace(/\$\{(\w+)\}/g, (_, key) => jsonVariables[key] ?? `$\{${key}}`)
)

export const buildConfigJsonVariables = (
  cwd: string,
  env: Record<string, string | null | undefined> = process.env
) => ({
  ...env,
  WORKSPACE_FOLDER: resolveProjectWorkspaceFolder(cwd, env),
  [PROJECT_WORKSPACE_FOLDER_ENV]: resolveProjectWorkspaceFolder(cwd, env)
})

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value)
)

const toAdapterConfigRecord = <TEntry extends AdapterConfigRecord>(value: unknown) => (
  isRecord(value) ? value as TEntry : {} as TEntry
)

const mergeNestedAdapterConfigValue = (
  left: unknown,
  right: unknown
): unknown => {
  if (!isRecord(left) || !isRecord(right)) {
    return right === undefined ? left : right
  }

  const keys = new Set([
    ...Object.keys(left),
    ...Object.keys(right)
  ])

  return Object.fromEntries(
    Array.from(keys).map(key => [
      key,
      mergeNestedAdapterConfigValue(left[key], right[key])
    ])
  )
}

const mergeAdapterConfigEntries = <TEntry extends AdapterConfigRecord>(
  left: TEntry | undefined,
  right: TEntry | undefined,
  deepMergeKeys: readonly (keyof TEntry)[] = []
) => {
  const leftRecord = toAdapterConfigRecord<TEntry>(left)
  const rightRecord = toAdapterConfigRecord<TEntry>(right)
  const mergedRecord = {
    ...leftRecord,
    ...rightRecord
  } as TEntry

  const mergedDeepMergeKeys = new Set<keyof TEntry>([
    ...deepMergeKeys,
    ...(('accounts' in leftRecord || 'accounts' in rightRecord) ? ['accounts' as keyof TEntry] : [])
  ])

  for (const key of mergedDeepMergeKeys) {
    mergedRecord[key] = mergeNestedAdapterConfigValue(leftRecord[key], rightRecord[key]) as TEntry[typeof key]
  }

  return mergedRecord
}

const toExtendPaths = (value: unknown) => {
  if (typeof value === 'string' && value.trim() !== '') {
    return [value.trim()]
  }

  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map(item => item.trim())
}

const omitExtendField = (value: Config) => {
  const { extend: _extend, ...rest } = value as Config & ConfigWithExtend
  return rest as Config
}

const resolveExtendCandidates = (configPath: string, extendPath: string) => {
  const resolvedPath = resolve(dirname(configPath), extendPath)
  if (extname(resolvedPath) !== '') return [resolvedPath]

  return [
    resolvedPath,
    `${resolvedPath}.json`,
    `${resolvedPath}.yaml`,
    `${resolvedPath}.yml`
  ]
}

const parsePackageSpecifier = (specifier: string) => {
  if (
    specifier.trim() === '' ||
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    /^[a-z]:[\\/]/i.test(specifier)
  ) {
    return undefined
  }

  const segments = specifier.split('/')
  if (segments.length === 0) return undefined

  if (specifier.startsWith('@')) {
    const [scope, name, ...rest] = segments
    if (!scope || !name) return undefined

    return {
      packageName: `${scope}/${name}`,
      subpath: rest.length > 0 ? rest.join('/') : undefined
    }
  }

  const [name, ...rest] = segments
  if (!name) return undefined

  return {
    packageName: name,
    subpath: rest.length > 0 ? rest.join('/') : undefined
  }
}

const resolveConfigCandidatesFromBasePath = (basePath: string) => (
  extname(basePath) !== ''
    ? [basePath]
    : [
      basePath,
      `${basePath}.json`,
      `${basePath}.yaml`,
      `${basePath}.yml`
    ]
)

const resolveDependencyExtendPath = (configPath: string, extendPath: string) => {
  const resolver = createRequire(configPath)

  try {
    const directResolvedPath = resolver.resolve(extendPath)
    if (
      isExistingFilePath(directResolvedPath) &&
      CONFIG_FILE_EXTENSIONS.has(extname(directResolvedPath).toLowerCase())
    ) {
      return directResolvedPath
    }
  } catch {}

  const parsed = parsePackageSpecifier(extendPath)
  if (parsed == null) return undefined

  try {
    const packageJsonPath = resolver.resolve(`${parsed.packageName}/package.json`)
    const packageRoot = dirname(packageJsonPath)

    if (parsed.subpath == null) {
      return PACKAGE_DEFAULT_CONFIG_FILES
        .map(fileName => resolve(packageRoot, fileName))
        .find(candidate => isExistingFilePath(candidate))
    }

    return resolveConfigCandidatesFromBasePath(resolve(packageRoot, parsed.subpath))
      .find(candidate => isExistingFilePath(candidate))
  } catch {
    return undefined
  }
}

const resolveExistingExtendPath = (configPath: string, extendPath: string) => (
  resolveExtendCandidates(configPath, extendPath)
    .find(candidate => isExistingFilePath(candidate)) ??
    resolveDependencyExtendPath(configPath, extendPath)
)

const readConfigFile = async (
  configPath: string,
  jsonVariables: Record<string, string | null | undefined>
) => {
  const configContent = await readFile(configPath, 'utf-8')
  const configResolvedContent = replaceJsonVariables(configContent, jsonVariables)
  const extension = extname(configPath).toLowerCase()

  if (extension === '.json') {
    return JSON.parse(configResolvedContent) as unknown
  }

  if (extension === '.yaml' || extension === '.yml') {
    return load(configResolvedContent) as unknown
  }

  throw new Error(`Unsupported config file extension "${extension || '<none>'}"`)
}

const loadResolvedConfigFileState = async (
  configPath: string,
  jsonVariables: Record<string, string | null | undefined>,
  loadingStack: Set<string>
): Promise<
  Required<
    Pick<
      ConfigSourceState,
      'rawConfig' | 'resolvedConfig' | 'extendPaths' | 'resolvedExtendPaths' | 'resolvedExtendSources'
    >
  >
> => {
  if (loadingStack.has(configPath)) {
    throw new Error(`Circular config extend detected: ${
      [
        ...loadingStack,
        configPath
      ].join(' -> ')
    }`)
  }

  const rawConfig = await readConfigFile(
    configPath,
    jsonVariables
  ) as Config & ConfigWithExtend

  if (!isRecord(rawConfig)) {
    throw new Error(`Config file "${configPath}" must resolve to an object`)
  }

  const nextLoadingStack = new Set(loadingStack)
  nextLoadingStack.add(configPath)

  let mergedExtendedConfig: Config | undefined
  const resolvedExtendPaths: string[] = []
  const resolvedExtendSources: ConfigSourceState[] = []
  const appendResolvedExtendSource = (source: ConfigSourceState) => {
    if (source.configPath != null && resolvedExtendSources.some(entry => entry.configPath === source.configPath)) {
      return
    }
    resolvedExtendSources.push(source)
  }

  for (const extendPath of toExtendPaths(rawConfig.extend)) {
    const extendedConfigPath = resolveExistingExtendPath(configPath, extendPath)
    if (extendedConfigPath == null) {
      throw new Error(`Extended config "${extendPath}" not found from "${configPath}"`)
    }

    const extendedConfig = await loadResolvedConfigFileState(
      extendedConfigPath,
      jsonVariables,
      nextLoadingStack
    )
    mergedExtendedConfig = mergeConfigs(mergedExtendedConfig, extendedConfig.resolvedConfig)
    appendResolvedExtendSource({
      ...extendedConfig,
      configPath: extendedConfigPath,
      extendPath
    })
    for (const nestedExtendSource of extendedConfig.resolvedExtendSources) {
      appendResolvedExtendSource(nestedExtendSource)
    }
    if (!resolvedExtendPaths.includes(extendedConfigPath)) {
      resolvedExtendPaths.push(extendedConfigPath)
    }
    for (const nestedExtendPath of extendedConfig.resolvedExtendPaths) {
      if (!resolvedExtendPaths.includes(nestedExtendPath)) {
        resolvedExtendPaths.push(nestedExtendPath)
      }
    }
  }

  const rawEntryConfig = omitExtendField(rawConfig)

  return {
    rawConfig: rawEntryConfig,
    resolvedConfig: mergeConfigs(
      mergedExtendedConfig,
      rawEntryConfig
    ) ?? rawEntryConfig,
    extendPaths: toExtendPaths(rawConfig.extend),
    resolvedExtendPaths,
    resolvedExtendSources
  }
}

const loadResolvedConfigFile = async (
  configPath: string,
  jsonVariables: Record<string, string | null | undefined>,
  loadingStack: Set<string>
): Promise<Config> => (
  (await loadResolvedConfigFileState(configPath, jsonVariables, loadingStack)).resolvedConfig
)

const loadConfigSourceFromPaths = async (
  cwd: string,
  paths: string[],
  jsonVariables: Record<string, string | null | undefined>
): Promise<ConfigSourceState | undefined> => {
  for (const path of paths) {
    try {
      const configPath = resolveConfigPath(cwd, path)
      if (!isExistingFilePath(configPath)) {
        continue
      }

      const sourceState = await loadResolvedConfigFileState(
        configPath,
        jsonVariables,
        new Set()
      )
      return {
        ...sourceState,
        configPath
      }
    } catch (e) {
      console.error(`Failed to load config file ${path}: ${e}`)
    }
  }
}

const configCache = new Map<
  string,
  Promise<
    readonly [
      ConfigSourceState | undefined,
      ConfigSourceState | undefined,
      ConfigSourceState | undefined
    ]
  >
>()

const getExplicitDisableGlobalConfig = (config: Config | undefined) => (
  typeof config?.disableGlobalConfig === 'boolean' ? config.disableGlobalConfig : undefined
)

export const resolveDisableGlobalConfig = ({
  globalConfig,
  projectConfig,
  userConfig
}: {
  globalConfig?: Config
  projectConfig?: Config
  userConfig?: Config
}) => {
  let disabled = false
  for (const config of [globalConfig, projectConfig, userConfig]) {
    const nextDisabled = getExplicitDisableGlobalConfig(config)
    if (nextDisabled != null) disabled = nextDisabled
  }
  return disabled
}

const resolveApplicableGlobalConfig = (
  globalSource: ConfigSourceState | undefined,
  projectSource: ConfigSourceState | undefined,
  userSource: ConfigSourceState | undefined
) => {
  const disabled = resolveDisableGlobalConfig({
    globalConfig: globalSource?.resolvedConfig,
    projectConfig: projectSource?.resolvedConfig,
    userConfig: userSource?.resolvedConfig
  })
  return disabled ? undefined : globalSource?.resolvedConfig
}

export const resetConfigCache = (cwd?: string) => {
  if (cwd == null) {
    configCache.clear()
    return
  }

  for (const key of configCache.keys()) {
    if (key.startsWith(`${cwd}\n`)) {
      configCache.delete(key)
    }
  }
}

export const loadConfig = (options: LoadConfigOptions = {}) => {
  return (async () => {
    const { effectiveProjectConfig: projectConfig, userConfig } = await loadEffectiveConfigPair(options)
    return [projectConfig, userConfig] as const
  })()
}

const resolvePluginConfigCwd = (options: LoadConfigOptions) => (
  resolveProjectWorkspaceFolder(options.cwd ?? process.cwd(), options.env ?? process.env)
)

const loadEffectiveConfigPair = async (options: LoadConfigOptions = {}) => {
  const [projectSource, userSource, globalSource] = await loadConfigSources(options)
  const globalConfig = resolveApplicableGlobalConfig(globalSource, projectSource, userSource)
  const effectiveProjectConfig = resolveLayeredProjectConfig(
    globalConfig,
    projectSource?.resolvedConfig
  )
  const [hookedProjectConfig, hookedUserConfig] = await applyPluginConfigHooks({
    cwd: resolvePluginConfigCwd(options),
    env: options.env ?? process.env,
    jsonVariables: options.jsonVariables ?? {},
    projectConfig: effectiveProjectConfig,
    userConfig: userSource?.resolvedConfig
  })
  const [effectiveProjectConfigWithDefaults, userConfig] = mergeDefaultOneworksMcpPermissions({
    projectConfig: hookedProjectConfig,
    userConfig: hookedUserConfig
  })
  return {
    effectiveProjectConfig: effectiveProjectConfigWithDefaults,
    globalConfig,
    globalSource,
    projectSource,
    userConfig,
    userSource
  }
}

export const loadConfigSources = (options: LoadConfigOptions = {}) => {
  const cacheKey = resolveConfigCacheKey(options)
  const cachedConfig = configCache.get(cacheKey)
  if (cachedConfig != null) {
    return cachedConfig
  }

  const launchCwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const workspaceFolder = resolveProjectWorkspaceFolder(launchCwd, env)
  const configCwd = resolveProjectConfigDir(launchCwd, env) ?? workspaceFolder
  const shouldLoadDevConfig = options.disableDevConfig !== true &&
    env[DISABLE_DEV_CONFIG_ENV] !== '1'
  const shouldLoadGlobalConfig = options.disableGlobalConfig !== true &&
    env[DISABLE_GLOBAL_CONFIG_ENV] !== '1'
  const jsonVariables = options.jsonVariables ?? {}

  const nextConfig = (async () => {
    const projectSource = await loadConfigSourceFromPaths(
      configCwd,
      PROJECT_CONFIG_PATHS,
      jsonVariables
    )

    let globalSource: ConfigSourceState | undefined
    let userSource: ConfigSourceState | undefined
    if (shouldLoadGlobalConfig) {
      const globalConfigCwd = resolveGlobalConfigDir(env)
      if (globalConfigCwd != null) {
        globalSource = await loadConfigSourceFromPaths(
          globalConfigCwd,
          [...GLOBAL_CONFIG_RELATIVE_PATHS],
          jsonVariables
        )
      }
    }

    if (shouldLoadDevConfig) {
      userSource = await loadConfigSourceFromPaths(
        configCwd,
        USER_CONFIG_PATHS,
        jsonVariables
      )
      if (userSource == null) {
        const primaryWorkspaceFolder = resolvePrimaryWorkspaceFolder(workspaceFolder, env)
        if (primaryWorkspaceFolder != null) {
          userSource = await loadConfigSourceFromPaths(
            primaryWorkspaceFolder,
            USER_CONFIG_PATHS,
            jsonVariables
          )
        }
      }
    }

    return [projectSource, userSource, globalSource] as const
  })()
  configCache.set(cacheKey, nextConfig)
  return nextConfig
}

export const resolveLayeredProjectConfig = (
  globalConfig?: Config,
  projectConfig?: Config
): Config | undefined => (
  globalConfig == null && projectConfig == null
    ? undefined
    : mergeConfigs(globalConfig, projectConfig)
)

export const resolveMergedConfig = (
  projectConfig?: Config,
  userConfig?: Config
): Config => mergeConfigs(projectConfig, userConfig) ?? {}

export const buildResolvedConfigState = (
  effectiveProjectConfig?: Config,
  userConfig?: Config,
  projectSource?: ConfigSourceState,
  userSource?: ConfigSourceState,
  globalConfig?: Config,
  globalSource?: ConfigSourceState
): ResolvedConfigState => ({
  effectiveProjectConfig,
  globalConfig,
  projectConfig: effectiveProjectConfig,
  userConfig,
  mergedConfig: resolveMergedConfig(effectiveProjectConfig, userConfig),
  globalSource,
  projectSource,
  userSource
})

export const resolveConfigState = (
  options: ResolveConfigStateOptions = {}
): ResolvedConfigState => (
  options.configState ?? buildResolvedConfigState(options.configs?.[0], options.configs?.[1])
)

export const loadConfigState = async (
  options: LoadConfigOptions = {}
): Promise<ResolvedConfigState> => {
  const {
    effectiveProjectConfig: effectiveProjectConfigWithDefaults,
    globalConfig,
    globalSource,
    projectSource,
    userConfig,
    userSource
  } = await loadEffectiveConfigPair(options)
  const [effectiveProjectConfigWithRuntimeDefaults, userConfigWithRuntimeDefaults] =
    mergeDefaultChannelSessionPermissions({
      env: options.env ?? process.env,
      projectConfig: effectiveProjectConfigWithDefaults,
      userConfig
    })
  return buildResolvedConfigState(
    effectiveProjectConfigWithRuntimeDefaults,
    userConfigWithRuntimeDefaults,
    projectSource,
    userSource,
    globalConfig,
    globalSource
  )
}

export const resolveAdapterConfigEntry = (
  name: string,
  mergedConfig?: Config
): Record<string, unknown> => {
  const adapters = mergedConfig?.adapters as Record<string, unknown> | undefined
  return isRecord(adapters?.[name]) ? adapters[name] : {}
}

export const splitAdapterConfigEntry = <
  TEntry extends AdapterConfigRecord,
  TExtraCommonKey extends keyof TEntry = never,
>(
  entry: TEntry | undefined,
  options: SplitAdapterConfigEntryOptions<TEntry, TExtraCommonKey> = {}
): ResolvedAdapterConfig<TEntry, TExtraCommonKey> => {
  const resolvedEntry = toAdapterConfigRecord<TEntry>(entry)
  const commonKeys = new Set<string>([
    ...ADAPTER_COMMON_CONFIG_KEYS,
    ...LEGACY_ADAPTER_COMMON_CONFIG_KEYS,
    ...(options.extraCommonKeys ?? []).map(String)
  ])
  const commonEntries: Array<[string, unknown]> = []
  const nativeEntries: Array<[string, unknown]> = []

  for (const [key, value] of Object.entries(resolvedEntry)) {
    if (commonKeys.has(key)) {
      commonEntries.push([key, value])
      continue
    }
    nativeEntries.push([key, value])
  }

  return {
    entry: resolvedEntry,
    common: Object.fromEntries(commonEntries) as Pick<TEntry, ResolvedAdapterCommonKey<TEntry, TExtraCommonKey>>,
    native: Object.fromEntries(nativeEntries) as Omit<TEntry, ResolvedAdapterCommonKey<TEntry, TExtraCommonKey>>
  }
}

export const resolveAdapterConfig = <
  TEntry extends AdapterConfigRecord,
  TExtraCommonKey extends keyof TEntry = never,
>(
  name: string,
  options: ResolveAdapterConfigOptions = {},
  resolveOptions: ResolveAdapterConfigEntryOptions<TEntry, TExtraCommonKey> = {}
): ResolvedAdapterConfig<TEntry, TExtraCommonKey> => {
  const resolvedState = options.configState ?? (
    options.mergedConfig == null
      ? resolveConfigState({
        configs: options.configs
      })
      : undefined
  )
  const mergedConfig = options.mergedConfig ?? resolvedState?.mergedConfig
  const resolvedEntry = resolvedState != null
    ? (() => {
      const projectEntry = resolveAdapterConfigEntry(
        name,
        resolvedState.effectiveProjectConfig ?? resolvedState.projectConfig
      ) as TEntry
      const userEntry = resolveAdapterConfigEntry(name, resolvedState.userConfig) as TEntry
      if (
        Object.keys(projectEntry).length === 0 &&
        Object.keys(userEntry).length === 0 &&
        mergedConfig != null
      ) {
        return resolveAdapterConfigEntry(name, mergedConfig) as TEntry
      }
      return mergeAdapterConfigEntries(
        projectEntry,
        userEntry,
        resolveOptions.deepMergeKeys
      )
    })()
    : options.configs != null
    ? mergeAdapterConfigEntries(
      resolveAdapterConfigEntry(name, options.configs[0]) as TEntry,
      resolveAdapterConfigEntry(name, options.configs[1]) as TEntry,
      resolveOptions.deepMergeKeys
    )
    : resolveAdapterConfigEntry(name, mergedConfig) as TEntry

  return splitAdapterConfigEntry(
    resolvedEntry,
    resolveOptions
  )
}

export const resolveAdapterConfigWithContribution = <
  TEntry extends AdapterConfigRecord,
  TExtraCommonKey extends keyof TEntry = never,
>(
  contribution: AdapterConfigResolverContribution<TEntry, TExtraCommonKey>,
  options: ResolveAdapterConfigOptions = {}
) =>
  resolveAdapterConfig<TEntry, TExtraCommonKey>(
    contribution.adapterKey,
    options,
    contribution.configEntry
  )

export const resolveAdapterCommonConfig = <
  TEntry extends AdapterConfigRecord,
  TExtraCommonKey extends keyof TEntry = never,
>(
  name: string,
  options: ResolveAdapterConfigOptions = {},
  resolveOptions: ResolveAdapterConfigEntryOptions<TEntry, TExtraCommonKey> = {}
) =>
  resolveAdapterConfig<TEntry, TExtraCommonKey>(
    name,
    options,
    resolveOptions
  ).common

export const resolveAdapterCommonConfigWithContribution = <
  TEntry extends AdapterConfigRecord,
  TExtraCommonKey extends keyof TEntry = never,
>(
  contribution: AdapterConfigResolverContribution<TEntry, TExtraCommonKey>,
  options: ResolveAdapterConfigOptions = {}
) =>
  resolveAdapterConfigWithContribution<TEntry, TExtraCommonKey>(
    contribution,
    options
  ).common

export const loadAdapterConfig = async (
  name: string,
  options: LoadConfigOptions = {}
) => {
  const { mergedConfig } = await loadConfigState(options)
  return resolveAdapterConfigEntry(name, mergedConfig)
}
