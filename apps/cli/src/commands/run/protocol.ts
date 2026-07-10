/* eslint-disable max-lines -- protocol command dispatch handles every runtime envelope type in one place */
import { spawn } from 'node:child_process'
import process from 'node:process'

import type { RuntimeSessionCommandEnvelope, RuntimeSessionResultEnvelope } from '@oneworks/runtime-protocol'
import { mergeProcessEnvWithProjectEnv } from '@oneworks/utils'

import {
  appendRuntimeCommand,
  createRuntimeSession,
  readRuntimeEvents,
  readRuntimeStatus
} from '../agent/runtime-store'
import {
  fallbackProtocolCommand,
  parseRuntimeProtocolCommand,
  requiredString,
  toErrorResult,
  toSuccessResult
} from './protocol-envelope'

export interface ExecuteRuntimeProtocolCommandOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  now?: () => number
}

const trimOptional = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized == null || normalized === '' ? undefined : normalized
}

const optionalString = (value: unknown) =>
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined

const RUNTIME_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
const RUNTIME_PERMISSION_MODES = new Set(['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'])
const RUNTIME_RESUME_CONSUMER_STATUSES = new Set([
  'completed',
  'failed',
  'crashed',
  'stopped',
  'cancelled',
  'killed'
])

const optionalEffort = (value: unknown): RuntimeSessionCommandEnvelope['effort'] => {
  const normalized = optionalString(value)
  return normalized != null && RUNTIME_EFFORTS.has(normalized)
    ? normalized as RuntimeSessionCommandEnvelope['effort']
    : undefined
}

const optionalPermissionMode = (value: unknown): RuntimeSessionCommandEnvelope['permissionMode'] => {
  const normalized = optionalString(value)
  return normalized != null && RUNTIME_PERMISSION_MODES.has(normalized)
    ? normalized as RuntimeSessionCommandEnvelope['permissionMode']
    : undefined
}

const envDefault = (env: NodeJS.ProcessEnv | undefined, key: string) => trimOptional(env?.[key])

const pushOption = (args: string[], flag: string, value: string | undefined) => {
  if (value != null) {
    args.push(flag, value)
  }
}

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

const shouldDeferRuntimeConsumerToServer = (
  command: RuntimeSessionCommandEnvelope,
  env: NodeJS.ProcessEnv | undefined
) =>
  (
    trimOptional(command.hostSessionId) != null ||
    trimOptional(command.roomId) != null ||
    trimOptional(env?.__ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__) != null
  ) &&
  (
    trimOptional(env?.__ONEWORKS_PROJECT_BASE_DIR__) != null ||
    trimOptional(env?.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER__) != null
  ) &&
  env?.ONEWORKS_RUNTIME_PROTOCOL_FORCE_LOCAL_CONSUMER !== '1' &&
  env?.ONEWORKS_RUNTIME_PROTOCOL_FORCE_LOCAL_CONSUMER !== 'true'

const sanitizeRuntimeConsumerEnv = (env: NodeJS.ProcessEnv) => {
  const nextEnv = { ...env }
  for (const key of CODEX_PARENT_RUNTIME_ENV_KEYS) {
    delete nextEnv[key]
  }
  return nextEnv
}

export const shouldStartRuntimeConsumer = (command: RuntimeSessionCommandEnvelope, env?: NodeJS.ProcessEnv) =>
  env != null &&
  command.background !== false &&
  env?.ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER !== '1' &&
  env?.ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER !== 'true' &&
  !shouldDeferRuntimeConsumerToServer(command, env)

export const shouldStartRuntimeResumeConsumer = (params: {
  command: RuntimeSessionCommandEnvelope
  env?: NodeJS.ProcessEnv
  status?: string
}) =>
  params.env != null &&
  params.command.background !== false &&
  params.env?.ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER !== '1' &&
  params.env?.ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER !== 'true' &&
  params.status != null &&
  RUNTIME_RESUME_CONSUMER_STATUSES.has(params.status)

