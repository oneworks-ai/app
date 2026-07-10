/* eslint-disable max-lines -- server runtime consumer startup keeps spawn policy and env sanitation together */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import type { RuntimeCommand, RuntimeHeartbeat } from '@oneworks/runtime-protocol'
import { resolveAdapterPackageName, resolveExistingAdapterPackageCacheDir } from '@oneworks/types'
import { resolveProjectOoBaseDir } from '@oneworks/utils'

import { createChannelRuntimeEnv, normalizeChannelRuntimeContext } from '#~/services/session/channel-context.js'
import { logger } from '#~/utils/logger.js'

import type { RuntimeSessionMetadata, RuntimeSessionState, RuntimeSessionStore } from './types.js'
import { createWorkspaceRuntimeEnv } from './workspace-env.js'

const nodeRequire = createRequire(__filename)

const PENDING_RUNTIME_ID = 'pending_engine_consumer'
const RUNTIME_SYSTEM_PROMPT_FILENAME = 'system-prompt.txt'

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'crashed',
  'stopped',
  'cancelled',
  'killed'
])

const CODEX_PARENT_RUNTIME_ENV_KEYS = [
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
  'CODEX_THREAD_ID',
  'CODEX_SHELL',
  '__ONEWORKS_CODEX_HOOK_RUNTIME__',
  '__ONEWORKS_CODEX_TASK_SESSION_ID__',
  '__ONEWORKS_CODEX_HOOKS_ACTIVE__',
  '__ONEWORKS_HOOK_BRIDGE_ADAPTER__'
] as const
const PROJECT_OO_BASE_DIR_ENV = '__ONEWORKS_PROJECT_BASE_DIR__'
const PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV = '__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__'
const PROJECT_LAUNCH_CWD_ENV = '__ONEWORKS_PROJECT_LAUNCH_CWD__'
const PROJECT_WORKSPACE_FOLDER_ENV = '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__'
const RUNTIME_CONSUMER_RUN_COMMAND = '__run'
const DEFAULT_RUNTIME_CONSUMER_PRINT_IDLE_TIMEOUT_SECONDS = 180
const CONSUMER_RESTART_COMMAND_TYPES = new Set([
  'send_message',
  'steer_message',
  'submit_input',
  'approve',
  'deny',
  'resume'
])

const isPathInside = (parentPath: string, targetPath: string) => {
  const relativePath = path.relative(parentPath, targetPath)
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

const resolveRuntimeProjectOoBaseDir = (cwd: string, env: NodeJS.ProcessEnv) => {
  const workspaceFolder = path.resolve(cwd)
  const aiBaseDir = env[PROJECT_OO_BASE_DIR_ENV]?.trim()
  const aiBaseDirSourceCwd = env[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV]?.trim()
  const pathEnv: NodeJS.ProcessEnv = {
    ...env,
    [PROJECT_LAUNCH_CWD_ENV]: workspaceFolder,
    [PROJECT_WORKSPACE_FOLDER_ENV]: workspaceFolder
  }

  if (
    aiBaseDir != null &&
    aiBaseDir !== '' &&
    path.isAbsolute(aiBaseDir) &&
    !isPathInside(workspaceFolder, path.resolve(aiBaseDir))
  ) {
    delete pathEnv[PROJECT_OO_BASE_DIR_ENV]
    delete pathEnv[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV]
  } else if (
    aiBaseDirSourceCwd == null ||
    aiBaseDirSourceCwd === '' ||
    !isPathInside(workspaceFolder, path.resolve(aiBaseDirSourceCwd))
  ) {
    pathEnv[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV] = workspaceFolder
  }

  return resolveProjectOoBaseDir(workspaceFolder, pathEnv)
}

export interface RuntimeConsumerStartCommand {
  account?: string
  adapter?: string
  effort?: string
  fastMode?: boolean
  entity?: string
  messageDelivery?: string
  message?: string
  model?: string
  permissionMode?: string
  promptName?: string
  promptType?: string
  systemPrompt?: string
  ts?: number
  type?: string
  updateConfiguredSkills?: boolean
}

export interface RuntimeConsumerQueuedCommand {
  account?: string
  adapter?: string
  effort?: string
  fastMode?: boolean
  entity?: string
  messageDelivery?: string
  message?: string
  model?: string
  permissionMode?: string
  promptName?: string
  promptType?: string
  systemPrompt?: string
  ts?: number
  type: string
  updateConfiguredSkills?: boolean
}

export interface RuntimeConsumerSpawnPlan {
  args: string[]
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined
)

const readBoolean = (value: unknown) => typeof value === 'boolean' ? value : undefined

const errorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error)
)

