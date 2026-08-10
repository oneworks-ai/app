import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

import type { AdapterCtx, AdapterQueryOptions, ModelServiceConfig } from '@oneworks/types'
import {
  mergeProcessEnvWithProjectEnv,
  parseStrictPermissionMirrorDocument,
  resolvePermissionMirrorPath,
  resolveProjectOoPath,
  withPrivatePermissionMirrorLock,
  writePrivatePermissionMirror
} from '@oneworks/utils'

import { resolvePiBinaryPath } from '#~/paths.js'
import { buildPiArgs, resolvePiTools } from '../common/args'
import { resolvePiModel } from '../common/model'
import {
  buildPiPermissionExtension,
  createPiSessionPermissionState,
  resolveConfiguredPiPermission,
  resolvePiPermissionSubjectKey,
  resolvePiSessionPermission
} from '../common/permission'
import { resolvePiAdapterConfig } from './config'
import { preparePiNativeFiles, resolvePiNativeExtensionPaths, writePiPrivateFile } from './native-files'

export interface PiSessionBase {
  args: string[]
  binaryPath: string
  model: string
  spawnEnv: Record<string, string>
  tools: string[]
}

const resolveRealAgentDir = (ctx: AdapterCtx) => {
  const explicit = ctx.env.__ONEWORKS_PROJECT_ADAPTER_PI_AGENT_DIR__?.trim() ?? process.env.PI_CODING_AGENT_DIR?.trim()
  const realHome = ctx.env.__ONEWORKS_PROJECT_REAL_HOME__?.trim() ?? homedir()
  return explicit && explicit !== '' ? resolve(explicit) : resolve(realHome, '.pi', 'agent')
}

const isServerConfigured = (env: Record<string, string | null | undefined>) => {
  const host = env.__ONEWORKS_PROJECT_SERVER_HOST__?.trim()
  const port = env.__ONEWORKS_PROJECT_SERVER_PORT__?.trim()
  return host != null && host !== '' && port != null && port !== ''
}

const resolveServerlessPiPermissionState = async (params: {
  ctx: AdapterCtx
  enabledTools: string[]
  sessionId: string
}) => {
  const mirrorPath = resolvePermissionMirrorPath(params.ctx.cwd, 'pi', params.sessionId, params.ctx.env)
  return await withPrivatePermissionMirrorLock(mirrorPath, async () => {
    let content: string
    try {
      content = await readFile(mirrorPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { permissionState: createPiSessionPermissionState(), oneTimePermissions: {} }
      }
      throw error
    }

    const { mirror, permissionState } = parseStrictPermissionMirrorDocument(content, {
      adapter: 'pi',
      sessionId: params.sessionId
    })
    const oneTimePermissions: Record<string, { decision: 'allow' | 'deny'; key: string }> = {}
    const claimedAllowKeys = new Set<string>()
    for (const toolName of params.enabledTools) {
      const key = resolvePiPermissionSubjectKey(toolName)
      if (permissionState.onceDeny.includes(key)) {
        oneTimePermissions[toolName] = { decision: 'deny', key }
        continue
      }
      if (permissionState.onceAllow.includes(key)) {
        oneTimePermissions[toolName] = { decision: 'allow', key }
        claimedAllowKeys.add(key)
      }
    }

    if (claimedAllowKeys.size > 0) {
      const rawState = mirror.permissionState as Record<string, unknown>
      const nextPermissionState = {
        ...rawState,
        onceAllow: permissionState.onceAllow.filter(key => !claimedAllowKeys.has(key))
      }
      await writePrivatePermissionMirror(
        mirrorPath,
        `${JSON.stringify({ ...mirror, permissionState: nextPermissionState }, null, 2)}\n`
      )
    }

    return {
      permissionState: {
        allow: new Set(permissionState.allow),
        deny: new Set(permissionState.deny),
        onceAllow: new Set(permissionState.onceAllow),
        onceDeny: new Set(permissionState.onceDeny)
      },
      oneTimePermissions
    }
  })
}

