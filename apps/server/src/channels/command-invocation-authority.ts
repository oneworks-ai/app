import { getDb } from '#~/db/index.js'
import { verifyChannelCommandInvocationToken } from '#~/services/channel-commands/invocation-token.js'

import { trimNonEmpty } from './command-invocation-input'
import type { ChannelCommandInvocationContext, ChannelCommandInvocationInput } from './command-invocation-types'
import type { ChannelRuntimeState } from './types'

const forbidden = (message: string) => ({ ok: false as const, statusCode: 403 as const, message })

// A child-run token is valid only while the runtime has not reached a terminal outcome.
const activeChildRunStatuses = new Set(['started', 'dispatched', 'running'])

export const resolveAuthoritativeCommandInput = (
  state: ChannelRuntimeState,
  input: ChannelCommandInvocationInput
):
  | { ok: true; input: ChannelCommandInvocationInput & { context: ChannelCommandInvocationContext } }
  | { ok: false; statusCode: 403; message: string } =>
{
  const token = trimNonEmpty(input.invocationToken)
  if (token == null) return forbidden('Channel command invocation requires a child-run token.')

  const payload = verifyChannelCommandInvocationToken(token, { channelKey: state.key })
  if (payload == null) return forbidden('Channel command invocation token is invalid or expired.')

  const db = getDb()
  const childRun = db.getChannelChildSessionRun(payload.childRunId)
  const snapshot = db.getSessionRuntimeState(payload.sessionId)?.channelActorSnapshot
  const binding = db.getChannelSessionBySessionId(payload.sessionId)
  if (
    childRun == null || !activeChildRunStatuses.has(childRun.status) ||
    childRun.channelKey !== state.key || childRun.channelType !== state.type ||
    snapshot?.childRunId !== childRun.id || snapshot.sessionId !== payload.sessionId ||
    snapshot.channelKey !== childRun.channelKey || snapshot.channelType !== childRun.channelType ||
    snapshot.channelId !== childRun.channelId || snapshot.sessionType !== childRun.sessionType ||
    binding == null || binding.channelKey !== childRun.channelKey || binding.channelType !== childRun.channelType ||
    binding.channelId !== childRun.channelId || binding.sessionType !== childRun.sessionType ||
    binding.threadId !== snapshot.threadId
  ) {
    return forbidden('Channel command child-run authority is unavailable or inconsistent.')
  }

  return {
    ok: true,
    input: {
      input: input.input,
      invocationToken: token,
      ...(trimNonEmpty(input.requestId) == null ? {} : { requestId: trimNonEmpty(input.requestId) }),
      toolName: input.toolName,
      context: {
        actorAccountId: childRun.actorAccountId ?? childRun.senderId ?? undefined,
        actorUserId: childRun.actorUserId ?? undefined,
        channelId: childRun.channelId,
        channelKey: childRun.channelKey,
        channelLinkName: childRun.channelLinkName ?? undefined,
        channelType: childRun.channelType,
        entity: childRun.entity ?? undefined,
        executionContext: snapshot.executionContext,
        messageId: childRun.messageId ?? undefined,
        replyReceiveId: snapshot.replyReceiveId ?? binding.replyReceiveId,
        replyReceiveIdType: snapshot.replyReceiveIdType ?? binding.replyReceiveIdType,
        senderId: childRun.senderId ?? childRun.actorAccountId ?? undefined,
        sessionId: payload.sessionId,
        sessionType: childRun.sessionType,
        threadId: snapshot.threadId,
        threadKey: childRun.threadKey ?? undefined
      }
    }
  }
}
