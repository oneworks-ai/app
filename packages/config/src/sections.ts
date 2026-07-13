import type { Config } from '@oneworks/types'

export const CONFIG_SECTION_KEYS = [
  'general',
  'conversation',
  'models',
  'modelServices',
  'workspaces',
  'channels',
  'server',
  'adapters',
  'appearance',
  'desktop',
  'plugins',
  'mcp',
  'auth',
  'voice',
  'shortcuts',
  'experiments',
  'diagnostics'
] as const

export type ConfigSectionKey = typeof CONFIG_SECTION_KEYS[number]

export interface ConfigSections {
  general: {
    baseDir?: Config['baseDir']
    disableGlobalConfig?: Config['disableGlobalConfig']
    effort?: Config['effort']
    defaultAdapter?: Config['defaultAdapter']
    defaultModelService?: Config['defaultModelService']
    defaultModel?: Config['defaultModel']
    recommendedModels?: Config['recommendedModels']
    interfaceLanguage?: Config['interfaceLanguage']
    modelLanguage?: Config['modelLanguage']
    announcements?: Config['announcements']
    permissions?: Config['permissions']
    env?: Config['env']
    notifications?: Config['notifications']
    messageLinks?: Config['messageLinks']
    skills?: Config['skills']
    skillsMeta?: Config['skillsMeta']
    skillRegistries?: Config['skillRegistries']
    nativeHistoryImport?: Config['nativeHistoryImport']
    webAuth?: Config['webAuth']
    shortcuts?: Config['shortcuts']
  }
  conversation: Config['conversation']
  models: Config['models']
  modelServices: Config['modelServices']
  workspaces: Config['workspaces']
  channels: Config['channels']
  server: Config['server']
  adapters: Config['adapters']
  appearance: Config['appearance']
  desktop: Config['desktop']
  plugins: {
    plugins?: Config['plugins']
    marketplaces?: Config['marketplaces']
  }
  mcp: {
    mcpServers?: Config['mcpServers']
    defaultIncludeMcpServers?: Config['defaultIncludeMcpServers']
    defaultExcludeMcpServers?: Config['defaultExcludeMcpServers']
    noDefaultOneworksMcpServer?: Config['noDefaultOneworksMcpServer']
  }
  auth: Config['webAuth']
  voice: Config['voice']
  shortcuts: Config['shortcuts']
  experiments: Config['experiments']
  diagnostics: Config['diagnostics']
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value)
)

const buildAppearanceSection = (appearance: Config['appearance'] | undefined): Config['appearance'] | undefined => {
  if (appearance == null) return undefined
  return {
    ...(appearance.historyTimelineMode === undefined
      ? {}
      : { historyTimelineMode: appearance.historyTimelineMode }),
    ...(appearance.primaryColor === undefined ? {} : { primaryColor: appearance.primaryColor }),
    ...(appearance.themeMode === undefined ? {} : { themeMode: appearance.themeMode })
  }
}

export const buildConfigSections = (config: Config | undefined): ConfigSections => ({
  general: {
    baseDir: config?.baseDir,
    disableGlobalConfig: config?.disableGlobalConfig,
    effort: config?.effort,
    defaultAdapter: config?.defaultAdapter,
    defaultModelService: config?.defaultModelService,
    defaultModel: config?.defaultModel,
    recommendedModels: config?.recommendedModels,
    interfaceLanguage: config?.interfaceLanguage,
    modelLanguage: config?.modelLanguage,
    announcements: config?.announcements,
    permissions: config?.permissions,
    env: config?.env,
    notifications: config?.notifications,
    messageLinks: config?.messageLinks,
    skills: config?.skills,
    skillsMeta: config?.skillsMeta,
    skillRegistries: config?.skillRegistries,
    nativeHistoryImport: config?.nativeHistoryImport,
    webAuth: config?.webAuth,
    shortcuts: config?.shortcuts
  },
  conversation: config?.conversation,
  models: config?.models,
  modelServices: config?.modelServices,
  workspaces: config?.workspaces,
  channels: config?.channels,
  server: config?.server,
  adapters: config?.adapters,
  appearance: buildAppearanceSection(config?.appearance),
  desktop: config?.desktop,
  plugins: {
    plugins: config?.plugins,
    marketplaces: config?.marketplaces
  },
  mcp: {
    mcpServers: config?.mcpServers,
    defaultIncludeMcpServers: config?.defaultIncludeMcpServers,
    defaultExcludeMcpServers: config?.defaultExcludeMcpServers,
    noDefaultOneworksMcpServer: config?.noDefaultOneworksMcpServer
  },
  auth: config?.webAuth,
  voice: config?.voice,
  shortcuts: config?.shortcuts,
  experiments: config?.experiments,
  diagnostics: config?.diagnostics
})

export const hasConfigSectionValue = (value: unknown): boolean => {
  if (value === undefined) {
    return false
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (isRecord(value)) {
    return Object.values(value).some(item => hasConfigSectionValue(item))
  }

  return true
}
