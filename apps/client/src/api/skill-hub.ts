import { createApiUrl, fetchApiJson } from './base'

export type SkillHubConfigSource = 'global' | 'project' | 'user'
export type SkillHubInstallTarget = 'global' | 'project'

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
  declaredSources: SkillHubConfigSource[]
  builtIn?: boolean
  installRef?: string
  source: string
}

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
  installFilter?: string
  limit?: number
  offset?: number
  registry?: string
  query?: string
  sort?: string
  source?: string
} = {}): Promise<SkillHubSearchResult> {
  const url = createApiUrl('/api/skill-hub/search')
  if (params.limit != null) {
    url.searchParams.set('limit', String(params.limit))
  }
  if (params.offset != null) {
    url.searchParams.set('offset', String(params.offset))
  }
  if (params.registry != null && params.registry !== '') {
    url.searchParams.set('registry', params.registry)
  }
  if (params.query != null && params.query !== '') {
    url.searchParams.set('q', params.query)
  }
  if (params.source != null && params.source !== '') {
    url.searchParams.set('source', params.source)
  }
  if (params.installFilter != null && params.installFilter !== '') {
    url.searchParams.set('install', params.installFilter)
  }
  if (params.sort != null && params.sort !== '') {
    url.searchParams.set('sort', params.sort)
  }
  return fetchApiJson<SkillHubSearchResult>(url)
}

export async function listSkillHubRegistries(): Promise<SkillHubRegistriesResult> {
  return fetchApiJson<SkillHubRegistriesResult>('/api/skill-hub/registries')
}

export async function installSkillHubItem(params: {
  registry: string
  skill: string
  target?: SkillHubInstallTarget
  force?: boolean
}): Promise<SkillHubInstallResult> {
  return fetchApiJson<SkillHubInstallResult>('/api/skill-hub/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
}