const isTerminalStatus = (status: unknown) => typeof status === 'string' && TERMINAL_STATUSES.has(status)

const sanitizeRuntimeConsumerEnv = (env: NodeJS.ProcessEnv) => {
  const nextEnv = { ...env }
  for (const key of CODEX_PARENT_RUNTIME_ENV_KEYS) {
    delete nextEnv[key]
  }
  return nextEnv
}

const SUPPORTED_CODEX_SERVICE_TIERS = new Set(['fast', 'flex'])
const CODEX_SERVICE_TIER_COMPATIBILITY_REPLACEMENTS = new Map([
  ['priority', 'fast']
])

const normalizeCodexServiceTierLineForCli = (line: string) => {
  const match = /^(\s*)service_tier(\s*=\s*)(["'])([^"']+)\3(\s*(?:#.*)?)$/.exec(line)
  if (match == null) return line

  const [, indent, assignment, quote, value, suffix] = match
  if (SUPPORTED_CODEX_SERVICE_TIERS.has(value)) return line

  const replacement = CODEX_SERVICE_TIER_COMPATIBILITY_REPLACEMENTS.get(value)
  if (replacement != null) {
    return `${indent}service_tier${assignment}${quote}${replacement}${quote}${suffix}`
  }

  return `${indent}# One Works removed unsupported Codex service_tier ${quote}${value}${quote}${suffix}`
}

export const normalizeRuntimeConsumerCodexConfigCompatibility = (content: string) => {
  const lines = content.split('\n')
  let changed = false
  const normalizedLines = lines.map(line => {
    const normalizedLine = normalizeCodexServiceTierLineForCli(line)
    if (normalizedLine !== line) {
      changed = true
    }
    return normalizedLine
  })

  return changed ? normalizedLines.join('\n') : content
}

export const ensureRuntimeConsumerCodexConfigCliCompatibility = async (params: {
  adapter?: string
  env: NodeJS.ProcessEnv
}) => {
  const adapter = readString(params.adapter ?? params.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_ADAPTER__)
  if (adapter !== 'codex') return false

  const homeDir = readString(params.env.HOME)
  if (homeDir == null) return false

  const configPath = path.join(homeDir, '.codex', 'config.toml')
  let content: string
  try {
    content = await readFile(configPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }

  const normalizedContent = normalizeRuntimeConsumerCodexConfigCompatibility(content)
  if (normalizedContent === content) return false

  await writeFile(configPath, normalizedContent)
  return true
}

const pushOption = (args: string[], flag: string, value: string | undefined) => {
  if (value != null) {
    args.push(flag, value)
  }
}

const parsePositiveInteger = (value: string | undefined) => {
  const trimmed = value?.trim()
  if (trimmed == null || trimmed === '' || !/^\d+$/.test(trimmed)) {
    return undefined
  }
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

const resolveRuntimeConsumerPrintIdleTimeoutSeconds = (env: NodeJS.ProcessEnv) =>
  parsePositiveInteger(env.ONEWORKS_RUNTIME_CONSUMER_PRINT_IDLE_TIMEOUT_SECONDS) ??
    DEFAULT_RUNTIME_CONSUMER_PRINT_IDLE_TIMEOUT_SECONDS

const pushPromptTargetOptions = (args: string[], promptType: string | undefined, promptName: string | undefined) => {
  if (promptType === 'entity') {
    pushOption(args, '--entity', promptName)
  } else if (promptType === 'spec') {
    pushOption(args, '--spec', promptName)
  } else if (promptType === 'workspace') {
    pushOption(args, '--workspace', promptName)
  }
}

const readRuntimeConsumerCommandFields = (command: RuntimeCommand): RuntimeConsumerStartCommand => ({
  account: readString(command.account),
  adapter: readString(command.adapter),
  effort: readString(command.effort),
  fastMode: readBoolean(command.fastMode),
  entity: readString(command.entity),
  message: readString(command.content) ?? readString(command.message),
  messageDelivery: readString(command.messageDelivery),
  model: readString(command.model),
  permissionMode: readString(command.permissionMode),
  ...(readString(command.name) != null ? { promptName: readString(command.name) } : {}),
  ...(readString(command.taskType) != null ? { promptType: readString(command.taskType) } : {}),
  ...(readString(command.systemPrompt) != null ? { systemPrompt: readString(command.systemPrompt) } : {}),
  ...(typeof command.ts === 'number' ? { ts: command.ts } : {}),
  type: command.type,
  ...(readBoolean(command.updateConfiguredSkills) != null
    ? { updateConfiguredSkills: readBoolean(command.updateConfiguredSkills) }
    : {})
})

export async function readRuntimeConsumerStartCommand(
  commandsPath: string
): Promise<RuntimeConsumerStartCommand | undefined> {
  let content: string
  try {
    content = await readFile(commandsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed) as unknown
    } catch {
      continue
    }

    if (!isRecord(parsed) || parsed.type !== 'start') {
      continue
    }

    const command = parsed as RuntimeCommand
    return readRuntimeConsumerCommandFields(command)
  }

  return undefined
}

export async function readLatestRuntimeConsumerQueuedCommand(
  commandsPath: string
): Promise<RuntimeConsumerQueuedCommand | undefined> {
  let content: string
  try {
    content = await readFile(commandsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }

  let latest: RuntimeConsumerQueuedCommand | undefined
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed) as unknown
    } catch {
      continue
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string' || parsed.type === 'start') {
      continue
    }

    const command = parsed as RuntimeCommand
    const candidate = readRuntimeConsumerCommandFields(command) as RuntimeConsumerQueuedCommand
    if (latest == null || (candidate.ts ?? 0) >= (latest.ts ?? 0)) {
      latest = candidate
    }
  }

  return latest
}

export async function readRuntimeConsumerHeartbeat(
  store: RuntimeSessionStore
): Promise<RuntimeHeartbeat | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path.join(store.storePath, 'heartbeat.json'), 'utf8')) as unknown
    if (!isRecord(parsed)) {
      return undefined
    }
    return parsed as RuntimeHeartbeat
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

