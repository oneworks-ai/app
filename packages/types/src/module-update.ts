export const moduleUpdateChannels = ['stable', 'rc', 'beta', 'alpha'] as const

export type ModuleUpdateChannel = typeof moduleUpdateChannels[number]

export type ModuleUpdateGroup = 'adapter' | 'core' | 'plugin'

export type ModuleUpdateKind = 'adapter' | 'client' | 'plugin' | 'runtime' | 'server'

export type ModuleUpdateActivation = 'new-session' | 'restart'

export interface ModuleUpdateChannelSettings {
  defaultChannel: ModuleUpdateChannel
  moduleChannels: Record<string, ModuleUpdateChannel>
}

export interface ModuleUpdateChangelogEntry {
  body: string
  path?: string
  version: string
}

export interface ModuleUpdateChangelog {
  entries: ModuleUpdateChangelogEntry[]
  fromVersion?: string
  toVersion?: string
}

export interface ModuleUpdateItem {
  activation: ModuleUpdateActivation
  cachedVersion?: string
  channel: ModuleUpdateChannel
  changelog?: ModuleUpdateChangelog
  configuredChannel?: ModuleUpdateChannel
  currentVersion?: string
  errorMessage?: string
  group: ModuleUpdateGroup
  id: string
  kind: ModuleUpdateKind
  label: string
  latestVersion?: string
  needsActivation: boolean
  npmTag: string
  packageName: string
  updateAvailable: boolean
}

export interface ModuleUpdatesResponse {
  checkedAt: string
  channel: ModuleUpdateChannel
  moduleChannels: Record<string, ModuleUpdateChannel>
  modules: ModuleUpdateItem[]
  npmTag: string
}

export interface ModuleUpdateInstallRequest {
  version?: string
}

export interface ModuleUpdateInstallResponse {
  checkedAt: string
  channel: ModuleUpdateChannel
  module: ModuleUpdateItem
  moduleChannels: Record<string, ModuleUpdateChannel>
  npmTag: string
}

export interface ModuleUpdateSettingsPatch {
  defaultChannel?: ModuleUpdateChannel
  moduleChannels?: Record<string, ModuleUpdateChannel | null>
}

export const isModuleUpdateChannel = (value: unknown): value is ModuleUpdateChannel => (
  typeof value === 'string' && moduleUpdateChannels.includes(value as ModuleUpdateChannel)
)

export const normalizeModuleUpdateChannel = (value: unknown): ModuleUpdateChannel => (
  isModuleUpdateChannel(value) ? value : 'stable'
)
