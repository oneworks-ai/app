/* eslint-disable max-lines -- Relay config hook owns snapshot resolution, secret application, and runtime config projection. */
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import {
  filterRelayConfigSnapshotByPreferences,
  readRelayConfigSourcePreferencesForSnapshot
} from './server/config-source-preferences.js'
import { createRelayDeviceStore } from './server/store.js'
import { normalizeRelayGitRepositoryIdentity } from './shared/config-assignment-project.js'
import { RELAY_CONFIG_SAFE_FIELDS, resolveRelayConfigPatchForProject } from './shared/config-assignment.js'
import type { RelayConfigPatch, RelayConfigSnapshot } from './shared/config-assignment.js'
import { createRelayConfigSnapshotStore, readRelayConfigSnapshotWithGlobalFallback } from './shared/config-cache.js'
import { decryptRelayConfigSnapshotSecretEnvelope } from './shared/config-secrets.js'
import {
  relayProjectRuleDocumentBasePayloadPath,
  relayProjectRuleDocumentDisplayPath
} from './shared/document-paths.js'

interface RelayPluginConfigHookContext {
  cwd: string
  env: Record<string, string | null | undefined>
  jsonVariables: Record<string, string | null | undefined>
  mergedConfig?: {
    systemPrompt?: string
  }
  plugin: {
    options?: Record<string, unknown>
  }
}