export function shouldStartServerRuntimeConsumer(params: {
  heartbeat?: RuntimeHeartbeat
  metadata?: RuntimeSessionMetadata
  queuedCommand?: RuntimeConsumerQueuedCommand
  state?: RuntimeSessionState
}) {
  if (params.metadata?.needsEngineConsumer !== true) {
    return false
  }
  const latestTerminalUpdatedAt = Math.max(
    typeof params.state?.updatedAt === 'number' && isTerminalStatus(params.state.status) ? params.state.updatedAt : 0,
    typeof params.heartbeat?.updatedAt === 'number' && isTerminalStatus(params.heartbeat.status)
      ? params.heartbeat.updatedAt
      : 0
  )
  const hasQueuedCommandAfterTerminal = params.queuedCommand != null &&
    CONSUMER_RESTART_COMMAND_TYPES.has(params.queuedCommand.type) &&
    params.queuedCommand.ts != null &&
    params.queuedCommand.ts > latestTerminalUpdatedAt
  if (
    (isTerminalStatus(params.state?.status) || isTerminalStatus(params.heartbeat?.status)) &&
    !hasQueuedCommandAfterTerminal
  ) {
    return false
  }
  const runtimeId = readString(params.heartbeat?.runtimeId)
  return hasQueuedCommandAfterTerminal || runtimeId == null || runtimeId === PENDING_RUNTIME_ID
}

const isPathLikeCommand = (command: string) => (
  path.isAbsolute(command) || command.includes('/') || command.includes('\\')
)

const isNodeEntrypoint = (entrypoint: string) => /\.(?:c|m)?js$/i.test(entrypoint)

const resolveNodeEntrypoint = (entrypoint: string) => ({
  args: [entrypoint],
  command: process.execPath
})

const resolvePathCommand = (command: string, env: NodeJS.ProcessEnv) => {
  const pathValue = env.PATH ?? env.Path ?? env.path
  if (pathValue == null || pathValue.trim() === '') {
    return undefined
  }

  const extensions = process.platform === 'win32'
    ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : ['']
  for (const directory of pathValue.split(path.delimiter)) {
    if (directory.trim() === '') {
      continue
    }

    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }

  return undefined
}

const resolveCliTarget = (target: string) => (
  isNodeEntrypoint(target)
    ? resolveNodeEntrypoint(target)
    : { args: [], command: target }
)

