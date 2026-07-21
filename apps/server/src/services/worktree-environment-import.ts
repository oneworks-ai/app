/* eslint-disable max-lines -- adapter discovery validation and additions-only import stay colocated. */
import { Buffer } from 'node:buffer'
import process from 'node:process'

import type {
  AdapterRuntimeTarget,
  AdapterWorktreeEnvironmentImportCandidate,
  AdapterWorktreeEnvironmentImporterDescriptor,
  WorktreeEnvironmentScriptKey,
  WorktreeEnvironmentSource
} from '@oneworks/types'
import { tryLoadAdapterWorktreeEnvironmentImportCapability } from '@oneworks/types'
import { mergeProcessEnvWithProjectEnv } from '@oneworks/utils'

import { resolveSelectableAdapterRuntimeTargets } from '#~/services/adapter-imports.js'
import { loadConfigState } from '#~/services/config/index.js'
import {
  WORKTREE_ENVIRONMENT_ID_PATTERN,
  createWorktreeEnvironmentIfAbsent,
  normalizeWorktreeEnvironmentIdForSource
} from '#~/services/worktree-environments.js'

const MAX_SCRIPT_BYTES = 512 * 1024
const MAX_ENVIRONMENTS = 64
const scriptKeys = new Set<WorktreeEnvironmentScriptKey>([
  'create',
  'create.macos',
  'create.linux',
  'create.windows',
  'start',
  'start.macos',
  'start.linux',
  'start.windows',
  'destroy',
  'destroy.macos',
  'destroy.linux',
  'destroy.windows'
])

type ConfigState = Awaited<ReturnType<typeof loadConfigState>>