interface RelaySafeConfig {
  adapters?: Record<string, unknown>
  marketplaces?: Record<string, unknown>
  modelServices?: Record<string, unknown>
  plugins?: unknown[] | Record<string, unknown>
  recommendedModels?: unknown[]
  skillRegistries?: unknown[] | Record<string, unknown>
  skills?: unknown[] | Record<string, unknown>
  skillsMeta?: Record<string, unknown>
  systemPrompt?: string
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

// UI rules and runtime matching share canonical host/owner/repository identities.
export const readRelayGitRepositoryIdentities = async (
  workspaceFolder: string
) =>
  new Promise<string[]>(resolveResult => {
    execFile(
      'git',
      ['-C', workspaceFolder, 'config', '--get-regexp', '^remote\\..*\\.url$'],
      { encoding: 'utf8', maxBuffer: 256 * 1024 },
      (error, stdout) => {
        if (error != null) {
          resolveResult([])
          return
        }
        const identities = stdout
          .split(/\r?\n/gu)
          .map(line => line.replace(/^\S+\s+/u, ''))
          .map(normalizeRelayGitRepositoryIdentity)
          .filter((value): value is string => value != null)
        resolveResult([...new Set(identities)])
      }
    )
  })

const resolveProjectContext = async (context: RelayPluginConfigHookContext) => {
  const workspaceFolder = resolveWorkspaceFolder(context)
  const projectId = readOptionText(context, 'projectId') ??
    readText(context.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__) ??
    readText(context.jsonVariables.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__)
  return {
    cwd: context.cwd,
    gitRepositories: await readRelayGitRepositoryIdentities(workspaceFolder),
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
  if (isRecord(patch.adapters)) {
    config.adapters = patch.adapters
  }
  if (isRecord(patch.modelServices)) {
    config.modelServices = patch.modelServices
  }
  if (Array.isArray(patch.recommendedModels)) {
    config.recommendedModels = patch.recommendedModels
  }
  if (Array.isArray(patch.plugins) || isRecord(patch.plugins)) {
    config.plugins = patch.plugins
  }
  if (isRecord(patch.marketplaces)) {
    config.marketplaces = patch.marketplaces
  }
  if (Array.isArray(patch.skills) || isRecord(patch.skills)) {
    config.skills = patch.skills
  }
  if (isRecord(patch.skillsMeta)) {
    config.skillsMeta = patch.skillsMeta
  }
  if (Array.isArray(patch.skillRegistries) || isRecord(patch.skillRegistries)) {
    config.skillRegistries = patch.skillRegistries
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

  if (!isRecord(patch[root]) && !Array.isArray(patch[root])) {
    patch[root] = {}
  }
  let target = patch[root] as Record<string, unknown> | unknown[]
  for (const segment of path.slice(1, -1)) {
    if (Array.isArray(target)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= target.length) return
      const current = target[index]
      if (!isRecord(current) && !Array.isArray(current)) {
        target[index] = {}
      }
      target = target[index] as Record<string, unknown> | unknown[]
      continue
    }
    const current = target[segment]
    if (!isRecord(current) && !Array.isArray(current)) {
      target[segment] = {}
    }
    target = target[segment] as Record<string, unknown> | unknown[]
  }
  if (Array.isArray(target)) {
    const index = Number(leaf)
    if (!Number.isInteger(index) || index < 0 || index >= target.length) return
    target[index] = value
    return
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

const resolveUserHomeDir = (context: RelayPluginConfigHookContext) => (
  resolve(
    readText(context.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
      readText(context.env.HOME) ??
      homedir()
  )
)

// Project-rule documents are local derived guidance, not part of the distributed config patch.
const matchedProjectRuleDocumentPrompt = async (
  context: RelayPluginConfigHookContext,
  snapshot: RelayConfigSnapshot,
  matchedAssignmentIds: string[]
) => {
  const matchedIds = new Set(matchedAssignmentIds)
  const homeDir = resolveUserHomeDir(context)
  const instructions: string[] = []
  for (const assignment of snapshot.assignments ?? []) {
    if (!matchedIds.has(assignment.id)) continue
    const teamId = assignment.provenance?.teamId?.trim()
    if (teamId == null || teamId === '') continue
    const payloadPath = relayProjectRuleDocumentBasePayloadPath(teamId, assignment.id)
    const directory = resolve(homeDir, payloadPath)
    const directoryStat = await stat(directory).catch(() => undefined)
    if (directoryStat?.isDirectory() !== true) continue
    const displayPath = relayProjectRuleDocumentDisplayPath(teamId, assignment.id)
    instructions.push(
      `- ${
        assignment.provenance?.profileName ?? assignment.id
      }: read ${displayPath}/AGENTS.md and relevant Markdown files under ${displayPath}/rules/ before working on this matched Git project.`
    )
  }
  if (instructions.length === 0) return undefined
  return [
    'Relay project rule documents apply to the current Git project.',
    ...instructions,
    'Treat these synced documents as project-specific instructions and follow their progressive disclosure links.'
  ].join('\n')
}

export const resolveConfig = async (context: RelayPluginConfigHookContext) => {
  const workspaceFolder = resolveWorkspaceFolder(context)
  const projectHome = resolveProjectHomePath(workspaceFolder, context.env)
  const snapshotStore = createRelayConfigSnapshotStore(projectHome)
  const { snapshot } = await readRelayConfigSnapshotWithGlobalFallback({
    env: context.env,
    projectHome
  })
  if (snapshot == null) return undefined

  const store = await createRelayDeviceStore(projectHome).readStore()
  const effectiveSnapshot = filterRelayConfigSnapshotByPreferences(
    snapshot,
    readRelayConfigSourcePreferencesForSnapshot(store, snapshot)
  )
  const resolved = resolveRelayConfigPatchForProject(effectiveSnapshot, await resolveProjectContext(context))
  const patch = await applySnapshotSecrets(
    projectHome,
    effectiveSnapshot,
    resolved.patch,
    resolved.matchedAssignmentIds
  )
  const documentPrompt = await matchedProjectRuleDocumentPrompt(
    context,
    effectiveSnapshot,
    resolved.matchedAssignmentIds
  )
  const patchConfig = toConfig(patch)
  const config = documentPrompt == null
    ? patchConfig
    : {
      ...patchConfig,
      systemPrompt: [readText(context.mergedConfig?.systemPrompt), documentPrompt].filter(Boolean).join('\n\n')
    }
  await snapshotStore.writeSnapshot({
    ...snapshot,
    lastAppliedAt: config == null ? snapshot.lastAppliedAt ?? null : new Date().toISOString(),
    matchedProject: resolved.matchedAssignmentIds.length > 0
  }).catch(() => {})
  return config
}

export default resolveConfig