const readInstalledPackageVersion = (packageJsonPath: string) => {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

const resolveBundledCliTarget = () => {
  try {
    const packageJsonPath = nodeRequire.resolve('@oneworks/cli/package.json')
    return {
      target: resolveNodeEntrypoint(path.join(path.dirname(packageJsonPath), 'cli.js')),
      version: readInstalledPackageVersion(packageJsonPath)
    }
  } catch {
    return undefined
  }
}

const splitAdapterVersionSelector = (value: string) => {
  const lastAt = value.lastIndexOf('@')
  if (lastAt <= 0) {
    return value
  }

  if (value.startsWith('@')) {
    const slash = value.indexOf('/')
    if (slash < 0 || lastAt <= slash) {
      return value
    }
  }

  return value.slice(0, lastAt)
}

const resolveAdapterPackageNameForRuntime = (adapter: string) =>
  resolveAdapterPackageName(splitAdapterVersionSelector(adapter))

const hasAdapterPackageInRuntimePackageDir = (runtimePackageDir: string, adapter: string) => {
  const packageName = resolveAdapterPackageNameForRuntime(adapter)
  const packageJsonPath = path.join(runtimePackageDir, 'node_modules', ...packageName.split('/'), 'package.json')
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: unknown }
    return parsed.name === packageName
  } catch {
    return false
  }
}

const readWorkspaceCliVersion = (cwd: string) =>
  readInstalledPackageVersion(path.join(cwd, 'node_modules', '@oneworks', 'cli', 'package.json')) ??
    readInstalledPackageVersion(path.join(cwd, 'apps', 'cli', 'package.json'))

const shouldUseWorkspaceCli = (cwd: string, bundledCli: ReturnType<typeof resolveBundledCliTarget>) => {
  const bundledVersion = bundledCli?.version
  const workspaceVersion = readWorkspaceCliVersion(cwd)
  return bundledCli == null || bundledVersion == null || workspaceVersion == null || workspaceVersion === bundledVersion
}

const resolveExistingRuntimeAdapterPackageCacheDir = (adapter: string, env: NodeJS.ProcessEnv) => {
  const packageName = resolveAdapterPackageNameForRuntime(adapter)
  return resolveExistingAdapterPackageCacheDir(packageName, env)
}

const resolveRuntimeConsumerCli = (cwd: string, env: NodeJS.ProcessEnv) => {
  const override = readString(env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__)
  if (override != null) {
    return resolveCliTarget(override)
  }

  const bundledCli = resolveBundledCliTarget()
  const workspaceBin = path.join(cwd, 'node_modules', '.bin', 'oneworks')
  if (existsSync(workspaceBin)) {
    if (!shouldUseWorkspaceCli(cwd, bundledCli) && bundledCli != null) {
      return bundledCli.target
    }
    return { args: [], command: workspaceBin }
  }

  const sourceEntrypoint = path.join(cwd, 'apps', 'cli', 'cli.js')
  if (existsSync(sourceEntrypoint)) {
    if (!shouldUseWorkspaceCli(cwd, bundledCli) && bundledCli != null) {
      return bundledCli.target
    }
    return resolveNodeEntrypoint(sourceEntrypoint)
  }

  for (const bootstrapCommand of ['oneworks', 'ow', 'owo']) {
    const bootstrapPath = resolvePathCommand(bootstrapCommand, env)
    if (bootstrapPath != null) {
      return { args: [], command: bootstrapPath }
    }
  }

  const fallbackBootstrap = readString(env.__ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__)
  if (fallbackBootstrap != null) {
    return resolveCliTarget(fallbackBootstrap)
  }

  const pathCommand = resolvePathCommand('oneworks', env)
  if (pathCommand != null) {
    return { args: [], command: pathCommand }
  }

  const fallback = readString(env.__ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_CLI_PATH__)
  if (fallback != null) {
    return resolveCliTarget(fallback)
  }

  try {
    const packageJsonPath = nodeRequire.resolve('oneworks/package.json')
    return resolveNodeEntrypoint(path.join(path.dirname(packageJsonPath), 'cli.js'))
  } catch {
    // Ignore and continue to bundled CLI fallback.
  }

  if (bundledCli != null) {
    return bundledCli.target
  }
  return { args: [], command: 'oneworks' }
}

const findMissingSpawnPath = (plan: RuntimeConsumerSpawnPlan) => {
  const entrypoint = readString(plan.args[0])
  if (
    plan.command === process.execPath && entrypoint != null && isPathLikeCommand(entrypoint) && !existsSync(entrypoint)
  ) {
    return entrypoint
  }
  if (isPathLikeCommand(plan.command) && !existsSync(plan.command)) {
    return plan.command
  }
  return undefined
}

