/* eslint-disable max-lines -- Cursor session staging keeps isolated HOME assets and CLI arguments together. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import type { AdapterCtx, AdapterMessageContent, AdapterQueryOptions, Config } from '@oneworks/types'
import {
  mergeProcessEnvWithProjectEnv,
  omitAdapterCommonConfig,
  resolveProjectOoPath,
  syncSymlinkTarget
} from '@oneworks/utils'

import type { CursorAdapterConfig } from '../config-schema'
import { buildCursorNativeHookEnv, buildCursorNativeHooksConfig } from './native-hooks'

type McpServerConfig = NonNullable<Config['mcpServers']>[string]

export const DEFAULT_CURSOR_TOOLS = ['read', 'write', 'shell', 'mcp', 'web']

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

export const resolveCursorAdapterConfig = (ctx: AdapterCtx): CursorAdapterConfig => {
  const [config, userConfig] = ctx.configs
  const projectConfig = (config?.adapters?.cursor ?? {}) as CursorAdapterConfig
  const userAdapterConfig = (userConfig?.adapters?.cursor ?? {}) as CursorAdapterConfig
  return omitAdapterCommonConfig({
    ...projectConfig,
    ...userAdapterConfig,
    ...(projectConfig.cli != null || userAdapterConfig.cli != null
      ? { cli: deepMerge(projectConfig.cli ?? {}, userAdapterConfig.cli ?? {}) }
      : {}),
    ...(projectConfig.configContent != null || userAdapterConfig.configContent != null
      ? { configContent: deepMerge(projectConfig.configContent ?? {}, userAdapterConfig.configContent ?? {}) }
      : {})
  }) as CursorAdapterConfig
}

export const toProcessEnv = (env: AdapterCtx['env']): NodeJS.ProcessEnv => (
  Object.fromEntries(
    Object.entries(mergeProcessEnvWithProjectEnv(env, {
      workspaceFolder: env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__?.trim() || undefined
    })).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
)

const readJsonRecord = async (filePath: string) => {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    return isRecord(value) ? value : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

const writeJson = async (filePath: string, value: unknown) => {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const resolveRealHome = (ctx: Pick<AdapterCtx, 'env'>) => (
  ctx.env.__ONEWORKS_PROJECT_REAL_HOME__?.trim() || process.env.__ONEWORKS_PROJECT_REAL_HOME__?.trim() ||
  process.env.HOME?.trim()
)

const syncRealHomeKeychains = async (ctx: Pick<AdapterCtx, 'env'>, sessionHome: string) => {
  const realHome = resolveRealHome(ctx)
  const targetPath = resolve(sessionHome, 'Library', 'Keychains')
  if (realHome == null || realHome === '') {
    await rm(targetPath, { recursive: true, force: true })
    return
  }
  await syncSymlinkTarget({
    sourcePath: resolve(realHome, 'Library', 'Keychains'),
    targetPath,
    type: 'dir',
    onMissingSource: 'remove'
  })
}

const ensureCursorSkills = async (
  options: AdapterQueryOptions,
  cursorDataDir: string
) => {
  const skillsDir = resolve(cursorDataDir, 'skills')
  await rm(skillsDir, { recursive: true, force: true })
  const skillOverlays = options.assetPlan?.overlays.filter(overlay => overlay.kind === 'skill') ?? []
  for (const overlay of skillOverlays) {
    const targetName = overlay.targetPath.replace(/^skills\//u, '')
    await syncSymlinkTarget({
      sourcePath: overlay.sourcePath,
      targetPath: resolve(skillsDir, targetName),
      type: 'dir'
    })
  }
}

const mapCursorMcpServer = (server: McpServerConfig) => {
  if ('command' in server) {
    return {
      command: server.command,
      ...(server.args != null ? { args: server.args } : {}),
      ...(server.env != null ? { env: server.env } : {})
    }
  }
  return {
    url: server.url,
    ...(server.headers != null ? { headers: server.headers } : {})
  }
}

const ensureCursorMcpConfig = async (options: AdapterQueryOptions, cursorDataDir: string) => {
  const mcpServers = options.assetPlan?.mcpServers ?? {}
  await writeJson(resolve(cursorDataDir, 'mcp.json'), {
    mcpServers: Object.fromEntries(
      Object.entries(mcpServers).map(([name, server]) => [name, mapCursorMcpServer(server)])
    )
  })
}

const ensureCursorSystemRule = async (options: AdapterQueryOptions, cursorDataDir: string) => {
  const rulePath = resolve(cursorDataDir, 'rules', 'oneworks-system.mdc')
  const systemPrompt = options.systemPrompt?.trim()
  if (!systemPrompt) {
    await rm(rulePath, { force: true })
    return
  }
  await mkdir(dirname(rulePath), { recursive: true })
  await writeFile(
    rulePath,
    `---\ndescription: One Works session instructions\nalwaysApply: true\n---\n\n${systemPrompt}\n`,
    'utf8'
  )
}

const ensureCursorCliConfig = async (params: {
  adapterConfig: CursorAdapterConfig
  ctx: AdapterCtx
  cursorDataDir: string
  options: AdapterQueryOptions
}) => {
  const realHome = resolveRealHome(params.ctx)
  const realConfig = realHome == null
    ? {}
    : await readJsonRecord(resolve(realHome, '.cursor', 'cli-config.json'))
  const existingConfig = await readJsonRecord(resolve(params.cursorDataDir, 'cli-config.json'))
  const config = deepMerge(deepMerge(realConfig, existingConfig), params.adapterConfig.configContent ?? {})
  await writeJson(resolve(params.cursorDataDir, 'cli-config.json'), config)

  const hooks = buildCursorNativeHooksConfig({ ctx: params.ctx, options: params.options })
  if (hooks != null) {
    await writeJson(resolve(params.cursorDataDir, 'hooks.json'), hooks)
  } else {
    await rm(resolve(params.cursorDataDir, 'hooks.json'), { force: true })
  }
}

export const normalizeCursorPrompt = (content: AdapterMessageContent[]) => (
  content.flatMap((item) => {
    if (item.type === 'text') return item.text.trim() === '' ? [] : [item.text]
    if (item.type === 'image') return [`[Image: ${item.path ?? item.name ?? item.url}]`]
    if (item.type === 'file') return [`[File: ${item.path}]`]
    if (item.type === 'tool_result') {
      return [
        `[Tool result ${item.tool_use_id}]: ${
          typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
        }`
      ]
    }
    return []
  }).join('\n\n').trim()
)

export const prepareCursorSessionRuntime = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions,
  adapterConfig: CursorAdapterConfig
) => {
  const sessionRoot = resolveProjectOoPath(ctx.cwd, ctx.env, 'caches', ctx.ctxId, options.sessionId, 'adapter-cursor')
  const sessionHome = resolve(sessionRoot, 'home')
  const cursorDataDir = resolve(sessionHome, '.cursor')
  const cursorStoreDir = resolve(sessionRoot, 'agent-store')

  await syncRealHomeKeychains(ctx, sessionHome)
  await ensureCursorSkills(options, cursorDataDir)
  await ensureCursorMcpConfig(options, cursorDataDir)
  await ensureCursorSystemRule(options, cursorDataDir)
  await ensureCursorCliConfig({ adapterConfig, ctx, cursorDataDir, options })

  return {
    cursorDataDir,
    cursorStoreDir,
    env: toProcessEnv({
      ...ctx.env,
      ...buildCursorNativeHookEnv({ ctx, options }),
      HOME: sessionHome,
      USERPROFILE: sessionHome,
      CURSOR_CONFIG_DIR: cursorDataDir,
      CURSOR_DATA_DIR: cursorDataDir,
      CURSOR_AGENT_STORE_DIR: cursorStoreDir
    })
  }
}

const pushListArgs = (args: string[], flag: string, values: string[] | undefined) => {
  for (const value of values ?? []) {
    if (value.trim() !== '') args.push(flag, value.trim())
  }
}

export const buildCursorArgs = (params: {
  adapterConfig: CursorAdapterConfig
  nativeSessionId?: string
  options: AdapterQueryOptions
  prompt?: string
  stream: boolean
}) => {
  const { adapterConfig, nativeSessionId, options, prompt, stream } = params
  const args: string[] = []
  if (stream) args.push('--print', '--output-format', 'stream-json', '--stream-partial-output')
  if (nativeSessionId != null) args.push('--resume', nativeSessionId)
  if (options.model != null && options.model !== 'default') args.push('--model', options.model)

  const mode = options.permissionMode === 'plan' ? 'plan' : adapterConfig.mode
  if (mode === 'plan' || mode === 'ask') args.push('--mode', mode)
  if (
    adapterConfig.force === true || options.permissionMode === 'bypassPermissions' ||
    options.permissionMode === 'dontAsk'
  ) {
    args.push('--force')
  } else if (adapterConfig.autoReview === true) {
    args.push('--auto-review')
  }
  if (adapterConfig.approveMcps === true) args.push('--approve-mcps')
  if (adapterConfig.sandbox != null) args.push('--sandbox', adapterConfig.sandbox)
  if (adapterConfig.endpoint?.trim()) args.push('--endpoint', adapterConfig.endpoint.trim())
  pushListArgs(args, '--header', adapterConfig.headers)
  pushListArgs(args, '--add-dir', adapterConfig.additionalDirs)
  pushListArgs(args, '--plugin-dir', adapterConfig.pluginDirs)
  if (stream) args.push('--trust')
  args.push(...(options.extraOptions ?? []))
  if (prompt != null && prompt !== '') args.push(prompt)
  return args
}

export const getErrorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error ?? 'Cursor session failed unexpectedly')
)
