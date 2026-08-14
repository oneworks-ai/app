/* eslint-disable max-lines -- Knowledge asset summaries, mutations, and detail clients share one public API module. */
import type { EntityRuntimeDetail, MutationCommitState } from '@oneworks/types'

import {
  AssetCreateCommitIndeterminateError,
  isAssetCreatePendingResponse,
  normalizeAssetCreateFailure,
  pollAssetCreateOperation
} from './asset-create-commit'
import { createApiUrl, fetchApiJson, fetchApiJsonWithStatus } from './base'

export { AssetCreateCommitIndeterminateError, isAssetCreateCommitIndeterminateError } from './asset-create-commit'

export interface SpecSummary {
  id: string
  name: string
  description: string
  params: { name: string; description?: string }[]
  always: boolean
  tags: string[]
  skills: string[]
  rules: string[]
  source?: 'project' | 'plugin'
}

export interface EntitySummary {
  id: string
  name: string
  avatar?: string
  description: string
  always: boolean
  tags: string[]
  skills: string[]
  rules: string[]
  source?: 'project' | 'plugin'
}

export interface WorkspaceSummary {
  id: string
  name: string
  description: string
  path: string
  cwd: string
  pattern?: string
}

export interface RuleSummary {
  id: string
  name: string
  description: string
  always: boolean
  globs?: string[]
  source?: 'project' | 'plugin'
}

export interface SkillSummary {
  id: string
  name: string
  description: string
  always: boolean
  instancePath?: string
  source: 'project' | 'plugin' | 'home'
  sourceDetail: {
    kind: 'globalConfig' | 'projectConfig' | 'userConfig' | 'projectDefault' | 'plugin' | 'home'
    configSource?: 'global' | 'project' | 'user'
    configLabel?: string
  }
}

export interface SpecDetail extends SpecSummary {
  body: string
}

export interface EntityDetail extends EntitySummary {
  body: string
}

export interface RuleDetail extends RuleSummary {
  body: string
}

export type CreatableAssetKind = 'entity' | 'spec' | 'rule'

export interface CreateAssetParams {
  description?: string
  kind: CreatableAssetKind
  name: string
  params?: Array<{ name: string; description?: string }>
}

export interface AssetDestinationPreview {
  kind: CreatableAssetKind
  path: string
}

export interface CreatedAsset extends AssetDestinationPreview {
  commitState?: MutationCommitState
  warnings?: string[]
}
export interface SkillDetail extends SkillSummary {
  body: string
}

export async function listSpecs(): Promise<{ specs: SpecSummary[] }> {
  return fetchApiJson<{ specs: SpecSummary[] }>('/api/ai/specs')
}

export async function listSkills(): Promise<{ skills: SkillSummary[] }> {
  return fetchApiJson<{ skills: SkillSummary[] }>('/api/ai/skills')
}

export async function createSkill(params: {
  name: string
  description?: string
  body?: string
}): Promise<{ skill: SkillDetail }> {
  return fetchApiJson<{ skill: SkillDetail }>('/api/ai/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
}

export async function importSkillArchive(
  file: File,
  target: 'global' | 'project' = 'project',
  options: { force?: boolean } = {}
): Promise<{ fileCount: number; targetDir: string }> {
  return fetchApiJson<{ fileCount: number; targetDir: string }>('/api/ai/skills/import', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-skill-target': target,
      ...(options.force === true ? { 'x-skill-force': 'true' } : {})
    },
    body: file
  })
}

export async function listEntities(): Promise<{ entities: EntitySummary[] }> {
  return fetchApiJson<{ entities: EntitySummary[] }>('/api/ai/entities')
}

export async function listWorkspaces(): Promise<{ workspaces: WorkspaceSummary[] }> {
  return fetchApiJson<{ workspaces: WorkspaceSummary[] }>('/api/ai/workspaces')
}

export async function listRules(): Promise<{ rules: RuleSummary[] }> {
  return fetchApiJson<{ rules: RuleSummary[] }>('/api/ai/rules')
}

