import { basename } from 'node:path'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { resolveRelayConfigPatchForProject } from './shared/config-assignment.js'
import { createRelayConfigSnapshotStore } from './shared/config-cache.js'

interface RelayPluginConfigHookContext {
  cwd: string
  env: Record<string, string | null | undefined>
  jsonVariables: Record<string, string | null | undefined>
  plugin: {
    options?: Record<string, unknown>
  }
}

interface RelaySafeConfig {
  defaultModelService?: string
  modelServices?: Record<string, unknown>
  recommendedModels?: unknown[]
}

const readText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readOptionText = (context: RelayPluginConfigHookContext, key: string) => (
  isRecord(context.plugin.options) ? readText(context.plugin.options[key]) : undefined
)

const resolveWorkspaceFolder = (context: RelayPluginConfigHookContext) => (
  readText(context.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__) ??
    readText(context.jsonVariables.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__) ??
    readText(context.jsonVariables.WORKSPACE_FOLDER) ??
    context.cwd
)

const resolveProjectContext = (context: RelayPluginConfigHookContext) => {
  const workspaceFolder = resolveWorkspaceFolder(context)
  const projectId = readOptionText(context, 'projectId') ??
    readText(context.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__) ??
    readText(context.jsonVariables.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__)
  return {
    cwd: context.cwd,
    projectId,
    projectName: readOptionText(context, 'projectName') ?? projectId ?? basename(workspaceFolder),
    workspaceFolder
  }
}

const toConfig = (
  patch: ReturnType<typeof resolveRelayConfigPatchForProject>['patch']
): RelaySafeConfig | undefined => {
  if (patch == null) return undefined

  const config: RelaySafeConfig = {}
  if (isRecord(patch.modelServices)) {
    config.modelServices = patch.modelServices
  }
  if (typeof patch.defaultModelService === 'string' && patch.defaultModelService.trim() !== '') {
    config.defaultModelService = patch.defaultModelService
  }
  if (Array.isArray(patch.recommendedModels)) {
    config.recommendedModels = patch.recommendedModels
  }

  return Object.keys(config).length > 0 ? config : undefined
}

export const resolveConfig = async (context: RelayPluginConfigHookContext) => {
  const workspaceFolder = resolveWorkspaceFolder(context)
  const projectHome = resolveProjectHomePath(workspaceFolder, context.env)
  const snapshotStore = createRelayConfigSnapshotStore(projectHome)
  const snapshot = await snapshotStore.readSnapshot()
  if (snapshot == null) return undefined

  const resolved = resolveRelayConfigPatchForProject(snapshot, resolveProjectContext(context))
  const config = toConfig(resolved.patch)
  await snapshotStore.writeSnapshot({
    ...snapshot,
    lastAppliedAt: config == null ? snapshot.lastAppliedAt ?? null : new Date().toISOString(),
    matchedProject: resolved.matchedAssignmentIds.length > 0
  }).catch(() => {})
  return config
}

export default resolveConfig
