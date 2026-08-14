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
  if (childRun == null || snapshot == null) {
    return forbidden('Channel command child-run authority is unavailable or inconsistent.')
  }
  const binding = db.getChannelSessionBySessionId(payload.sessionId)
  const roomContext = snapshot?.executionContext?.room
  const roomMemberKey = roomContext?.memberKey
  const roomRun = roomContext == null || roomMemberKey == null
    ? undefined
    : db.listAgentRoomRuns(roomContext.id).find(run =>
      run.sessionId === payload.sessionId &&
      run.memberKey === roomMemberKey
    )
  const roomConnection = roomContext == null || roomMemberKey == null
    ? undefined
    : db.listAgentRoomChannelConnections(roomContext.id).find(connection =>
      connection.memberKey === roomMemberKey &&
      connection.status === 'active' &&
      connection.channelKey === childRun.channelKey &&
      connection.channelType === childRun.channelType &&
      connection.channelId === childRun.channelId &&
      (childRun.channelLinkName == null || connection.channelLinkName === childRun.channelLinkName)
    )
  const hasRoomAuthority = roomContext != null && roomMemberKey != null && roomRun != null && roomConnection != null &&
    (childRun.entity == null || childRun.entity === roomMemberKey)
  const hasChannelSessionAuthority = roomContext == null && binding != null &&
    binding.channelKey === childRun.channelKey && binding.channelType === childRun.channelType &&
    binding.channelId === childRun.channelId && binding.sessionType === childRun.sessionType &&
    (binding.threadId ?? undefined) === (snapshot.threadId ?? undefined)
  if (
    !activeChildRunStatuses.has(childRun.status) ||
    childRun.sessionId !== payload.sessionId ||
    childRun.channelKey !== state.key || childRun.channelType !== state.type ||
    snapshot?.childRunId !== childRun.id || snapshot.sessionId !== payload.sessionId ||
    snapshot.channelKey !== childRun.channelKey || snapshot.channelType !== childRun.channelType ||
    snapshot.channelId !== childRun.channelId || snapshot.sessionType !== childRun.sessionType ||
    (!hasRoomAuthority && !hasChannelSessionAuthority)
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
        replyReceiveId: snapshot.replyReceiveId ?? binding?.replyReceiveId,
        replyReceiveIdType: snapshot.replyReceiveIdType ?? binding?.replyReceiveIdType,
        senderId: childRun.senderId ?? childRun.actorAccountId ?? undefined,
        sessionId: payload.sessionId,
        sessionType: childRun.sessionType,
        threadId: snapshot.threadId,
        threadKey: childRun.threadKey ?? undefined
      }
    }
  }
}
