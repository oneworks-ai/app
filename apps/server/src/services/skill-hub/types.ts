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
  installRef?: string
  source: string
}

export interface SkillHubSearchResult {
  hasMore?: boolean
  registries: SkillHubRegistrySummary[]
  items: SkillHubItem[]
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
