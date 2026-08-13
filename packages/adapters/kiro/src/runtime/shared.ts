/* eslint-disable max-lines -- Kiro isolated profile staging keeps related native assets together. */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { AdapterCtx, AdapterMessageContent, AdapterQueryOptions, Config } from '@oneworks/types'
import {
  mergeProcessEnvWithProjectEnv,
  omitAdapterCommonConfig,
  resolveProjectOoPath,
  syncSymlinkTarget
} from '@oneworks/utils'

import type { KiroAdapterConfig } from '../config-schema'
import { buildKiroNativeHookEnv, buildKiroNativeHooksConfig } from './native-hooks'
import {
  assertSafeKiroOverlayParent,
  assertSafeKiroSkillsRoot,
  resolveKiroSkillOverlayTarget
} from './safe-overlay-path'
import { prepareSafeKiroSessionLayout, syncSafeKiroKeychains } from './safe-session-home'

type McpServerConfig = NonNullable<Config['mcpServers']>[string]
interface KiroMcpServer {
  args: string[]
  command: string
  env: Array<{ name: string; value: string }>
  name: string
}

export const DEFAULT_KIRO_TOOLS = ['read', 'write', 'shell', 'mcp', 'web']
export const MANAGED_KIRO_AGENT = 'oneworks'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const deepMerge = (base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> => {
  const next = { ...base }
  for (const [key, value] of Object.entries(override)) {
    next[key] = isRecord(next[key]) && isRecord(value)
      ? deepMerge(next[key] as Record<string, unknown>, value)
      : value
  }
  return next
}

export const resolveKiroAdapterConfig = (ctx: AdapterCtx): KiroAdapterConfig => {
  const [config, userConfig] = ctx.configs
  const projectConfig = (config?.adapters?.kiro ?? {}) as KiroAdapterConfig
  const userAdapterConfig = (userConfig?.adapters?.kiro ?? {}) as KiroAdapterConfig
  return omitAdapterCommonConfig({
    ...projectConfig,
    ...userAdapterConfig,
    ...(projectConfig.cli != null || userAdapterConfig.cli != null
      ? { cli: deepMerge(projectConfig.cli ?? {}, userAdapterConfig.cli ?? {}) }
      : {}),
    ...(projectConfig.configContent != null || userAdapterConfig.configContent != null
      ? { configContent: deepMerge(projectConfig.configContent ?? {}, userAdapterConfig.configContent ?? {}) }
      : {}),
    ...(projectConfig.agentConfig != null || userAdapterConfig.agentConfig != null
      ? { agentConfig: deepMerge(projectConfig.agentConfig ?? {}, userAdapterConfig.agentConfig ?? {}) }
      : {})
  }) as KiroAdapterConfig
}

export const toProcessEnv = (env: AdapterCtx['env']): NodeJS.ProcessEnv => (
  Object.fromEntries(
    Object.entries(mergeProcessEnvWithProjectEnv(env, {
      workspaceFolder: env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__?.trim() || undefined
    })).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
)

const writeJson = async (filePath: string, value: unknown) => {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const ensureKiroSkills = async (options: AdapterQueryOptions, kiroHome: string) => {
  const skillsDir = resolve(kiroHome, 'skills')
  await assertSafeKiroSkillsRoot(kiroHome, skillsDir)
  await rm(skillsDir, { recursive: true, force: true })
  await mkdir(skillsDir, { recursive: false })
  await assertSafeKiroSkillsRoot(kiroHome, skillsDir)
  const overlays = options.assetPlan?.overlays.filter(overlay => overlay.kind === 'skill') ?? []
  for (const overlay of overlays) {
    const targetPath = resolveKiroSkillOverlayTarget(skillsDir, overlay.targetPath)
    await assertSafeKiroOverlayParent(skillsDir, targetPath)
    await syncSymlinkTarget({
      sourcePath: overlay.sourcePath,
      targetPath,
      type: 'dir'
    })
  }
}

const ensureKiroSettings = async (adapterConfig: KiroAdapterConfig, kiroHome: string) => {
  const settingsPath = resolve(kiroHome, 'settings', 'cli.json')
  await writeJson(settingsPath, adapterConfig.configContent ?? {})
}

const ensureKiroSteering = async (options: AdapterQueryOptions, kiroHome: string) => {
  const steeringPath = resolve(kiroHome, 'steering', 'oneworks-system.md')
  const prompt = options.systemPrompt?.trim()
  if (!prompt) {
    await rm(steeringPath, { force: true })
    return undefined
  }
  await mkdir(dirname(steeringPath), { recursive: true })
  await writeFile(steeringPath, `---\ninclusion: always\n---\n\n${prompt}\n`, 'utf8')
  return steeringPath
}

const ensureKiroAgent = async (params: {
  adapterConfig: KiroAdapterConfig
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  kiroHome: string
  options: AdapterQueryOptions
  steeringPath?: string
}) => {
  const hooks = buildKiroNativeHooksConfig({ ctx: params.ctx, options: params.options })
  const baseAgent: Record<string, unknown> = {
    name: MANAGED_KIRO_AGENT,
    description: 'One Works managed Kiro session agent',
    includeMcpJson: false,
    ...(params.steeringPath != null ? { resources: [`file://${params.steeringPath}`] } : {}),
    ...(hooks != null ? { hooks } : {})
  }
  const mergedAgent = deepMerge(baseAgent, params.adapterConfig.agentConfig ?? {})
  const configuredResources = Array.isArray(mergedAgent.resources)
    ? mergedAgent.resources.filter((value): value is string => typeof value === 'string')
    : []
  const resources = params.steeringPath == null
    ? configuredResources
    : [...new Set([`file://${params.steeringPath}`, ...configuredResources])]
  await writeJson(
    resolve(params.kiroHome, 'agents', `${MANAGED_KIRO_AGENT}.json`),
    {
      ...mergedAgent,
      name: MANAGED_KIRO_AGENT,
      includeMcpJson: false,
      ...(resources.length > 0 ? { resources } : {}),
      ...(hooks != null ? { hooks } : {})
    }
  )
}

export const mapKiroMcpServers = (mcpServers: Record<string, McpServerConfig>) => {
  const servers: KiroMcpServer[] = []
  const skippedServerNames: string[] = []
  for (const [name, server] of Object.entries(mcpServers)) {
    if (!('command' in server)) {
      skippedServerNames.push(name)
      continue
    }
    servers.push({
      name,
      command: server.command,
      args: server.args ?? [],
      env: Object.entries(server.env ?? {}).map(([envName, value]) => ({ name: envName, value }))
    })
  }
  return { servers, skippedServerNames }
}

export const normalizeKiroPrompt = (content: AdapterMessageContent[]) => (
  content.flatMap((item) => {
    if (item.type === 'text') return item.text.trim() === '' ? [] : [item.text]
    if (item.type === 'image') return [`[Image: ${item.path ?? item.name ?? item.url}]`]
    if (item.type === 'file') return [`[File: ${item.path}]`]
    if (item.type === 'tool_result') {
      const result = typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
      return [`[Tool result ${item.tool_use_id}]: ${result}`]
    }
    return []
  }).join('\n\n').trim()
)

export const prepareKiroSessionRuntime = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions,
  adapterConfig: KiroAdapterConfig
) => {
  const cacheRoot = resolveProjectOoPath(ctx.cwd, ctx.env, 'caches')
  const sessionRoot = resolve(cacheRoot, ctx.ctxId, options.sessionId, 'adapter-kiro')
  const kiroHome = resolve(sessionRoot, 'kiro-home')
  const layout = await prepareSafeKiroSessionLayout({ cacheRoot, kiroHome, sessionRoot })
  await syncSafeKiroKeychains({ layout })
  const { sessionHome } = layout
  await ensureKiroSkills(options, kiroHome)
  await ensureKiroSettings(adapterConfig, kiroHome)
  const steeringPath = await ensureKiroSteering(options, kiroHome)
  await ensureKiroAgent({ adapterConfig, ctx, kiroHome, options, steeringPath })

  return {
    kiroHome,
    env: toProcessEnv({
      ...ctx.env,
      ...buildKiroNativeHookEnv({ ctx, options }),
      HOME: sessionHome,
      USERPROFILE: sessionHome,
      KIRO_HOME: kiroHome
    })
  }
}
