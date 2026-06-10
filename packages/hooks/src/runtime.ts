import { Buffer } from 'node:buffer'
import process from 'node:process'

import { buildConfigJsonVariables, loadConfig, resetConfigCache } from '@oneworks/config'
import { createStartupProfiler, nowStartupMs } from '@oneworks/utils'
import { createLogger } from '@oneworks/utils/create-logger'
import { resolveServerLogLevel } from '@oneworks/utils/log-level'
import { mergePluginConfigs } from '@oneworks/utils/plugin-resolver'
import { transformCamelKey } from '@oneworks/utils/string-transform'

import { createBuiltinPermissionPlugin } from './builtin-permissions'
import { markHookRuntimeBootstrapProfile } from './hook-startup-profile'
import { resolvePlugins } from './loader'
import { callPluginHook } from './plugin-hook'
import type { HookInput, HookInputs, HookOutputCore } from './type'

export { callPluginHook } from './plugin-hook'

export const executeHookInput = async (
  input: HookInput,
  env: Record<string, string | null | undefined> = process.env
) => {
  const workspaceFolder = env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? input.cwd ?? process.env.HOME ?? '/'
  const ctxId = env.__ONEWORKS_PROJECT_CTX_ID__ ?? input.sessionId ?? 'default'
  const logPrefix = env.__ONEWORKS_PROJECT_LOG_PREFIX__ ?? ''
  const loggerBase = createLogger(
    workspaceFolder,
    ctxId,
    input.sessionId,
    logPrefix,
    resolveServerLogLevel(env),
    env as NodeJS.ProcessEnv
  )

  const logger: typeof loggerBase = {
    ...loggerBase,
    info: (...args) => loggerBase.info(`[${input.hookEventName}]`, ...args),
    warn: (...args) => loggerBase.warn(`[${input.hookEventName}]`, ...args),
    debug: (...args) => loggerBase.debug(`[${input.hookEventName}]`, ...args),
    error: (...args) => loggerBase.error(`[${input.hookEventName}]`, ...args)
  }

  const startupProfiler = createStartupProfiler({
    cwd: workspaceFolder,
    env,
    ctxId,
    sessionId: input.sessionId
  })
  const resetConfigStartedAt = startupProfiler.now()
  resetConfigCache(workspaceFolder)
  startupProfiler.mark(`hook.${input.hookEventName}.resetConfigCache`, resetConfigStartedAt)

  const buildVariablesStartedAt = startupProfiler.now()
  const jsonVariables = buildConfigJsonVariables(workspaceFolder, env)
  startupProfiler.mark(`hook.${input.hookEventName}.buildConfigJsonVariables`, buildVariablesStartedAt, {
    count: Object.keys(jsonVariables).length
  })

  const loadConfigStartedAt = startupProfiler.now()
  const [config, userConfig] = await loadConfig({
    cwd: workspaceFolder,
    env,
    jsonVariables
  })
  startupProfiler.mark(`hook.${input.hookEventName}.loadConfig`, loadConfigStartedAt)

  const mergePluginConfigStartedAt = startupProfiler.now()
  const pluginConfig = mergePluginConfigs(config?.plugins, userConfig?.plugins)
  startupProfiler.mark(`hook.${input.hookEventName}.mergePluginConfig`, mergePluginConfigStartedAt, {
    count: pluginConfig?.length ?? 0
  })

  const resolvePluginsStartedAt = startupProfiler.now()
  const builtinPermissionPluginStartedAt = startupProfiler.now()
  const builtinPermissionPlugin = createBuiltinPermissionPlugin(env)
  startupProfiler.mark(
    `hook.${input.hookEventName}.resolvePlugins.createBuiltinPermissionPlugin`,
    builtinPermissionPluginStartedAt
  )
  const plugins = [
    builtinPermissionPlugin,
    ...await resolvePlugins(workspaceFolder, pluginConfig, {
      env,
      profiler: startupProfiler,
      profilePrefix: `hook.${input.hookEventName}.resolvePlugins`
    })
  ]
  startupProfiler.mark(`hook.${input.hookEventName}.resolvePlugins`, resolvePluginsStartedAt, {
    count: plugins.length
  })

  const callPluginsStartedAt = startupProfiler.now()
  const output = await callPluginHook(
    input.hookEventName as keyof HookInputs,
    { logger },
    input as never,
    plugins,
    {
      profiler: startupProfiler,
      profilePrefix: `hook.${input.hookEventName}`
    }
  )
  startupProfiler.mark(`hook.${input.hookEventName}.callPlugins`, callPluginsStartedAt, {
    count: plugins.length
  })
  return output
}

export const readHookInputBuffer = async () => (
  await new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', chunk => chunks.push(chunk))
    process.stdin.once('end', () => resolve(Buffer.concat(chunks)))
  })
)

export const parseHookInput = (stdoutBuffer: Buffer) => (
  transformCamelKey<HookInput>(
    JSON.parse(stdoutBuffer.toString() || '{}')
  )
)

export const readHookInput = async () => {
  const stdoutBuffer = await readHookInputBuffer()
  return parseHookInput(stdoutBuffer)
}

export const runHookCli = async () => {
  try {
    const readInputStartedAt = nowStartupMs()
    const inputBuffer = await readHookInputBuffer()
    const readInputFinishedAtEpochMs = Date.now()
    const readInputDurationMs = nowStartupMs() - readInputStartedAt
    const parseInputStartedAt = nowStartupMs()
    const input = parseHookInput(inputBuffer)
    const parseInputDurationMs = nowStartupMs() - parseInputStartedAt
    const startupProfiler = createStartupProfiler({
      cwd: process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? input.cwd ?? process.cwd(),
      env: process.env,
      ctxId: process.env.__ONEWORKS_PROJECT_CTX_ID__ ?? input.sessionId,
      sessionId: input.sessionId
    })
    markHookRuntimeBootstrapProfile(startupProfiler, {
      eventName: input.hookEventName,
      inputBytes: inputBuffer.length,
      parseInputDurationMs,
      readInputDurationMs,
      readInputFinishedAtEpochMs
    })

    const executeStartedAt = startupProfiler.now()
    const result = await executeHookInput(input)
    startupProfiler.mark(`hook.${input.hookEventName}.runtime.execute`, executeStartedAt)

    const writeOutputStartedAt = startupProfiler.now()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    startupProfiler.mark(`hook.${input.hookEventName}.runtime.writeOutput`, writeOutputStartedAt)
  } catch (error) {
    process.stdout.write(
      `${
        JSON.stringify(
          {
            continue: false,
            stopReason: `run hook error: ${String(error)}`
          } satisfies HookOutputCore
        )
      }\n`
    )
  }
}