const readExistingRuntimeState = async (statePath: string): Promise<RuntimeSessionState | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as unknown
    return isRecord(parsed) ? parsed as RuntimeSessionState : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

const getLatestTerminalUpdatedAt = (
  state: RuntimeSessionState | undefined,
  heartbeat: RuntimeHeartbeat | undefined
) =>
  Math.max(
    typeof state?.updatedAt === 'number' && isTerminalStatus(state.status) ? state.updatedAt : 0,
    typeof heartbeat?.updatedAt === 'number' && isTerminalStatus(heartbeat.status) ? heartbeat.updatedAt : 0
  )

const isMessageCommand = (command: RuntimeConsumerStartCommand | undefined) =>
  command?.type === 'resume' || command?.type === 'send_message'

const isBridgeDeliveredCommand = (command: RuntimeConsumerStartCommand) =>
  command.messageDelivery === 'bridge' || command.type === 'resume' || command.type === 'send_message'

const writeRuntimeConsumerStartFailure = async (params: {
  error: unknown
  metadata: RuntimeSessionMetadata
  store: RuntimeSessionStore
}) => {
  const now = Date.now()
  const message = errorMessage(params.error)
  const existingState = await readExistingRuntimeState(params.store.statePath)
  const protocolVersion = readString(existingState?.protocolVersion) ?? '1.0.0'

  await Promise.all([
    writeFile(
      params.store.statePath,
      `${
        JSON.stringify(
          {
            ...existingState,
            protocolVersion,
            sessionId: params.metadata.sessionId,
            status: 'failed',
            title: existingState?.title ?? readString(params.metadata.title),
            lastSeq: typeof existingState?.lastSeq === 'number' ? existingState.lastSeq : 0,
            lastMessage: message,
            error: message,
            updatedAt: now
          },
          null,
          2
        )
      }\n`
    ),
    writeFile(
      path.join(params.store.storePath, 'heartbeat.json'),
      `${
        JSON.stringify(
          {
            protocolVersion,
            sessionId: params.metadata.sessionId,
            runtimeId: PENDING_RUNTIME_ID,
            status: 'failed',
            error: message,
            updatedAt: now
          },
          null,
          2
        )
      }\n`
    )
  ])
}

const writeRuntimeConsumerExitFailureIfPending = async (params: {
  code: number | null
  metadata: RuntimeSessionMetadata
  signal: NodeJS.Signals | null
  store: RuntimeSessionStore
}) => {
  const [state, heartbeat] = await Promise.all([
    readExistingRuntimeState(params.store.statePath),
    readRuntimeConsumerHeartbeat(params.store)
  ])
  if (isTerminalStatus(state?.status) || isTerminalStatus(heartbeat?.status)) {
    return
  }

  const runtimeId = readString(heartbeat?.runtimeId)
  if (runtimeId != null && runtimeId !== PENDING_RUNTIME_ID) {
    return
  }

  const exitSummary = params.signal == null
    ? `Runtime consumer exited before startup completed with code ${params.code ?? 'unknown'}.`
    : `Runtime consumer exited before startup completed with signal ${params.signal}.`

  await writeRuntimeConsumerStartFailure({
    error: new Error(exitSummary),
    metadata: params.metadata,
    store: params.store
  })
}

