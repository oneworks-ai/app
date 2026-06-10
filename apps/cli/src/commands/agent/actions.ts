import process from 'node:process'

import { resolveCliWorkspaceCwd } from '#~/workspace.js'

import { executeRuntimeProtocolCommand } from '../run/protocol'
import { readRuntimeEvents } from './runtime-store'

export interface AgentStartOptions {
  avatar?: string
  entity: string
  hostSession?: string
  json?: boolean
  message: string
  room?: string
  roomTitle?: string
  title?: string
}

export interface AgentSessionOptions {
  json?: boolean
  message?: string
  request?: string
  session: string
  value?: string
}

export interface AgentEventsOptions {
  follow?: boolean
  jsonl?: boolean
  session: string
}

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

const printJsonl = (value: unknown) => {
  console.log(JSON.stringify(value))
}

const exitWithError = (error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}

const unwrapProtocolResult = (result: Awaited<ReturnType<typeof executeRuntimeProtocolCommand>>) => {
  if (!result.ok) throw new Error(result.error ?? 'Runtime protocol command failed.')
  return result.result
}

export const runAgentAction = async (action: () => Promise<void>) => {
  try {
    await action()
  } catch (error) {
    exitWithError(error)
  }
}

export const runAgentStart = async (opts: AgentStartOptions) => {
  const hostSessionId = opts.hostSession?.trim() ||
    process.env.__ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__?.trim() ||
    undefined
  const roomId = opts.room?.trim() || process.env.__ONEWORKS_AGENT_ROOM_ID__?.trim() || undefined
  const roomTitle = opts.roomTitle?.trim() || process.env.__ONEWORKS_AGENT_ROOM_TITLE__?.trim() || undefined
  printJson(
    unwrapProtocolResult(
      await executeRuntimeProtocolCommand({
        type: 'session.start',
        entity: opts.entity,
        hostSessionId,
        memberAvatar: opts.avatar,
        memberKey: opts.entity,
        memberLabel: opts.entity,
        message: opts.message,
        parentSessionId: hostSessionId,
        roomId,
        roomTitle,
        runTitle: opts.title,
        title: opts.title
      }, {
        cwd: resolveCliWorkspaceCwd()
      })
    )
  )
}

export const runAgentCommand = async (
  opts: AgentSessionOptions,
  type: 'send_message' | 'stop' | 'kill' | 'submit_input' | 'resume'
) => {
  const protocolType = (() => {
    switch (type) {
      case 'send_message':
        return 'session.message'
      case 'submit_input':
        return 'session.submit'
      case 'resume':
        return 'session.resume'
      case 'kill':
      case 'stop':
        return 'session.stop'
    }
  })()
  printJson(
    unwrapProtocolResult(
      await executeRuntimeProtocolCommand({
        type: protocolType,
        sessionId: opts.session,
        message: opts.message,
        mode: type === 'kill' ? 'force' : undefined,
        requestId: opts.request,
        value: opts.value
      }, {
        cwd: resolveCliWorkspaceCwd()
      })
    )
  )
}

export const runAgentStatus = async (opts: AgentSessionOptions) => {
  printJson(
    unwrapProtocolResult(
      await executeRuntimeProtocolCommand({
        type: 'session.status',
        sessionId: opts.session
      }, {
        cwd: resolveCliWorkspaceCwd()
      })
    )
  )
}

const printFollowEvents = async (params: {
  cwd: string
  sessionId: string
}) => {
  let printed = 0

  for (;;) {
    const events = await readRuntimeEvents(params.cwd, params.sessionId)
    for (const event of events.slice(printed)) {
      printJsonl(event)
    }
    printed = events.length
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

export const runAgentEvents = async (opts: AgentEventsOptions) => {
  const cwd = resolveCliWorkspaceCwd()
  if (opts.follow && !opts.jsonl) {
    throw new Error('agent events --follow requires --jsonl.')
  }
  if (opts.follow) {
    await printFollowEvents({ cwd, sessionId: opts.session })
    return
  }

  const result = unwrapProtocolResult(
    await executeRuntimeProtocolCommand({
      type: 'session.events',
      sessionId: opts.session
    }, {
      cwd
    })
  )
  const events = Array.isArray((result as { events?: unknown }).events)
    ? (result as { events: unknown[] }).events
    : []
  if (opts.jsonl) {
    for (const event of events) printJsonl(event)
    return
  }
  printJson(events)
}
