import { basename } from 'node:path'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { createRelayDeviceStore } from './server/store.js'
import { RELAY_CONFIG_SAFE_FIELDS, resolveRelayConfigPatchForProject } from './shared/config-assignment.js'
import type { RelayConfigPatch, RelayConfigSnapshot } from './shared/config-assignment.js'
import { createRelayConfigSnapshotStore } from './shared/config-cache.js'
import { decryptRelayConfigSnapshotSecretEnvelope } from './shared/config-secrets.js'

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

const SAFE_TOP_LEVEL_FIELDS = new Set<string>(RELAY_CONFIG_SAFE_FIELDS)
const secretRefLeafPattern =
  /(?:^|[_-])(?:api[_-]?key|secret|token|password|credential|private[_-]?key)(?:$|[_-])|apiKey|accessToken|refreshToken/iu

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

const cloneConfigPatch = (patch: RelayConfigPatch | undefined): RelayConfigPatch | undefined => {
  if (patch == null) return undefined
  return JSON.parse(JSON.stringify(patch)) as RelayConfigPatch
}

const secretRefPath = (ref: string) =>
  (
    ref.startsWith('/')
      ? ref.split('/').slice(1).map(segment => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'))
      : ref.split('.')
  ).map(segment => segment.trim()).filter(Boolean)

const setSecretValue = (patch: RelayConfigPatch, ref: string, value: string) => {
  const path = secretRefPath(ref)
  const [root, ...rest] = path
  const leaf = path.at(-1)
  if (root == null || leaf == null || rest.length === 0) return
  if (!SAFE_TOP_LEVEL_FIELDS.has(root) || !secretRefLeafPattern.test(leaf)) return

  if (!isRecord(patch[root])) {
    patch[root] = {}
  }
  let target = patch[root] as Record<string, unknown>
  for (const segment of path.slice(1, -1)) {
    const current = target[segment]
    if (!isRecord(current)) {
      target[segment] = {}
    }
    target = target[segment] as Record<string, unknown>
  }
  target[leaf] = value
}

const snapshotDeviceToken = async (
  projectHome: string,
  snapshot: RelayConfigSnapshot
) => {
  const store = await createRelayDeviceStore(projectHome).readStore()
  const sourceServerId = readText(snapshot.sourceServerId)
  if (sourceServerId != null) {
    const exactServer = store.servers[sourceServerId]
    if (exactServer?.deviceToken != null && exactServer.deviceToken !== '') return exactServer.deviceToken
    const matchingServer = Object.values(store.servers).find(server =>
      server.id === sourceServerId || server.remoteBaseUrl === sourceServerId
    )
    if (matchingServer?.deviceToken != null && matchingServer.deviceToken !== '') return matchingServer.deviceToken
  }
  const servers = Object.values(store.servers).filter(server => server.deviceToken !== '')
  return servers.length === 1 ? servers[0].deviceToken : ''
}

const applySnapshotSecrets = async (
  projectHome: string,
  snapshot: RelayConfigSnapshot,
  patch: RelayConfigPatch | undefined,
  matchedAssignmentIds: string[]
) => {
  const nextPatch = cloneConfigPatch(patch)
  if (nextPatch == null || matchedAssignmentIds.length === 0) return nextPatch
  const deviceToken = await snapshotDeviceToken(projectHome, snapshot).catch(() => '')
  if (deviceToken === '') return nextPatch

  const matchedIds = new Set(matchedAssignmentIds)
  for (const assignment of snapshot.assignments ?? []) {
    if (!matchedIds.has(assignment.id)) continue
    for (const envelope of assignment.secrets ?? []) {
      const plaintext = decryptRelayConfigSnapshotSecretEnvelope(envelope, deviceToken)
      if (plaintext != null) {
        setSecretValue(nextPatch, envelope.ref, plaintext)
      }
    }
  }
  return nextPatch
}

export const resolveConfig = async (context: RelayPluginConfigHookContext) => {
  const workspaceFolder = resolveWorkspaceFolder(context)
  const projectHome = resolveProjectHomePath(workspaceFolder, context.env)
  const snapshotStore = createRelayConfigSnapshotStore(projectHome)
  const snapshot = await snapshotStore.readSnapshot()
  if (snapshot == null) return undefined

  const resolved = resolveRelayConfigPatchForProject(snapshot, resolveProjectContext(context))
  const patch = await applySnapshotSecrets(projectHome, snapshot, resolved.patch, resolved.matchedAssignmentIds)
  const config = toConfig(patch)
  await snapshotStore.writeSnapshot({
    ...snapshot,
    lastAppliedAt: config == null ? snapshot.lastAppliedAt ?? null : new Date().toISOString(),
    matchedProject: resolved.matchedAssignmentIds.length > 0
  }).catch(() => {})
  return config
}

export default resolveConfig
