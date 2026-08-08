import type { ChannelBaseConfig, ChannelInboundEvent } from '@oneworks/core/channel'

import { getDb } from '#~/db/index.js'

import { resolveActor, resolveChannelLinkForCommand, trimNonEmpty } from './command-invocation-input'
import { createChannelPreferenceOperations } from './command-invocation-preferences'
import { createOfflineSessionOperations } from './command-invocation-session'
import type { ChannelCommandInvocationInput } from './command-invocation-types'
import type { ChannelContext } from './middleware/@types'
import { createT, defineMessages } from './middleware/i18n'
import type { ChannelRuntimeState } from './types'

export const createOfflineCommandContext = (
  state: ChannelRuntimeState,
  input: ChannelCommandInvocationInput,
  inbound: ChannelInboundEvent,
  replies: string[]
): ChannelContext => {
  const db = getDb()
  const binding = db.getChannelSession(inbound.channelType, inbound.sessionType, inbound.channelId)
  const preference = db.getChannelPreference(inbound.channelType, inbound.sessionType, inbound.channelId)
  const sessionId = trimNonEmpty(input.sessionId) ?? trimNonEmpty(input.context?.sessionId) ?? binding?.sessionId
  let ctx: ChannelContext
  const getContext = () => ctx

  ctx = {
    channelKey: state.key,
    configSource: state.configSource,
    inbound,
    connection: undefined,
    config: state.config,
    channelLink: resolveChannelLinkForCommand(state, inbound),
    actor: resolveActor(inbound, trimNonEmpty(input.context?.actorUserId)),
    sessionId,
    channelAdapter: preference?.adapter,
    channelPermissionMode: preference?.permissionMode,
    channelEffort: preference?.effort,
    contentItems: undefined,
    commandText: '',
    defineMessages,
    t: createT((state.config as ChannelBaseConfig | undefined)?.language as Parameters<typeof createT>[0]),
    reply: async (text) => {
      replies.push(text)
      return undefined
    },
    pushFollowUps: async () => undefined,
    ...createOfflineSessionOperations(getContext, state.key, inbound),
    ...createChannelPreferenceOperations(getContext, state.key, inbound)
  }

  return ctx
}