export function buildRuntimeConsumerSpawnPlan(params: {
  baseEnv?: NodeJS.ProcessEnv
  command: RuntimeConsumerStartCommand
  cwd: string
  launchMode?: 'create' | 'resume'
  metadata: RuntimeSessionMetadata
  store: RuntimeSessionStore
}): RuntimeConsumerSpawnPlan {
  const rawBaseEnv = params.baseEnv ?? process.env
  const cwd = readString(params.metadata.cwd) ?? params.cwd
  const baseEnv = createWorkspaceRuntimeEnv(cwd, rawBaseEnv)
  const sessionId = params.metadata.sessionId
  const entity = params.command.entity ?? readString(params.metadata.entity)
  const adapter = params.command.adapter ?? readString(params.metadata.adapter)
  const promptType = params.command.promptType ?? readString(params.metadata.promptType)
  const promptName = params.command.promptName ?? readString(params.metadata.promptName)
  const message = params.command.message
  const launchMode = params.launchMode ?? 'create'
  const shouldPassInitialPrompt = !isBridgeDeliveredCommand(params.command)
  if (shouldPassInitialPrompt && message == null) {
    throw new Error(`Runtime session ${sessionId} is missing a start message.`)
  }

  const cli = resolveRuntimeConsumerCli(cwd, baseEnv)
  const existingCliPackageDir = readString(baseEnv.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__)
  const existingCliPackageHasAdapter = adapter != null &&
    existingCliPackageDir != null &&
    hasAdapterPackageInRuntimePackageDir(existingCliPackageDir, adapter)
  const workspacePackageDir = adapter != null &&
      !existingCliPackageHasAdapter &&
      hasAdapterPackageInRuntimePackageDir(cwd, adapter)
    ? cwd
    : undefined
  const adapterPackageDir = adapter != null &&
      !existingCliPackageHasAdapter
    ? workspacePackageDir ?? resolveExistingRuntimeAdapterPackageCacheDir(adapter, baseEnv)
    : undefined
  const shouldClearInheritedCliPackageDir = adapter != null &&
    adapterPackageDir == null &&
    existingCliPackageDir != null &&
    !existingCliPackageHasAdapter
  const args = [
    ...cli.args,
    RUNTIME_CONSUMER_RUN_COMMAND,
    '--print',
    '--output-format',
    'stream-json',
    '--print-idle-timeout',
    String(resolveRuntimeConsumerPrintIdleTimeoutSeconds(baseEnv))
  ]
  if (launchMode === 'resume') {
    args.push('--resume', sessionId)
  } else {
    args.push('--session-id', sessionId)
    if (entity != null) {
      pushOption(args, '--entity', entity)
    } else {
      pushPromptTargetOptions(args, promptType, promptName)
    }
    pushOption(args, '--adapter', adapter)
    pushOption(args, '--account', params.command.account ?? readString(params.metadata.account))
    if (params.command.updateConfiguredSkills === true || params.metadata.updateConfiguredSkills === true) {
      args.push('--update-skills')
    }
  }
  pushOption(args, '--model', params.command.model ?? readString(params.metadata.model))
  pushOption(args, '--effort', params.command.effort ?? readString(params.metadata.effort))
  const fastMode = params.command.fastMode ?? readBoolean(params.metadata.fastMode)
  if (fastMode != null) {
    pushOption(args, '--fast-mode', fastMode ? 'on' : 'off')
  }
  pushOption(
    args,
    '--permission-mode',
    params.command.permissionMode ?? readString(params.metadata.permissionMode)
  )
  if (shouldPassInitialPrompt && message != null) {
    args.push(message)
  }

  const systemPromptPath = path.join(params.store.storePath, RUNTIME_SYSTEM_PROMPT_FILENAME)
  const systemPromptFile = (
      params.command.systemPrompt != null ||
      readString(params.metadata.systemPrompt) != null
    ) && existsSync(systemPromptPath)
    ? systemPromptPath
    : undefined
  const runtimeEnv = {
    ...baseEnv,
    ...createChannelRuntimeEnv({
      sessionId,
      cwd,
      env: baseEnv,
      context: normalizeChannelRuntimeContext(params.metadata.channelContext)
    }),
    __ONEWORKS_PROJECT_BASE_DIR__: resolveRuntimeProjectOoBaseDir(cwd, baseEnv),
    __ONEWORKS_PROJECT_CTX_ID__: readString(params.metadata.hostSessionId) ??
      readString(params.metadata.parentSessionId) ??
      sessionId,
    __ONEWORKS_PROJECT_LAUNCH_CWD__: cwd,
    __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: cwd,
    __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: cwd,
    ...(adapterPackageDir != null ? { __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: adapterPackageDir } : {}),
    __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER__: '1',
    ...(adapter != null ? { __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_ADAPTER__: adapter } : {}),
    __ONEWORKS_RUNTIME_PROTOCOL_SESSION_ID__: sessionId,
    ...(systemPromptFile != null ? { __ONEWORKS_RUNTIME_PROTOCOL_SYSTEM_PROMPT_FILE__: systemPromptFile } : {}),
    __ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__: readString(params.metadata.hostSessionId) ?? '',
    __ONEWORKS_AGENT_ROOM_ID__: readString(params.metadata.roomId) ?? '',
    __ONEWORKS_AGENT_ROOM_TITLE__: readString(params.metadata.roomTitle) ?? ''
  }
  if (shouldClearInheritedCliPackageDir) {
    delete runtimeEnv.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__
  }
  const env = sanitizeRuntimeConsumerEnv(runtimeEnv)

  return {
    args,
    command: cli.command,
    cwd,
    env
  }
}

