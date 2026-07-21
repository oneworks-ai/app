import type { AdapterCtx } from './adapter'
import type { WorktreeEnvironmentScriptKey, WorktreeEnvironmentSource } from './worktree-environment'

export type AdapterWorktreeEnvironmentImportSource = WorktreeEnvironmentSource

export interface AdapterWorktreeEnvironmentImportCandidate {
  displayName?: string
  scripts: Partial<Record<WorktreeEnvironmentScriptKey, string>>
  sourceId: string
  suggestedId: string
  warnings: string[]
}

export interface AdapterWorktreeEnvironmentImportDiscoveryResult {
  environments: AdapterWorktreeEnvironmentImportCandidate[]
  found: boolean
  skippedActionCount: number
  skippedEnvironmentCount: number
}

export type AdapterWorktreeEnvironmentImportDiscoverer = (params: {
  cwd: string
  env: AdapterCtx['env']
  source: AdapterWorktreeEnvironmentImportSource
}) => Promise<AdapterWorktreeEnvironmentImportDiscoveryResult>

export interface AdapterWorktreeEnvironmentImportDescriptor {
  description?: string
  supportedSources: readonly AdapterWorktreeEnvironmentImportSource[]
  title: string
}

export interface AdapterWorktreeEnvironmentImportCapability {
  descriptor: AdapterWorktreeEnvironmentImportDescriptor
  discover: AdapterWorktreeEnvironmentImportDiscoverer
}

export interface AdapterWorktreeEnvironmentImporterDescriptor extends AdapterWorktreeEnvironmentImportDescriptor {
  adapterKey: string
  runtimeAdapter: string
  supportedSources: AdapterWorktreeEnvironmentImportSource[]
}

export interface AdapterWorktreeEnvironmentImportResult {
  adapterKey: string
  environmentCount: number
  existingEnvironmentIds: string[]
  found: boolean
  importedEnvironmentIds: string[]
  skippedActionCount: number
  skippedEnvironmentCount: number
  source: AdapterWorktreeEnvironmentImportSource
  warningCount: number
}
