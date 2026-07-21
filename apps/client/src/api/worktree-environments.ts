import type {
  AdapterWorktreeEnvironmentImportResult,
  AdapterWorktreeEnvironmentImporterDescriptor,
  WorktreeEnvironmentDetail,
  WorktreeEnvironmentListResult,
  WorktreeEnvironmentMutationResult,
  WorktreeEnvironmentSavePayload,
  WorktreeEnvironmentSource
} from '@oneworks/types'

import { fetchApiJson, jsonHeaders } from './base'

export async function listWorktreeEnvironments(): Promise<WorktreeEnvironmentListResult> {
  return fetchApiJson<WorktreeEnvironmentListResult>('/api/worktree-environments')
}

export async function listWorktreeEnvironmentImporters(): Promise<{
  importers: AdapterWorktreeEnvironmentImporterDescriptor[]
}> {
  return fetchApiJson<{ importers: AdapterWorktreeEnvironmentImporterDescriptor[] }>(
    '/api/worktree-environments/imports/adapters'
  )
}

export async function importWorktreeEnvironmentsFromAdapter(
  adapterKey: string,
  source: WorktreeEnvironmentSource
): Promise<AdapterWorktreeEnvironmentImportResult> {
  return fetchApiJson<AdapterWorktreeEnvironmentImportResult>(
    `/api/worktree-environments/imports/${encodeURIComponent(adapterKey)}`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ source })
    }
  )
}

const getSourceQuery = (source?: WorktreeEnvironmentSource) => (
  source == null ? '' : `?source=${encodeURIComponent(source)}`
)

export async function getWorktreeEnvironment(
  id: string,
  source?: WorktreeEnvironmentSource
): Promise<{ environment: WorktreeEnvironmentDetail }> {
  return fetchApiJson<{ environment: WorktreeEnvironmentDetail }>(
    `/api/worktree-environments/${encodeURIComponent(id)}${getSourceQuery(source)}`
  )
}

export async function saveWorktreeEnvironment(
  id: string,
  payload: WorktreeEnvironmentSavePayload,
  source?: WorktreeEnvironmentSource
): Promise<WorktreeEnvironmentMutationResult> {
  return fetchApiJson<WorktreeEnvironmentMutationResult>(
    `/api/worktree-environments/${encodeURIComponent(id)}${getSourceQuery(source)}`,
    {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(payload)
    }
  )
}

export async function deleteWorktreeEnvironment(
  id: string,
  source?: WorktreeEnvironmentSource
): Promise<{ ok: true; removed: boolean }> {
  return fetchApiJson<{ ok: true; removed: boolean }>(
    `/api/worktree-environments/${encodeURIComponent(id)}${getSourceQuery(source)}`,
    {
      method: 'DELETE'
    }
  )
}
