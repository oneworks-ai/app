/* eslint-disable max-lines -- the complete Factory session boundary stays auditable in one module. */
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import { NATIVE_HOOK_BRIDGE_ADAPTER_ENV } from '@oneworks/hooks'
import type { AdapterCtx, AdapterQueryOptions, AssetDiagnostic, Config } from '@oneworks/types'
import { mergeProcessEnvWithProjectEnv, resolveProjectOoPath, syncSymlinkTarget } from '@oneworks/utils'

import { DROID_SUPPORTED_EFFORTS } from '../config-schema'
import { resolveDroidBinaryPath } from '../paths'
import { resolveDroidAdapterConfig } from './adapter-config'
import { buildDroidNativeHooks } from './native-hooks'

export { resolveDroidAdapterConfig } from './adapter-config'
export type { DroidAdapterConfig, DroidAdapterNativeConfig } from './adapter-config'

export interface DroidPreparedSession {
  args: string[]
  assetDiagnostics: AssetDiagnostic[]
  binaryPath: string
  cleanup: () => Promise<void>
  initParams: Record<string, unknown>
  loadParams: Record<string, unknown>
  model: string
  processCwd: string
  sessionRoot: string
  spawnEnv: Record<string, string>
}

const FACTORY_AUTH_ENV = new Set(['FACTORY_API_KEY', 'FACTORY_TOKEN'])
const FORBIDDEN_EXTRA_OPTIONS = new Set([
  '--auto',
  '--input-format',
  '--mission',
  '--output-format',
  '--resume',
  '--session-id',
  '--skip-permissions-unsafe',
  '--worktree',
  '-w'
])
const UNSUPPORTED_CONFIG_KEYS = new Set([
  'enabledPlugins',
  'marketplace',
  'mission',
  'missions',
  'plugin',
  'plugins',
  'worktree'
])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const deepMerge = (
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> => {
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const previous = result[key]
    result[key] = isRecord(previous) && isRecord(value)
      ? deepMerge(previous, value)
      : value
  }
  return result
}

const stripUnsupportedConfig = (config: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(config).filter(([key]) => !UNSUPPORTED_CONFIG_KEYS.has(key))
  )

export const resolveDroidSessionRoot = (params: {
  ctx: Pick<AdapterCtx, 'ctxId' | 'cwd' | 'env'>
  sessionId: string
}) => {
  const key = createHash('sha256').update(`${params.ctx.ctxId}:${params.sessionId}`).digest('hex').slice(0, 24)
  return resolveProjectOoPath(params.ctx.cwd, params.ctx.env, 'caches', 'adapter-droid', 'sessions', key)
}