export async function startServerRuntimeConsumer(params: {
  baseEnv?: NodeJS.ProcessEnv
  metadata: RuntimeSessionMetadata
  store: RuntimeSessionStore
}): Promise<ChildProcess | undefined> {
  const startCommand = await readRuntimeConsumerStartCommand(params.store.commandsPath)
  const [queuedCommand, state, heartbeat] = await Promise.all([
    readLatestRuntimeConsumerQueuedCommand(params.store.commandsPath),
    readExistingRuntimeState(params.store.statePath),
    readRuntimeConsumerHeartbeat(params.store)
  ])
  const latestTerminalUpdatedAt = getLatestTerminalUpdatedAt(state, heartbeat)
  const hasQueuedCommandAfterTerminal = queuedCommand?.ts != null && queuedCommand.ts > latestTerminalUpdatedAt
  const shouldResumeTerminalSession = startCommand != null &&
    hasQueuedCommandAfterTerminal &&
    isMessageCommand(queuedCommand)
  const activationCommand = shouldResumeTerminalSession
    ? queuedCommand
    : startCommand ?? (isMessageCommand(queuedCommand) ? queuedCommand : undefined)
  const launchMode = shouldResumeTerminalSession ? 'resume' : 'create'
  if (activationCommand == null) {
    return undefined
  }

  let plan: RuntimeConsumerSpawnPlan
  try {
    plan = buildRuntimeConsumerSpawnPlan({
      baseEnv: params.baseEnv,
      command: activationCommand,
      cwd: params.metadata.cwd ?? process.cwd(),
      launchMode,
      metadata: params.metadata,
      store: params.store
    })

    try {
      await ensureRuntimeConsumerCodexConfigCliCompatibility({
        adapter: readString(plan.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_ADAPTER__),
        env: plan.env
      })
    } catch (error) {
      logger.warn({
        error: errorMessage(error),
        sessionId: params.metadata.sessionId
      }, '[runtime-store] Failed to normalize Codex config before starting server runtime consumer')
    }

    const missingSpawnPath = findMissingSpawnPath(plan)
    if (missingSpawnPath != null) {
      throw new Error(`Runtime consumer CLI path does not exist: ${missingSpawnPath}`)
    }
  } catch (error) {
    await writeRuntimeConsumerStartFailure({
      error,
      metadata: params.metadata,
      store: params.store
    })
    logger.warn({
      error: errorMessage(error),
      sessionId: params.metadata.sessionId
    }, '[runtime-store] Failed to prepare server runtime consumer')
    return undefined
  }

  logger.info({
    sessionId: params.metadata.sessionId,
    command: plan.command,
    cwd: plan.cwd
  }, '[runtime-store] Starting server runtime consumer')

  let child: ChildProcess
  try {
    child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      detached: true,
      env: plan.env,
      stdio: 'ignore'
    })
  } catch (error) {
    await writeRuntimeConsumerStartFailure({
      error,
      metadata: params.metadata,
      store: params.store
    })
    logger.warn({
      error: errorMessage(error),
      sessionId: params.metadata.sessionId
    }, '[runtime-store] Failed to spawn server runtime consumer')
    return undefined
  }

  child.once('error', error => {
    void writeRuntimeConsumerStartFailure({
      error,
      metadata: params.metadata,
      store: params.store
    }).catch(writeError => {
      logger.warn({
        error: errorMessage(writeError),
        sessionId: params.metadata.sessionId
      }, '[runtime-store] Failed to persist runtime consumer spawn error')
    })
    logger.warn({
      error: errorMessage(error),
      sessionId: params.metadata.sessionId
    }, '[runtime-store] Server runtime consumer spawn failed')
  })

  child.once('exit', (code, signal) => {
    void writeRuntimeConsumerExitFailureIfPending({
      code,
      metadata: params.metadata,
      signal,
      store: params.store
    }).catch(error => {
      logger.warn({
        error: errorMessage(error),
        sessionId: params.metadata.sessionId
      }, '[runtime-store] Failed to persist runtime consumer exit error')
    })
  })

  return child
}