const startRuntimeConsumer = (params: {
  adapter?: string
  command: RuntimeSessionCommandEnvelope
  cwd: string
  effort?: RuntimeSessionCommandEnvelope['effort']
  fastMode?: boolean
  entity: string
  env?: NodeJS.ProcessEnv
  message: string
  model?: string
  permissionMode?: RuntimeSessionCommandEnvelope['permissionMode']
  sessionId: string
}) => {
  const cliEntrypoint = process.argv[1]
  if (cliEntrypoint == null || cliEntrypoint.trim() === '') {
    throw new Error('Unable to resolve One Works CLI entrypoint for runtime consumer.')
  }

  const args = [
    cliEntrypoint,
    '__run',
    '--print',
    '--output-format',
    'stream-json',
    '--session-id',
    params.sessionId,
    '--entity',
    params.entity
  ]
  pushOption(args, '--adapter', params.adapter)
  pushOption(args, '--model', params.model)
  pushOption(args, '--effort', params.effort)
  if (params.fastMode != null) args.push('--fast-mode', params.fastMode ? 'on' : 'off')
  pushOption(args, '--permission-mode', params.permissionMode)
  args.push(params.message)

  const child = spawn(process.execPath, args, {
    cwd: params.cwd,
    detached: true,
    env: sanitizeRuntimeConsumerEnv(mergeProcessEnvWithProjectEnv({
      ...(params.env ?? {}),
      __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER__: '1',
      __ONEWORKS_RUNTIME_PROTOCOL_SESSION_ID__: params.sessionId
    }, { workspaceFolder: params.cwd })),
    stdio: 'ignore'
  })
  child.unref()
  return child.pid
}

const startRuntimeResumeConsumer = (params: {
  cwd: string
  effort?: RuntimeSessionCommandEnvelope['effort']
  fastMode?: boolean
  env?: NodeJS.ProcessEnv
  model?: string
  permissionMode?: RuntimeSessionCommandEnvelope['permissionMode']
  sessionId: string
}) => {
  const cliEntrypoint = process.argv[1]
  if (cliEntrypoint == null || cliEntrypoint.trim() === '') {
    throw new Error('Unable to resolve One Works CLI entrypoint for runtime resume consumer.')
  }

  const args = [
    cliEntrypoint,
    '__run',
    '--print',
    '--output-format',
    'stream-json',
    '--resume',
    params.sessionId
  ]
  pushOption(args, '--model', params.model)
  pushOption(args, '--effort', params.effort)
  if (params.fastMode != null) args.push('--fast-mode', params.fastMode ? 'on' : 'off')
  pushOption(args, '--permission-mode', params.permissionMode)

  const child = spawn(process.execPath, args, {
    cwd: params.cwd,
    detached: true,
    env: sanitizeRuntimeConsumerEnv(mergeProcessEnvWithProjectEnv({
      ...(params.env ?? {}),
      __ONEWORKS_RUNTIME_PROTOCOL_CONSUMER__: '1',
      __ONEWORKS_RUNTIME_PROTOCOL_SESSION_ID__: params.sessionId
    }, { workspaceFolder: params.cwd })),
    stdio: 'ignore'
  })
  child.unref()
  return child.pid
}

const appendFollowUpRuntimeCommand = async (
  command: RuntimeSessionCommandEnvelope,
  options: ExecuteRuntimeProtocolCommandOptions,
  type: 'resume' | 'send_message'
) => {
  const sessionId = requiredString(command, 'sessionId')
  const status = await readRuntimeStatus(options.cwd, sessionId, options.env)
  const result = await appendRuntimeCommand({
    cwd: options.cwd,
    commandId: command.commandId,
    env: options.env,
    memberKey: command.memberKey,
    message: command.message ?? command.content,
    now: options.now,
    priority: command.priority,
    roomId: command.roomId,
    runId: command.runId,
    sessionId,
    source: command.source,
    type
  })
  const consumerPid = shouldStartRuntimeResumeConsumer({
      command,
      env: options.env,
      status: status.status
    })
    ? startRuntimeResumeConsumer({
      cwd: options.cwd,
      effort: optionalEffort(command.effort),
      fastMode: command.fastMode,
      env: options.env,
      model: optionalString(command.model),
      permissionMode: optionalPermissionMode(command.permissionMode),
      sessionId
    })
    : undefined

  return {
    ...result,
    ...(consumerPid != null ? { consumerPid } : {})
  }
}