export const preparePiSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions,
  mode: 'direct' | 'stream'
): Promise<PiSessionBase> => {
  const adapterConfig = resolvePiAdapterConfig(ctx).native
  const sessionRoot = resolveProjectOoPath(ctx.cwd, ctx.env, 'caches', ctx.ctxId, options.sessionId, 'adapter-pi')
  const sessionDir = resolveProjectOoPath(ctx.cwd, ctx.env, 'caches', 'adapter-pi', 'sessions')
  await mkdir(sessionDir, { recursive: true })

  const modelServices = {
    ...(ctx.configs[0]?.modelServices ?? {}),
    ...(ctx.configs[1]?.modelServices ?? {})
  } as Record<string, ModelServiceConfig>
  const model = resolvePiModel({
    model: options.model,
    provider: adapterConfig.provider,
    modelServices
  })
  const usesNativeAuth = model.modelsConfig == null
  const agentDir = usesNativeAuth
    ? resolveProjectOoPath(ctx.cwd, ctx.env, 'caches', 'adapter-pi', 'native-agent')
    : resolve(sessionRoot, 'agent')
  await mkdir(agentDir, { recursive: true })
  const realAgentDir = resolveRealAgentDir(ctx)
  await preparePiNativeFiles({
    agentDir,
    generatedModels: model.modelsConfig,
    inheritAuth: usesNativeAuth,
    inheritNativeModels: usesNativeAuth && adapterConfig.inheritNativeSettings !== false,
    inheritNativeSettings: adapterConfig.inheritNativeSettings !== false,
    realAgentDir
  })

  const nativeExtensionsEnabled = adapterConfig.enableNativeExtensions === true
  const enabledTools = resolvePiTools(options, nativeExtensionsEnabled)
  const spawnEnv = mergeProcessEnvWithProjectEnv(ctx.env, { workspaceFolder: ctx.cwd })
  const serverConfigured = isServerConfigured(spawnEnv)
  const { permissionState: sessionPermissions, oneTimePermissions } = serverConfigured
    ? { permissionState: createPiSessionPermissionState(), oneTimePermissions: {} }
    : await resolveServerlessPiPermissionState({ ctx, enabledTools, sessionId: options.sessionId })
  const configuredPermissions = Object.fromEntries(
    [...new Set(['bash', 'edit', 'write', ...enabledTools])]
      .map((toolName) => {
        const sessionDecision = resolvePiSessionPermission(sessionPermissions, toolName)
        return [
          toolName,
          sessionDecision === 'inherit' ? resolveConfiguredPiPermission(ctx, toolName) : sessionDecision
        ]
      })
  )
  const permissionExtensionPath = resolve(sessionRoot, 'oneworks-permissions.mjs')
  await writePiPrivateFile(
    permissionExtensionPath,
    buildPiPermissionExtension({
      configuredPermissions,
      guardUnknownTools: nativeExtensionsEnabled,
      oneTimePermissions,
      permissionMode: options.permissionMode,
      sessionId: options.sessionId
    })
  )
  const env = Object.fromEntries(
    Object.entries({
      ...spawnEnv,
      ...model.env,
      PI_CODING_AGENT_DIR: agentDir,
      ...(adapterConfig.telemetry === 'inherit' ? {} : { PI_TELEMETRY: '0' }),
      ...(adapterConfig.disableVersionCheck === false ? {} : { PI_SKIP_VERSION_CHECK: '1' }),
      ...(adapterConfig.offline === true ? { PI_OFFLINE: '1' } : {})
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
  const nativeExtensionPaths = nativeExtensionsEnabled
    ? await resolvePiNativeExtensionPaths(realAgentDir)
    : []
  const args = buildPiArgs({
    adapterConfig,
    mode,
    model,
    nativeExtensionPaths,
    options,
    permissionExtensionPath,
    sessionDir
  })
  const toolsIndex = args.indexOf('--tools')
  return {
    args,
    binaryPath: resolvePiBinaryPath(ctx.env, ctx.cwd, adapterConfig.cli),
    model: model.reportedModel,
    spawnEnv: env,
    tools: toolsIndex >= 0 ? String(args[toolsIndex + 1]).split(',') : []
  }
}
