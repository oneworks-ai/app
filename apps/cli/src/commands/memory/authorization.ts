import { Buffer } from 'node:buffer'
import path from 'node:path'
import process from 'node:process'

import { resolveContext } from './context'
import type { MemoryAccess, MemoryCommandOptions, MemoryContext, MemoryScope } from './shared'
import { normalizeScope, trimNonEmpty } from './shared'

const requireValue = (value: string | undefined, message: string) => {
  if (value != null && value !== '') return value
  throw new Error(message)
}

const resolveBoundId = (scope: MemoryScope, context: MemoryContext) => {
  if (scope === 'global') return undefined
  if (scope === 'entity') return context.entity
  if (scope === 'conversation') return context.conversationStateId
  if (scope === 'room') return context.roomId
  if (scope === 'channel') return context.channelId
  if (scope === 'session') return context.sessionId
  return context.senderId
}

const missingIdMessage = (scope: MemoryScope) => {
  if (scope === 'user') return 'Missing user memory id. Pass -f/--filter.'
  return `Missing ${scope} memory id. Pass -f/--filter.`
}

const normalizeServerHost = (host: string) => {
  const normalized = host.trim()
  if (normalized === '' || normalized === '0.0.0.0' || normalized === '::') return '127.0.0.1'
  return normalized
}

const resolveServerBaseUrl = (env: NodeJS.ProcessEnv) => {
  const explicit = trimNonEmpty(env.__ONEWORKS_PROJECT_SERVER_BASE_URL__)
  if (explicit != null) return explicit.replace(/\/+$/u, '')
  const host = normalizeServerHost(trimNonEmpty(env.__ONEWORKS_PROJECT_SERVER_HOST__) ?? '127.0.0.1')
  const port = trimNonEmpty(env.__ONEWORKS_PROJECT_SERVER_PORT__) ?? '8787'
  return `http://${host}:${port}`
}

const readTokenBinding = (token: string) => {
  try {
    const [encodedPayload] = token.split('.')
    if (encodedPayload == null) return undefined
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as unknown
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const value = parsed as Record<string, unknown>
    return {
      channelKey: trimNonEmpty(value.channelKey),
      childRunId: trimNonEmpty(value.childRunId),
      sessionId: trimNonEmpty(value.sessionId)
    }
  } catch {
    return undefined
  }
}

const readResponseBody = async (response: Response) => {
  try {
    const parsed = JSON.parse(await response.text()) as unknown
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // The authorization status is authoritative even when its error body is not JSON.
  }
  return undefined
}

const unwrapResponseBody = (body: Record<string, unknown> | undefined) => {
  if (body?.success === true) {
    const data = body.data
    return data != null && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : undefined
  }
  return body
}

const readResponseError = (body: Record<string, unknown> | undefined, status: number) => {
  const error = body?.error
  if (error != null && typeof error === 'object' && !Array.isArray(error)) {
    const message = trimNonEmpty((error as Record<string, unknown>).message)
    if (message != null) return message
  }
  return trimNonEmpty(body?.message) ?? `HTTP ${status}`
}

const verifyActiveChannelChild = async (context: MemoryContext, options: MemoryCommandOptions) => {
  const channelKey = requireValue(context.channelKey, 'Channel memory context is missing its channel key.')
  const childRunId = requireValue(context.childRunId, 'Channel memory context is missing its child run.')
  const sessionId = requireValue(context.sessionId, 'Channel memory context is missing its session.')
  if (context.channelSessionType !== 'direct' && context.channelSessionType !== 'group') {
    throw new Error('Channel memory context has an unsupported session type.')
  }
  const invocationToken = requireValue(
    context.invocationToken,
    'Channel memory access requires an active child invocation token.'
  )
  const tokenBinding = readTokenBinding(invocationToken)
  if (
    tokenBinding?.channelKey !== channelKey ||
    tokenBinding.childRunId !== childRunId ||
    tokenBinding.sessionId !== sessionId
  ) {
    throw new Error('Channel memory invocation token does not match the current child context.')
  }
  const contextPath = requireValue(context.channelContextPath, 'Channel memory context path is unavailable.')
  const safeSessionId = sessionId.replace(/[^\w.-]/gu, '_')
  const expectedContextPath = path.resolve(context.root, 'runtime-context', `${safeSessionId}.json`)
  if (path.resolve(contextPath) !== expectedContextPath) {
    throw new Error('Channel memory context path does not match the active child session.')
  }

  const env = options.env ?? process.env
  const response = await (options.fetch ?? globalThis.fetch)(
    `${resolveServerBaseUrl(env)}/api/channels/${encodeURIComponent(channelKey)}/commands/invoke`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {}, invocationToken, toolName: 'channel.whoami' })
    }
  )
  const rawBody = await readResponseBody(response)
  if (!response.ok) {
    throw new Error(`Channel memory authorization failed: ${readResponseError(rawBody, response.status)}`)
  }
  const body = unwrapResponseBody(rawBody)
  const result = body?.result
  if (
    result == null || typeof result !== 'object' || Array.isArray(result) ||
    (result as Record<string, unknown>).status !== 'success'
  ) {
    throw new Error('Channel memory authorization failed: server did not confirm the active child invocation.')
  }
}

const assertCurrentChannel = (requested: string | undefined, context: MemoryContext) => {
  const value = trimNonEmpty(requested)
  if (value == null) return
  if (value !== context.channelType && value !== context.channelRef) {
    throw new Error('Channel child memory access is limited to its current channel.')
  }
}

export const authorizeMemoryAccess = async (
  options: MemoryCommandOptions,
  intent: 'read' | 'write' = 'read'
): Promise<MemoryAccess> => {
  const context = resolveContext(options)
  const scope = normalizeScope(options.scope)
  if (context.channelContextPath == null) {
    return {
      context,
      displayId: resolveBoundId(scope, context) ?? trimNonEmpty(options.filter),
      mode: 'local',
      scope
    }
  }

  await verifyActiveChannelChild(context, options)
  if (intent === 'write') {
    const writableScopes = context.memoryPolicy?.writableScopes
    if (writableScopes != null && !writableScopes.includes(scope)) {
      throw new Error(`Entity memory policy does not permit writing the ${scope} scope.`)
    }
    if (context.memoryPolicy?.requireEvidence === true && context.childRunId == null) {
      throw new Error('Entity memory policy requires an active child run as write evidence.')
    }
  }
  if (scope === 'global') {
    throw new Error('Channel child memory access does not permit the global scope.')
  }
  assertCurrentChannel(options.channel, context)
  const displayId = requireValue(resolveBoundId(scope, context), missingIdMessage(scope))
  const requestedId = trimNonEmpty(options.filter)
  if (requestedId != null && requestedId !== displayId) {
    throw new Error(`Channel child memory access is limited to its current ${scope} id.`)
  }
  return { context, displayId, mode: 'channel-child', scope }
}
