import { getDb } from '#~/db/index.js'

import { trimNonEmpty } from './command-invocation-input'
import type { ChannelCommandInvocationContext, ChannelCommandInvocationInput } from './command-invocation-types'
import type { ChannelRuntimeState } from './types'

const definedEntries = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item != null)) as Partial<T>

const protectedCommandContextFields = ['channelType', 'channelId', 'sessionType', 'senderId'] as const

export const resolveAuthoritativeCommandInput = (
  state: ChannelRuntimeState,
  input: ChannelCommandInvocationInput
):
  | { ok: true; input: ChannelCommandInvocationInput }
  | { ok: false; statusCode: 403; message: string } =>
{
  const providedContext = input.context ?? {}
  const sessionId = trimNonEmpty(input.sessionId) ?? trimNonEmpty(providedContext.sessionId)
  if (sessionId == null) return { ok: true, input }

  const db = getDb()
  const snapshot = db.getSessionRuntimeState(sessionId)?.channelActorSnapshot
  const binding = db.getChannelSessionBySessionId(sessionId)
  const authoritativeContext: ChannelCommandInvocationContext = definedEntries(
    {
      actorAccountId: snapshot?.actorAccountId ?? snapshot?.senderId ?? binding?.senderId,
      actorUserId: snapshot?.actorUserId,
      channelId: snapshot?.channelId ?? binding?.channelId,
      channelKey: snapshot?.channelKey ?? binding?.channelKey,
      channelLinkName: snapshot?.channelLinkName,
      channelType: snapshot?.channelType ?? binding?.channelType,
      entity: snapshot?.entity,
      messageId: snapshot?.messageId,
      replyReceiveId: snapshot?.replyReceiveId ?? binding?.replyReceiveId,
      replyReceiveIdType: snapshot?.replyReceiveIdType ?? binding?.replyReceiveIdType,
      senderId: snapshot?.senderId ?? snapshot?.actorAccountId ?? binding?.senderId,
      sessionId,
      sessionType: snapshot?.sessionType ?? binding?.sessionType,
      threadKey: snapshot?.threadKey
    } satisfies ChannelCommandInvocationContext
  )

  if (authoritativeContext.channelKey != null && authoritativeContext.channelKey !== state.key) {
    return {
      ok: false,
      statusCode: 403,
      message: `Channel command session ${sessionId} belongs to ${authoritativeContext.channelKey}, not ${state.key}.`
    }
  }

  if (authoritativeContext.channelType != null && authoritativeContext.channelType !== state.type) {
    return {
      ok: false,
      statusCode: 403,
      message: `Channel command session ${sessionId} belongs to ${authoritativeContext.channelType}, not ${state.type}.`
    }
  }

  const conflicts = protectedCommandContextFields.filter((field) => {
    const provided = trimNonEmpty(providedContext[field])
    const authoritative = trimNonEmpty(authoritativeContext[field])
    return provided != null && authoritative != null && provided !== authoritative
  })
  if (conflicts.length > 0) {
    return {
      ok: false,
      statusCode: 403,
      message: `Channel command context conflicts with session actor snapshot: ${conflicts.join(', ')}.`
    }
  }

  return {
    ok: true,
    input: {
      ...input,
      context: {
        ...providedContext,
        ...authoritativeContext
      },
      sessionId
    }
  }
}
