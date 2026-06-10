import { createApiUrl, fetchApiJson } from './base'

export type SkillHubConfigSource = 'global' | 'project' | 'user'

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
  configSource: SkillHubConfigSource
  configLabel: string
  error?: string
}

export interface SkillHubItem {
  id: string
  registry: string
  registryName: string
  configSource: SkillHubConfigSource
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
  configSource: SkillHubConfigSource
  configLabel: string
  configPath: string
  source: string
  skill: string
  name: string
  installedAt: string
  installDir: string
}

export async function searchSkillHub(params: {
  limit?: number
  registry?: string
  query?: string
} = {}): Promise<SkillHubSearchResult> {
  const url = createApiUrl('/api/skill-hub/search')
  if (params.limit != null) {
    url.searchParams.set('limit', String(params.limit))
  }
  if (params.registry != null && params.registry !== '') {
    url.searchParams.set('registry', params.registry)
  }
  if (params.query != null && params.query !== '') {
    url.searchParams.set('q', params.query)
  }
  return fetchApiJson<SkillHubSearchResult>(url)
}

export async function installSkillHubItem(params: {
  registry: string
  skill: string
  force?: boolean
}): Promise<SkillHubInstallResult> {
  return fetchApiJson<SkillHubInstallResult>('/api/skill-hub/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
}