export const executeRuntimeProtocolCommand = async (
  input: RuntimeSessionCommandEnvelope | unknown,
  options: ExecuteRuntimeProtocolCommandOptions
): Promise<RuntimeSessionResultEnvelope> => {
  let command: RuntimeSessionCommandEnvelope
  try {
    command = parseRuntimeProtocolCommand(input)
  } catch (error) {
    return toErrorResult(fallbackProtocolCommand(input), error)
  }

  try {
    switch (command.type) {
      case 'session.start': {
        const hostSessionId = trimOptional(command.hostSessionId) ??
          trimOptional(options.env?.__ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__)
        const roomId = trimOptional(command.roomId) ?? trimOptional(options.env?.__ONEWORKS_AGENT_ROOM_ID__)
        const roomTitle = trimOptional(command.roomTitle) ?? trimOptional(options.env?.__ONEWORKS_AGENT_ROOM_TITLE__)
        const adapter = optionalString(command.adapter) ??
          envDefault(options.env, '__ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_ADAPTER__')
        const model = optionalString(command.model) ??
          envDefault(options.env, '__ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_MODEL__')
        const effort = optionalEffort(command.effort) ??
          optionalEffort(envDefault(options.env, '__ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_EFFORT__'))
        const permissionMode = optionalPermissionMode(command.permissionMode) ??
          optionalPermissionMode(envDefault(options.env, '__ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_PERMISSION_MODE__'))
        const entity = requiredString(command, 'entity')
        const message = command.message ?? command.content ?? ''
        const result = await createRuntimeSession({
          cwd: options.cwd,
          commandId: command.commandId,
          entity,
          adapter,
          effort,
          fastMode: command.fastMode,
          model,
          env: options.env,
          hostSessionId,
          memberAvatar: command.memberAvatar,
          memberKey: command.memberKey,
          memberLabel: command.memberLabel,
          message,
          now: options.now,
          parentSessionId: command.parentSessionId ?? hostSessionId,
          priority: command.priority,
          roomId,
          roomTitle,
          runId: command.runId,
          runTitle: command.runTitle,
          sessionId: command.sessionId,
          source: command.source,
          permissionMode,
          title: command.title
        })
        const consumerPid = shouldStartRuntimeConsumer(command, options.env)
          ? startRuntimeConsumer({
            adapter,
            command,
            cwd: options.cwd,
            effort,
            fastMode: command.fastMode,
            entity,
            env: options.env,
            message,
            model,
            permissionMode,
            sessionId: result.sessionId
          })
          : undefined
        return toSuccessResult(
          command,
          {
            ...result,
            ...(consumerPid != null ? { consumerPid } : {})
          }
        )
      }
      case 'session.message':
        return toSuccessResult(
          command,
          await appendFollowUpRuntimeCommand(command, options, 'send_message')
        )
      case 'session.resume':
        return toSuccessResult(
          command,
          await appendFollowUpRuntimeCommand(command, options, 'resume')
        )
      case 'session.stop':
        return toSuccessResult(
          command,
          await appendRuntimeCommand({
            cwd: options.cwd,
            commandId: command.commandId,
            env: options.env,
            memberKey: command.memberKey,
            now: options.now,
            priority: command.priority,
            roomId: command.roomId,
            runId: command.runId,
            sessionId: requiredString(command, 'sessionId'),
            source: command.source,
            type: command.mode === 'force' || command.mode === 'kill' ? 'kill' : 'stop'
          })
        )
      case 'session.submit':
        return toSuccessResult(
          command,
          await appendRuntimeCommand({
            cwd: options.cwd,
            commandId: command.commandId,
            data: command.data,
            env: options.env,
            memberKey: command.memberKey,
            now: options.now,
            priority: command.priority,
            requestId: command.requestId ?? command.interactionId,
            roomId: command.roomId,
            runId: command.runId,
            sessionId: requiredString(command, 'sessionId'),
            source: command.source,
            type: 'submit_input',
            value: command.value
          })
        )
      case 'session.status':
        return toSuccessResult(
          command,
          await readRuntimeStatus(options.cwd, requiredString(command, 'sessionId'), options.env)
        )
      case 'session.events':
        return toSuccessResult(command, {
          sessionId: requiredString(command, 'sessionId'),
          events: await readRuntimeEvents(options.cwd, requiredString(command, 'sessionId'), options.env)
        })
    }
  } catch (error) {
    return toErrorResult(command, error)
  }
}
