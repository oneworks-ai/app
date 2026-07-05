/* eslint-disable max-lines */

import Router from '@koa/router'

import type {
  AgentRoom,
  AgentRoomEvent,
  AgentRoomEventMember,
  AgentRoomEventRun,
  AgentRoomRunStatus,
  AgentRoomUserMessageTarget,
  UpdateAgentRoomMetadataRequest
} from '@oneworks/core'

import { createAgentRoomService } from '#~/services/agent-room/index.js'
import { publishClientEvent } from '#~/services/client-events.js'
import { badRequest, conflict, methodNotAllowed, notFound } from '#~/utils/http.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim() !== ''
)

const asString = (value: unknown) => typeof value === 'string' ? value.trim() : undefined

const hasOwn = (value: Record<string, unknown>, key: string) => (
  Object.prototype.hasOwnProperty.call(value, key)
)

const parseMember = (value: unknown): AgentRoomEventMember | undefined => {
  if (
    !isRecord(value) || !isNonEmptyString(value.key) || !isNonEmptyString(value.kind) || !isNonEmptyString(value.label)
  ) {
    return undefined
  }

  if (value.kind !== 'host' && value.kind !== 'entity' && value.kind !== 'task') {
    return undefined
  }

  return {
    key: value.key.trim(),
    kind: value.kind,
    label: value.label.trim(),
    ...(asString(value.avatar) != null ? { avatar: asString(value.avatar) } : {}),
    ...(asString(value.subtitle) != null ? { subtitle: asString(value.subtitle) } : {})
  }
}

const parseRun = (value: unknown): AgentRoomEventRun | undefined => {
  if (
    !isRecord(value) || !isNonEmptyString(value.key) || !isNonEmptyString(value.sessionId) ||
    !isNonEmptyString(value.title)
  ) {
    return undefined
  }

  return {
    key: value.key.trim(),
    sessionId: value.sessionId.trim(),
    title: value.title.trim()
  }
}

const isRunStatus = (value: unknown): value is AgentRoomRunStatus => (
  value === 'running' ||
  value === 'waiting' ||
  value === 'completed' ||
  value === 'failed' ||
  value === 'stopped'
)

const isRoomEvent = (value: unknown): value is AgentRoomEvent => {
  if (!isRecord(value) || !isNonEmptyString(value.type) || parseMember(value.member) == null) {
    return false
  }

  if (value.type === 'member_joined') {
    return true
  }

  return parseRun(value.run) != null
}

const normalizeMetadataUpdate = (value: unknown): UpdateAgentRoomMetadataRequest | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const hasArchived = hasOwn(value, 'isArchived')
  const hasFavorited = hasOwn(value, 'isFavorited')
  if (!hasArchived && !hasFavorited) {
    return undefined
  }
  if (
    (hasArchived && typeof value.isArchived !== 'boolean') ||
    (hasFavorited && typeof value.isFavorited !== 'boolean')
  ) {
    return undefined
  }

  return {
    ...(hasArchived ? { isArchived: value.isArchived as boolean } : {}),
    ...(hasFavorited ? { isFavorited: value.isFavorited as boolean } : {})
  }
}

const normalizeTarget = (value: unknown): AgentRoomUserMessageTarget | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const memberKey = asString(value.memberKey)
  const runKey = asString(value.runKey)
  if (memberKey == null && runKey == null) {
    return undefined
  }
  return {
    ...(memberKey != null ? { memberKey } : {}),
    ...(runKey != null ? { runKey } : {})
  }
}

const normalizeInteractionResponseData = (value: unknown): string | string[] | undefined => {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value
  }

  return undefined
}

const toNotFound = (error: unknown, roomId: string) => {
  if (error instanceof Error && error.message.startsWith('Agent room not found:')) {
    return notFound('Agent room not found', { roomId }, 'agent_room_not_found')
  }
  throw error
}

const publishAgentRoomUpdated = (roomId: string, room?: AgentRoom) => {
  publishClientEvent('agent-rooms', {
    type: 'agent_room_updated',
    roomId,
    ...(room?.hostSessionId != null ? { hostSessionId: room.hostSessionId } : {})
  })
}