export class WorktreeEnvironmentImportError extends Error {
  constructor(
    readonly code:
      | 'invalid_import_source'
      | 'invalid_worktree_environment_import_result'
      | 'worktree_environment_importer_not_found',
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'WorktreeEnvironmentImportError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isInteger(value) && value >= 0
)

const isImportSource = (value: unknown): value is WorktreeEnvironmentSource => (
  value === 'project' || value === 'user'
)

const isValidScriptEntry = ([key, value]: [string, unknown]) => (
  scriptKeys.has(key as WorktreeEnvironmentScriptKey) &&
  typeof value === 'string' &&
  value.trim() !== '' &&
  !value.includes('\0') &&
  Buffer.byteLength(value, 'utf8') <= MAX_SCRIPT_BYTES
)

const asImportCandidate = (value: unknown): AdapterWorktreeEnvironmentImportCandidate | undefined => {
  if (!isRecord(value) || !isRecord(value.scripts)) return undefined
  const scriptEntries = Object.entries(value.scripts)
  if (
    typeof value.sourceId !== 'string' || value.sourceId.trim() === '' ||
    typeof value.suggestedId !== 'string' || !WORKTREE_ENVIRONMENT_ID_PATTERN.test(value.suggestedId) ||
    (value.displayName != null && typeof value.displayName !== 'string') ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every(warning => typeof warning === 'string' && warning.trim() !== '') ||
    scriptEntries.length === 0 ||
    !scriptEntries.every(isValidScriptEntry)
  ) return undefined

  return {
    ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
    scripts: Object.fromEntries(scriptEntries) as Partial<Record<WorktreeEnvironmentScriptKey, string>>,
    sourceId: value.sourceId,
    suggestedId: value.suggestedId,
    warnings: value.warnings
  }
}

const asDiscoveryResult = (value: unknown) => {
  if (!isRecord(value) || !Array.isArray(value.environments) || value.environments.length > MAX_ENVIRONMENTS) {
    return undefined
  }
  if (
    typeof value.found !== 'boolean' ||
    !isNonNegativeInteger(value.skippedActionCount) ||
    !isNonNegativeInteger(value.skippedEnvironmentCount)
  ) {
    return undefined
  }
  const environments = value.environments.map(asImportCandidate)
  if (environments.some(environment => environment == null)) return undefined
  const candidates = environments as AdapterWorktreeEnvironmentImportCandidate[]
  if (!value.found && candidates.length > 0) return undefined
  if (new Set(candidates.map(candidate => candidate.suggestedId)).size !== candidates.length) return undefined

  return {
    environments: candidates,
    found: value.found,
    skippedActionCount: value.skippedActionCount,
    skippedEnvironmentCount: value.skippedEnvironmentCount
  }
}

const resolveImportAdapterTargets = (state: ConfigState) => (
  resolveSelectableAdapterRuntimeTargets({
    config: state.mergedConfig,
    workspaceFolder: state.workspaceFolder
  })
)

const loadImportDescriptor = async (
  state: ConfigState,
  target: AdapterRuntimeTarget
): Promise<AdapterWorktreeEnvironmentImporterDescriptor | undefined> => {
  const capability = await tryLoadAdapterWorktreeEnvironmentImportCapability(target.loadSpecifier, {
    cwd: state.workspaceFolder
  })
  if (capability == null) return undefined
  return {
    adapterKey: target.instanceKey,
    ...(capability.descriptor.description == null
      ? {}
      : { description: capability.descriptor.description }),
    runtimeAdapter: target.runtimeAdapter,
    supportedSources: [...capability.descriptor.supportedSources],
    title: capability.descriptor.title
  }
}

export const listWorktreeEnvironmentImporters = async () => {
  const state = await loadConfigState()
  const targets = await resolveImportAdapterTargets(state)
  const importers = await Promise.all(targets.map(target => loadImportDescriptor(state, target)))
  return {
    importers: importers.filter(
      (item): item is AdapterWorktreeEnvironmentImporterDescriptor => item != null
    )
  }
}

export const importWorktreeEnvironmentsFromAdapter = async (params: {
  adapterKey: string
  source: unknown
}) => {
  if (!isImportSource(params.source)) {
    throw new WorktreeEnvironmentImportError(
      'invalid_import_source',
      'Invalid worktree environment import source.',
      { source: params.source }
    )
  }
  const source = params.source

  const state = await loadConfigState()
  const target = (await resolveImportAdapterTargets(state)).find(item => item.instanceKey === params.adapterKey)
  if (target == null) {
    throw new WorktreeEnvironmentImportError(
      'worktree_environment_importer_not_found',
      `Adapter "${params.adapterKey}" is not available for worktree environment import.`,
      { adapterKey: params.adapterKey }
    )
  }

  const capability = await tryLoadAdapterWorktreeEnvironmentImportCapability(target.loadSpecifier, {
    cwd: state.workspaceFolder
  })
  if (capability == null) {
    throw new WorktreeEnvironmentImportError(
      'worktree_environment_importer_not_found',
      `Adapter "${params.adapterKey}" does not support worktree environment import.`,
      { adapterKey: params.adapterKey }
    )
  }
  if (!capability.descriptor.supportedSources.includes(source)) {
    throw new WorktreeEnvironmentImportError(
      'invalid_import_source',
      `Adapter "${params.adapterKey}" does not support worktree environment import into this source.`,
      {
        adapterKey: params.adapterKey,
        source,
        supportedSources: capability.descriptor.supportedSources
      }
    )
  }

  const env = mergeProcessEnvWithProjectEnv(process.env, { workspaceFolder: state.workspaceFolder })
  const discovery = asDiscoveryResult(
    await capability.discover({
      cwd: state.workspaceFolder,
      env,
      source
    })
  )
  if (discovery == null) {
    throw new WorktreeEnvironmentImportError(
      'invalid_worktree_environment_import_result',
      `Adapter "${params.adapterKey}" returned an invalid worktree environment import result.`,
      { adapterKey: params.adapterKey }
    )
  }

  let candidates: AdapterWorktreeEnvironmentImportCandidate[]
  try {
    candidates = discovery.environments.map(candidate => ({
      ...candidate,
      suggestedId: normalizeWorktreeEnvironmentIdForSource(candidate.suggestedId, source)
    }))
  } catch {
    throw new WorktreeEnvironmentImportError(
      'invalid_worktree_environment_import_result',
      `Adapter "${params.adapterKey}" returned a reserved or invalid worktree environment id.`,
      { adapterKey: params.adapterKey, source }
    )
  }
  if (new Set(candidates.map(candidate => candidate.suggestedId)).size !== candidates.length) {
    throw new WorktreeEnvironmentImportError(
      'invalid_worktree_environment_import_result',
      `Adapter "${params.adapterKey}" returned duplicate canonical worktree environment ids.`,
      { adapterKey: params.adapterKey, source }
    )
  }

  const importedEnvironmentIds: string[] = []
  const existingEnvironmentIds: string[] = []
  for (const candidate of candidates) {
    const result = await createWorktreeEnvironmentIfAbsent({
      id: candidate.suggestedId,
      scripts: candidate.scripts,
      source,
      workspaceFolder: state.workspaceFolder
    })
    if (result.created) importedEnvironmentIds.push(result.environmentId)
    else existingEnvironmentIds.push(result.environmentId)
  }

  return {
    adapterKey: params.adapterKey,
    environmentCount: candidates.length,
    existingEnvironmentIds,
    found: discovery.found,
    importedEnvironmentIds,
    skippedActionCount: discovery.skippedActionCount,
    skippedEnvironmentCount: discovery.skippedEnvironmentCount,
    source,
    warningCount: candidates.reduce(
      (count, candidate) => count + candidate.warnings.length,
      0
    )
  }
}
