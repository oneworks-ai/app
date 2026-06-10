import { readFile } from 'node:fs/promises'

import type { RuntimeCommand } from '@oneworks/runtime-protocol'

import { projectRuntimeEvent } from './projection.js'
import type { RuntimeEvent, RuntimeSessionMetadata } from './types.js'
import type { RuntimeStoreReplayOptions } from './watcher.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const getRoomForMetadata = (
  metadata: RuntimeSessionMetadata,
  options: RuntimeStoreReplayOptions
) =>
  metadata.roomId != null
    ? options.db.getAgentRoom(metadata.roomId)
    : metadata.hostSessionId != null
    ? options.db.getAgentRoomByHostSessionId(metadata.hostSessionId)
    : undefined

const hasProjectedAssignment = (
  metadata: RuntimeSessionMetadata,
  options: RuntimeStoreReplayOptions
) => {
  const room = getRoomForMetadata(metadata, options)
  return room != null &&
    options.db.getAgentRoomDetail(room.id)?.messages.some(message =>
        message.id === `runtime-meta:${metadata.sessionId}`
      ) === true
}

const hasProjectedMemberJoined = (
  metadata: RuntimeSessionMetadata,
  options: RuntimeStoreReplayOptions
) => {
  const room = getRoomForMetadata(metadata, options)
  const memberKey = metadata.memberKey ?? `session:${metadata.sessionId}`
  return room != null &&
    options.db.getAgentRoomDetail(room.id)?.messages.some(message =>
        message.id === `runtime-member:${room.id}:${memberKey}`
      ) === true
}

export const shouldProjectRuntimeMetadata = (
  metadata: RuntimeSessionMetadata,
  options: RuntimeStoreReplayOptions,
  assignmentSummary?: string
) => {
  const shouldProjectRoom = options.agentRoomProjectionEnabled === true
  if (
    options.checkpoint == null ||
    options.db.getSession(metadata.sessionId) == null
  ) {
    return true
  }

  if (
    shouldProjectRoom &&
    (
      (metadata.roomId != null && options.db.getAgentRoom(metadata.roomId) == null) ||
      (metadata.hostSessionId != null && options.db.getAgentRoomByHostSessionId(metadata.hostSessionId) == null)
    )
  ) {
    return true
  }

  if (!shouldProjectRoom) {
    return false
  }

  if (!hasProjectedMemberJoined(metadata, options)) {
    return true
  }

  return assignmentSummary != null &&
    assignmentSummary.trim() !== '' &&
    !hasProjectedAssignment(metadata, options)
}

export const readStartCommandSummary = async (commandsPath: string) => {
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
    return typeof command.content === 'string' && command.content.trim() !== ''
      ? command.content.trim()
      : typeof command.message === 'string' && command.message.trim() !== ''
      ? command.message.trim()
      : undefined
  }

  return undefined
}

export const projectRuntimeMetadata = (
  metadata: RuntimeSessionMetadata,
  options: RuntimeStoreReplayOptions,
  assignmentSummary?: string
) => {
  const event = {
    id: `runtime-meta:${metadata.sessionId}`,
    sessionId: metadata.sessionId,
    type: 'session_started',
    ts: metadata.createdAt ?? Date.now(),
    status: 'starting',
    visibility: 'room',
    ...(metadata.title != null ? { title: metadata.title } : {}),
    ...(assignmentSummary != null ? { summary: assignmentSummary } : {}),
    ...(metadata.parentSessionId != null ? { parentSessionId: metadata.parentSessionId } : {}),
    ...(metadata.adapter != null ? { adapter: metadata.adapter } : {}),
    ...(metadata.model != null ? { model: metadata.model } : {}),
    ...(metadata.roomId != null ? { roomId: metadata.roomId } : {}),
    ...(metadata.roomTitle != null ? { roomTitle: metadata.roomTitle } : {}),
    ...(metadata.hostSessionId != null ? { hostSessionId: metadata.hostSessionId } : {}),
    ...(metadata.memberKey != null ? { memberKey: metadata.memberKey } : {}),
    ...(metadata.memberKind != null ? { memberKind: metadata.memberKind } : {}),
    ...(metadata.memberLabel != null ? { memberLabel: metadata.memberLabel } : {}),
    ...(metadata.memberAvatar != null ? { memberAvatar: metadata.memberAvatar } : {}),
    ...(metadata.memberSubtitle != null ? { memberSubtitle: metadata.memberSubtitle } : {}),
    ...(metadata.runId != null ? { runId: metadata.runId } : {}),
    ...(metadata.runTitle != null ? { runTitle: metadata.runTitle } : {}),
    ...(metadata.operationId != null ? { operationId: metadata.operationId } : {})
  } satisfies RuntimeEvent

  projectRuntimeEvent(event, {
    db: options.db,
    broadcast: options.broadcast,
    metadata,
    agentRoomProjectionEnabled: options.agentRoomProjectionEnabled
  })
}
