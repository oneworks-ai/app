import type { ConfigSource } from '@oneworks/config'

export interface SkillHubRegistrySummary {
  id: string
  name: string
  type: 'skills-cli'
  enabled: boolean
  searchable: boolean
  source: string
  registry?: string
  title?: string
  description?: string
  builtIn?: boolean
  configSource: ConfigSource
  configLabel: string
  error?: string
}

export interface SkillHubItem {
  id: string
  registry: string
  registryName: string
  configSource: ConfigSource
  configLabel: string
  name: string
  description?: string
  skills: string[]
  commands: string[]
  agents: string[]
  mcpServers: string[]
  hasHooks: boolean
  installed: boolean
  declared: boolean
  declaredSources: ConfigSource[]
  builtIn?: boolean
  installRef?: string
  source: string
}

export type SkillHubInstallTarget = Extract<ConfigSource, 'global' | 'project'>

export interface SkillHubSearchResult {
  hasMore?: boolean
  registries: SkillHubRegistrySummary[]
  items: SkillHubItem[]
  sources: string[]
  total: number
}

export interface SkillHubRegistriesResult {
  registries: SkillHubRegistrySummary[]
}

export interface SkillHubInstallResult {
  registry: string
  registryName: string
  configSource: ConfigSource
  configLabel: string
  configPath: string
  source: string
  skill: string
  name: string
  installedAt: string
  installDir: string
}