export async function createAsset(params: CreateAssetParams): Promise<{ asset: CreatedAsset }> {
  try {
    const accepted = await fetchApiJsonWithStatus<unknown>('/api/ai/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    })
    if (!isAssetCreatePendingResponse(accepted.data, accepted.status)) {
      throw new AssetCreateCommitIndeterminateError(new Error('Invalid asset create response'))
    }
    return await pollAssetCreateOperation(accepted.data.operation.id, path => fetchApiJsonWithStatus<unknown>(path))
  } catch (error) {
    throw normalizeAssetCreateFailure(error)
  }
}

export async function getAssetPreview(
  kind: CreatableAssetKind,
  name: string
): Promise<{ asset: AssetDestinationPreview }> {
  const url = createApiUrl('/api/ai/assets/preview')
  url.searchParams.set('kind', kind)
  url.searchParams.set('name', name)
  return fetchApiJson<{ asset: AssetDestinationPreview }>(url)
}

export async function getSpecDetail(path: string): Promise<{ spec: SpecDetail }> {
  const url = createApiUrl('/api/ai/specs/detail')
  url.searchParams.set('path', path)
  return fetchApiJson<{ spec: SpecDetail }>(url)
}

export async function getEntityDetail(path: string): Promise<{ entity: EntityDetail }> {
  const url = createApiUrl('/api/ai/entities/detail')
  url.searchParams.set('path', path)
  return fetchApiJson<{ entity: EntityDetail }>(url)
}

export async function getEntityRuntime(path: string): Promise<{ runtime: EntityRuntimeDetail }> {
  const url = createApiUrl('/api/ai/entities/runtime')
  url.searchParams.set('path', path)
  return fetchApiJson<{ runtime: EntityRuntimeDetail }>(url)
}

export async function updateEntityConfig(
  path: string,
  value: Record<string, unknown>
): Promise<{ ok: true }> {
  return fetchApiJson<{ ok: true }>('/api/ai/entities/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, value })
  })
}

export async function createEntityDocument(
  entityPath: string,
  kind: EntityRuntimeDetail['documents'][number]['kind']
): Promise<{ ok: true; path: string }> {
  return fetchApiJson<{ ok: true; path: string }>('/api/ai/entities/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityPath, kind })
  })
}

export async function updateEntityMemory(
  memoryId: string,
  value: { content: string; keywords: string[]; pinned: boolean }
): Promise<{ memory: EntityRuntimeDetail['memories'][number] }> {
  return fetchApiJson<{ memory: EntityRuntimeDetail['memories'][number] }>(
    `/api/ai/entities/memories/${encodeURIComponent(memoryId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    }
  )
}

export async function updateEntityChannelAccount(
  channelKey: string,
  enabled: boolean
): Promise<{ ok: true }> {
  return fetchApiJson<{ ok: true }>(
    `/api/ai/entities/channel-accounts/${encodeURIComponent(channelKey)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    }
  )
}

export async function createEntityChannelLink(value: {
  channelKey: string
  description: string
  entityPath: string
  externalId: string
  externalType: string
  name: string
}): Promise<{ ok: true; path: string }> {
  return fetchApiJson<{ ok: true; path: string }>('/api/ai/entities/channel-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  })
}

export async function deleteEntityChannelLink(path: string): Promise<{ ok: true }> {
  const url = createApiUrl('/api/ai/entities/channel-links')
  url.searchParams.set('path', path)
  return fetchApiJson<{ ok: true }>(url, { method: 'DELETE' })
}

export async function getRuleDetail(path: string): Promise<{ rule: RuleDetail }> {
  const url = createApiUrl('/api/ai/rules/detail')
  url.searchParams.set('path', path)
  return fetchApiJson<{ rule: RuleDetail }>(url)
}

export async function getSkillDetail(path: string): Promise<{ skill: SkillDetail }> {
  const url = createApiUrl('/api/ai/skills/detail')
  url.searchParams.set('path', path)
  return fetchApiJson<{ skill: SkillDetail }>(url)
}
