import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { DEFAULT_SUPPORTED_PROTOCOL_RANGE, getCurrentProtocolVersion } from '@oneworks/runtime-protocol'
import { getSessionStorePath, resolveRuntimeRoot } from '@oneworks/runtime-store'
import type { RuntimeHeartbeat, RuntimeMeta, RuntimeState } from '@oneworks/runtime-store'

import { buildCommand, createSessionId, getStore, trimRequired } from './runtime-store-shared'
import type { CreateRuntimeSessionParams } from './runtime-store-shared'

export const createRuntimeRoomIdForHostSession = (hostSessionId: string) => `room_${hostSessionId}`

export const resolveRuntimeSessionStore = async (
  cwd: string,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env
) => {
  const root = await resolveRuntimeRoot({ cwd, env })
  const storePath = getSessionStorePath(root, trimRequired(sessionId, 'session'))
  return {
    root,
    sessionId,
    storePath,
    metaPath: path.resolve(storePath, 'meta.json'),
    eventsPath: path.resolve(storePath, 'events.jsonl'),
    commandsPath: path.resolve(storePath, 'commands.jsonl'),
    statePath: path.resolve(storePath, 'state.json'),
    heartbeatPath: path.resolve(storePath, 'heartbeat.json'),
    locksPath: path.resolve(storePath, 'locks')
  }
}

export const createRuntimeSession = async (params: CreateRuntimeSessionParams) => {
  const now = params.now ?? Date.now
  const sessionId = params.sessionId ?? createSessionId()
  const entity = trimRequired(params.entity, 'entity')
  const content = trimRequired(params.message, 'message')
  const title = params.title?.trim() || `${entity} session`
  const adapter = params.adapter?.trim() || undefined
  const effort = params.effort
  const fastMode = params.fastMode
  const model = params.model?.trim() || undefined
  const permissionMode = params.permissionMode
  const parentSessionId = params.parentSessionId?.trim() || undefined
  const hostSessionId = params.hostSessionId?.trim() || parentSessionId
  const roomId = params.roomId?.trim() ||
    (hostSessionId == null ? undefined : createRuntimeRoomIdForHostSession(hostSessionId))
  const roomTitle = params.roomTitle?.trim() || undefined
  const memberKey = params.memberKey?.trim() || entity
  const memberAvatar = params.memberAvatar?.trim() || undefined
  const memberLabel = params.memberLabel?.trim() || entity
  const runId = params.runId?.trim() || sessionId
  const runTitle = params.runTitle?.trim() || title
  const ts = now()
  const store = await getStore(params.cwd, params.env)
  const session = await store.createSession(
    {
      protocolVersion: getCurrentProtocolVersion(),
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId,
      title,
      entity,
      ...(adapter != null ? { adapter } : {}),
      ...(effort != null ? { effort } : {}),
      ...(fastMode != null ? { fastMode } : {}),
      ...(model != null ? { model } : {}),
      ...(permissionMode != null ? { permissionMode } : {}),
      cwd: params.cwd,
      ...(parentSessionId != null ? { parentSessionId } : {}),
      ...(roomId != null ? { roomId } : {}),
      ...(roomTitle != null ? { roomTitle } : {}),
      ...(hostSessionId != null ? { hostSessionId } : {}),
      memberKey,
      ...(memberAvatar != null ? { memberAvatar } : {}),
      memberKind: 'entity',
      memberLabel,
      runId,
      runTitle,
      createdAt: ts,
      needsEngineConsumer: true
    } satisfies RuntimeMeta
  )

  await Promise.all([
    session.writeState(buildInitialState({ sessionId, title, ts })),
    session.writeHeartbeat(buildInitialHeartbeat({ sessionId, ts }))
  ])
  const startCommand = await session.appendCommand(buildCommand({
    sessionId,
    type: 'start',
    ts,
    content,
    commandId: params.commandId,
    entity,
    adapter,
    effort,
    fastMode,
    model,
    memberKey,
    permissionMode,
    priority: params.priority,
    ...(roomId != null ? { roomId } : {}),
    runId,
    source: params.source,
    title
  }))

  return {
    ...(params.commandId != null
      ? {
        commandId: startCommand.commandId,
        runtimeCommandId: startCommand.id
      }
      : {}),
    sessionId,
    storePath: session.sessionPath,
    status: 'starting',
    title,
    ...(hostSessionId != null ? { hostSessionId } : {}),
    ...(roomId != null ? { roomId } : {})
  }
}

const buildInitialState = (params: {
  sessionId: string
  title: string
  ts: number
}): RuntimeState => ({
  protocolVersion: getCurrentProtocolVersion(),
  supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  sessionId: params.sessionId,
  status: 'starting',
  title: params.title,
  lastSeq: 0,
  updatedAt: params.ts,
  needsEngineConsumer: true
})

const buildInitialHeartbeat = (params: {
  sessionId: string
  ts: number
}): RuntimeHeartbeat => ({
  protocolVersion: getCurrentProtocolVersion(),
  supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  sessionId: params.sessionId,
  runtimeId: 'pending_engine_consumer',
  status: 'starting',
  updatedAt: params.ts
})

export const readRuntimeStatus = async (
  cwd: string,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env
) => {
  const session = (await getStore(cwd, env)).session(sessionId)
  if (!existsSync(session.sessionPath)) throw new Error(`Runtime session "${sessionId}" not found.`)
  const [meta, state, heartbeat] = await Promise.all([
    session.readMeta(),
    session.readState(),
    session.readHeartbeat()
  ])
  return {
    sessionId,
    storePath: session.sessionPath,
    status: state?.status ?? heartbeat?.status ?? 'starting',
    title: String(state?.title ?? meta?.title ?? ''),
    meta,
    state,
    heartbeat
  }
}