export function agentRoomsRouter(): Router {
  const router = new Router()
  const service = createAgentRoomService()

  router.get(['/', ''], (ctx) => {
    ctx.body = { rooms: service.listRooms() }
  })

  router.get('/archived', (ctx) => {
    ctx.body = { rooms: service.listRooms('archived') }
  })

  router.get('/summary', (ctx) => {
    ctx.body = { rooms: service.listRoomSummaries() }
  })

  router.get('/summary/archived', (ctx) => {
    ctx.body = { rooms: service.listRoomSummaries('archived') }
  })

  router.get('/by-host-session/:sessionId', (ctx) => {
    const { sessionId } = ctx.params as { sessionId: string }
    ctx.body = { room: service.getRoomForHostSession(sessionId) }
  })

  router.post(['/ensure', '/ensure/'], (ctx) => {
    const { hostSessionId, title } = ctx.request.body as {
      hostSessionId?: string
      title?: string
    }
    const resolvedHostSessionId = hostSessionId?.trim()
    if (resolvedHostSessionId == null || resolvedHostSessionId === '') {
      throw badRequest('hostSessionId is required', undefined, 'invalid_agent_room_host_session')
    }

    const room = service.ensureRoomForHostSession({
      hostSessionId: resolvedHostSessionId,
      title
    })
    publishAgentRoomUpdated(room.id, room)
    ctx.body = { room }
  })

  router.post(['/', ''], (ctx) => {
    const { id, title, hostSessionId } = ctx.request.body as {
      id?: string
      title?: string
      hostSessionId?: string
    }
    const resolvedTitle = title?.trim()
    if (resolvedTitle == null || resolvedTitle === '') {
      throw badRequest('title is required', undefined, 'invalid_agent_room_title')
    }

    const room = service.createRoom({
      id: id?.trim() || undefined,
      title: resolvedTitle,
      hostSessionId: hostSessionId?.trim() || undefined
    })
    publishAgentRoomUpdated(room.id, room)
    ctx.body = { room }
  })

  router.get('/:id', (ctx) => {
    const { id } = ctx.params as { id: string }
    const detail = service.getDetail(id)
    if (detail == null) {
      throw notFound('Agent room not found', { id }, 'agent_room_not_found')
    }

    ctx.body = detail
  })

  router.patch('/:id', (ctx) => {
    const { id } = ctx.params as { id: string }
    const update = normalizeMetadataUpdate(ctx.request.body)
    if (update == null) {
      throw badRequest('Invalid room metadata update', undefined, 'invalid_agent_room_metadata')
    }

    try {
      const room = service.updateRoomMetadata(id, update)
      publishAgentRoomUpdated(id, room)
      ctx.body = { room }
    } catch (error) {
      throw toNotFound(error, id)
    }
  })

  router.post('/:id/messages', async (ctx) => {
    const { id } = ctx.params as { id: string }
    const { content, target } = ctx.request.body as {
      content?: string
      target?: unknown
    }
    const normalizedContent = content?.trim()
    if (normalizedContent == null || normalizedContent === '') {
      throw badRequest('message content is required', undefined, 'invalid_agent_room_message')
    }

    try {
      const message = await service.appendUserMessage(id, normalizedContent, normalizeTarget(target))
      publishAgentRoomUpdated(id)
      ctx.body = { message }
    } catch (error) {
      throw toNotFound(error, id)
    }
  })

  router.post('/:id/interactions/:interactionId/responses', async (ctx) => {
    const { id, interactionId } = ctx.params as { id: string; interactionId: string }
    const body = ctx.request.body
    const data = normalizeInteractionResponseData(isRecord(body) ? body.data : undefined)
    if (data == null) {
      throw badRequest('interaction response data is required', undefined, 'invalid_agent_room_interaction_response')
    }

    try {
      const handled = await service.respondInteraction(id, interactionId, data)
      if (!handled) {
        throw conflict(
          'Interaction response is no longer pending',
          { roomId: id, interactionId },
          'agent_room_interaction_not_pending'
        )
      }
      publishAgentRoomUpdated(id)
      ctx.body = { ok: true }
    } catch (error) {
      throw toNotFound(error, id)
    }
  })

  router.post('/:id/events', (ctx) => {
    const { id } = ctx.params as { id: string }
    const body = ctx.request.body as {
      type?: string
      event?: unknown
    }
    if ((body.type != null && body.type !== 'room_event') || !isRoomEvent(body.event)) {
      throw badRequest('Invalid room event', { type: body.type }, 'invalid_agent_room_event')
    }

    try {
      const message = service.applyEvent(id, body.event)
      publishAgentRoomUpdated(id)
      ctx.body = { message }
    } catch (error) {
      throw toNotFound(error, id)
    }
  })

  router.post('/:id/members', (ctx) => {
    const { id } = ctx.params as { id: string }
    const { member } = ctx.request.body as { member?: unknown }
    const parsed = parseMember(member)
    if (parsed == null) {
      throw badRequest('Invalid room member', undefined, 'invalid_agent_room_member')
    }

    try {
      const member = service.upsertMember(id, parsed)
      publishAgentRoomUpdated(id)
      ctx.body = { member }
    } catch (error) {
      throw toNotFound(error, id)
    }
  })

  router.post('/:id/runs', (ctx) => {
    const { id } = ctx.params as { id: string }
    const { run } = ctx.request.body as { run?: unknown }
    const parsed = parseRun(run)
    if (!isRecord(run) || parsed == null || !isNonEmptyString(run.memberKey)) {
      throw badRequest('Invalid room run', undefined, 'invalid_agent_room_run')
    }
    const status = isRunStatus(run.status) ? run.status : undefined

    try {
      const storedRun = service.upsertRun(id, {
        ...parsed,
        memberKey: run.memberKey.trim(),
        ...(status != null ? { status } : {}),
        ...(asString(run.latestSummary) != null ? { latestSummary: asString(run.latestSummary) } : {})
      })
      publishAgentRoomUpdated(id)
      ctx.body = { run: storedRun }
    } catch (error) {
      throw toNotFound(error, id)
    }
  })

  router.delete('/:id', (ctx) => {
    const { id } = ctx.params as { id: string }
    const removed = service.deleteRoom(id)
    if (removed) {
      publishAgentRoomUpdated(id)
    }
    ctx.body = {
      ok: true,
      removed
    }
  })

  router.all('/:id', (ctx) => {
    throw methodNotAllowed('Method Not Allowed', { path: ctx.path }, 'method_not_allowed')
  })

  return router
}
