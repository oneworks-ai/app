import type { ChannelInboundEvent } from '@oneworks/core/channel'

import { getDb } from '#~/db/index.js'

import type { ChannelContext } from './middleware/@types'

type PreferenceOperations = Pick<
  ChannelContext,
  | 'getChannelAdapterPreference'
  | 'setChannelAdapterPreference'
  | 'getChannelPermissionModePreference'
  | 'setChannelPermissionModePreference'
  | 'getChannelEffortPreference'
  | 'setChannelEffortPreference'
>

export const createChannelPreferenceOperations = (
  getContext: () => ChannelContext,
  channelKey: string,
  inbound: ChannelInboundEvent
): PreferenceOperations => ({
  getChannelAdapterPreference: () => getContext().channelAdapter,
  setChannelAdapterPreference: (adapter) => {
    const ctx = getContext()
    ctx.channelAdapter = adapter
    getDb().upsertChannelPreference({
      channelType: inbound.channelType,
      sessionType: inbound.sessionType,
      channelId: inbound.channelId,
      channelKey,
      adapter,
      permissionMode: ctx.channelPermissionMode,
      effort: ctx.channelEffort
    })
  },
  getChannelPermissionModePreference: () => getContext().channelPermissionMode,
  setChannelPermissionModePreference: (permissionMode) => {
    const ctx = getContext()
    ctx.channelPermissionMode = permissionMode
    getDb().upsertChannelPreference({
      channelType: inbound.channelType,
      sessionType: inbound.sessionType,
      channelId: inbound.channelId,
      channelKey,
      adapter: ctx.channelAdapter,
      permissionMode,
      effort: ctx.channelEffort
    })
  },
  getChannelEffortPreference: () => getContext().channelEffort,
  setChannelEffortPreference: (effort) => {
    const ctx = getContext()
    ctx.channelEffort = effort
    getDb().upsertChannelPreference({
      channelType: inbound.channelType,
      sessionType: inbound.sessionType,
      channelId: inbound.channelId,
      channelKey,
      adapter: ctx.channelAdapter,
      permissionMode: ctx.channelPermissionMode,
      effort
    })
  }
})