export const sanitizeDroidSpawnEnv = (params: {
  env: AdapterCtx['env']
  home: string
  cwd: string
  nativeHooksActive?: boolean
  runtime?: AdapterQueryOptions['runtime']
  sessionId?: string
}) => {
  const merged = mergeProcessEnvWithProjectEnv(params.env, { workspaceFolder: params.cwd })
  for (const key of Object.keys(merged)) {
    if (key.startsWith('FACTORY_') && !FACTORY_AUTH_ENV.has(key)) delete merged[key]
  }
  return Object.fromEntries(
    Object.entries({
      ...merged,
      HOME: params.home,
      USERPROFILE: params.home,
      XDG_CACHE_HOME: resolve(params.home, '.cache'),
      XDG_CONFIG_HOME: resolve(params.home, '.config'),
      XDG_DATA_HOME: resolve(params.home, '.local', 'share'),
      [NATIVE_HOOK_BRIDGE_ADAPTER_ENV]: params.nativeHooksActive === true ? 'droid' : undefined,
      __ONEWORKS_DROID_HOOKS_ACTIVE__: params.nativeHooksActive === true ? '1' : undefined,
      __ONEWORKS_DROID_HOOK_RUNTIME__: params.nativeHooksActive === true ? params.runtime : undefined,
      __ONEWORKS_DROID_TASK_SESSION_ID__: params.nativeHooksActive === true ? params.sessionId : undefined
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

const validateExtraOptions = (values: string[] | undefined) => {
  const result = values ?? []
  for (const value of result) {
    const key = value.split('=', 1)[0]
    if (FORBIDDEN_EXTRA_OPTIONS.has(key)) {
      throw new Error(`Factory Droid extra option "${key}" is reserved by One Works orchestration.`)
    }
  }
  return result
}

const translateMcpServer = (
  name: string,
  server: NonNullable<Config['mcpServers']>[string]
) => {
  if (server.type === 'http' || server.type === 'sse') {
    return {
      name,
      type: server.type,
      url: server.url,
      ...(server.headers == null
        ? {}
        : { headers: Object.entries(server.headers).map(([headerName, value]) => ({ name: headerName, value })) })
    }
  }
  return {
    name,
    command: server.command,
    args: server.args ?? [],
    env: server.env ?? {}
  }
}

const syncSkills = async (params: {
  factoryHome: string
  overlays: NonNullable<AdapterQueryOptions['assetPlan']>['overlays']
}) => {
  const skillsDir = resolve(params.factoryHome, 'skills')
  await rm(skillsDir, { recursive: true, force: true })
  const skills = params.overlays.filter(overlay => overlay.kind === 'skill')
  if (skills.length === 0) return
  await mkdir(skillsDir, { recursive: true })
  for (const overlay of skills) {
    const digest = createHash('sha256').update(overlay.assetId).digest('hex').slice(0, 10)
    const sourceName = basename(overlay.sourcePath).replace(/[^\w.-]+/gu, '-') || 'skill'
    await syncSymlinkTarget({
      sourcePath: overlay.sourcePath,
      targetPath: resolve(skillsDir, `${sourceName}-${digest}`),
      type: 'dir'
    })
  }
}

const buildPluginDiagnostics = (options: AdapterQueryOptions): AssetDiagnostic[] => (
  (options.assetPlan?.overlays ?? [])
    .filter(overlay => overlay.kind === 'nativePlugin')
    .map(overlay => {
      const original = options.assetPlan?.diagnostics.find(diagnostic => diagnostic.assetId === overlay.assetId)
      return {
        assetId: overlay.assetId,
        adapter: 'droid',
        status: 'skipped',
        reason: 'Factory plugins were skipped because stream-jsonrpc has no session-scoped plugin injection contract.',
        source: original?.source ?? 'project',
        packageId: original?.packageId,
        scope: original?.scope,
        instancePath: original?.instancePath,
        origin: original?.origin ?? 'workspace'
      }
    })
)

export const prepareDroidSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<DroidPreparedSession> => {
  const adapterConfig = resolveDroidAdapterConfig(ctx).native
  if (options.effort != null && !DROID_SUPPORTED_EFFORTS.includes(options.effort as never)) {
    throw new Error(
      `Factory Droid does not support reasoning effort "${options.effort}". Supported efforts: ${
        DROID_SUPPORTED_EFFORTS.join(', ')
      }.`
    )
  }
  const sessionRoot = resolveDroidSessionRoot({ ctx, sessionId: options.sessionId })
  const home = resolve(sessionRoot, 'home')
  const factoryHome = resolve(home, '.factory')
  try {
    await mkdir(factoryHome, { recursive: true })
    await syncSkills({ factoryHome, overlays: options.assetPlan?.overlays ?? [] })

    const nativeHooks = buildDroidNativeHooks(ctx.env)
    const rawConfig = stripUnsupportedConfig(adapterConfig.configContent ?? {})
    const settings = nativeHooks == null
      ? rawConfig
      : deepMerge(rawConfig, { hooks: nativeHooks })
    const settingsPath = resolve(sessionRoot, 'settings.json')
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })

    const args = [
      'exec',
      '--input-format',
      'stream-jsonrpc',
      '--output-format',
      'stream-jsonrpc',
      '--settings',
      settingsPath
    ]
    const systemPromptOverride = options.appendSystemPrompt === true ? undefined : options.systemPrompt
    if (options.appendSystemPrompt === true && options.systemPrompt != null) {
      const promptPath = resolve(sessionRoot, 'append-system-prompt.txt')
      await writeFile(promptPath, options.systemPrompt, { mode: 0o600 })
      args.push('--append-system-prompt-file', promptPath)
    }
    args.push(...validateExtraOptions(options.extraOptions))

    const model = options.model === 'default' || options.model == null ? 'default' : options.model
    const mcpServers = Object.entries(options.assetPlan?.mcpServers ?? {})
      .map(([name, server]) => translateMcpServer(name, server))
    const baseParams = {
      mcpServers,
      autoRejectPermissionRequests: options.permissionMode === 'dontAsk',
      disableBuiltinSkills: adapterConfig.disableBuiltinSkills === true
    }
    const initParams = {
      ...baseParams,
      machineId: `oneworks-${createHash('sha256').update(ctx.ctxId).digest('hex').slice(0, 16)}`,
      cwd: ctx.cwd,
      interactionMode: options.permissionMode === 'plan' ? 'spec' : 'auto',
      autonomyLevel: options.permissionMode === 'bypassPermissions'
        ? 'high'
        : options.permissionMode === 'acceptEdits'
        ? 'low'
        : 'off',
      ...(model === 'default' ? {} : { modelId: model }),
      ...(options.effort == null ? {} : { reasoningEffort: options.effort }),
      ...(systemPromptOverride == null ? {} : { systemPromptOverride }),
      ...(options.description == null ? {} : { title: options.description })
    }

    return {
      args,
      assetDiagnostics: [
        ...(options.assetPlan?.diagnostics ?? []).filter(diagnostic =>
          !(options.assetPlan?.overlays ?? []).some(overlay =>
            overlay.kind === 'nativePlugin' && overlay.assetId === diagnostic.assetId
          )
        ),
        ...buildPluginDiagnostics(options)
      ],
      binaryPath: resolveDroidBinaryPath(ctx.env, ctx.cwd, adapterConfig.cli),
      cleanup: () => rm(sessionRoot, { recursive: true, force: true }),
      initParams,
      loadParams: baseParams,
      model,
      processCwd: sessionRoot,
      sessionRoot,
      spawnEnv: sanitizeDroidSpawnEnv({
        env: ctx.env,
        home,
        cwd: ctx.cwd,
        nativeHooksActive: nativeHooks != null,
        runtime: options.runtime,
        sessionId: options.sessionId
      })
    }
  } catch (error) {
    await rm(sessionRoot, { recursive: true, force: true })
    throw error
  }
}
