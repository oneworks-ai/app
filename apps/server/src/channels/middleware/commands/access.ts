import { updateConfigFile } from '@oneworks/config'
import type { ConfigSource } from '@oneworks/core'
import type { ChannelAccessConfig } from '@oneworks/core/channel'

import { loadConfigState } from '#~/services/config/index.js'

import type { ChannelContext } from '../@types'
import { dedupe } from './utils'

type AccessListField = 'admins' | 'allowedSenders' | 'blockedSenders' | 'allowedGroups' | 'blockedGroups'

const replaceConfigInPlace = (target: Record<string, unknown>, nextValue: Record<string, unknown>) => {
  for (const key of Object.keys(target)) {
    delete target[key]
  }
  Object.assign(target, nextValue)
}

const resolveSourceChannels = async (source: ConfigSource) => {
  const state = await loadConfigState()
  switch (source) {
    case 'global':
      return state.globalSource?.rawConfig?.channels ?? {}
    case 'project':
      return state.projectSource?.rawConfig?.channels ?? {}
    case 'user':
      return state.userSource?.rawConfig?.channels ?? {}
  }
}

export const isAdmin = (ctx: ChannelContext) => {
  const admins = ctx.config?.access?.admins
  const senderId = ctx.inbound.senderId
  return senderId != null && admins?.includes(senderId) === true
}

export const updateChannelConfig = async (
  ctx: ChannelContext,
  updater: (current: NonNullable<typeof ctx.config>) => NonNullable<typeof ctx.config>
) => {
  const current = (ctx.config ?? { type: ctx.inbound.channelType }) as NonNullable<typeof ctx.config>
  const nextConfig = updater({
    ...current,
    access: current.access == null ? undefined : { ...current.access }
  })
  const source = ctx.configSource ?? 'project'
  const sourceChannels = await resolveSourceChannels(source)

  await updateConfigFile({
    source,
    section: 'channels',
    value: {
      ...sourceChannels,
      [ctx.channelKey]: nextConfig
    }
  })

  if (ctx.config) {
    replaceConfigInPlace(ctx.config as Record<string, unknown>, nextConfig as Record<string, unknown>)
  } else {
    ctx.config = nextConfig
  }
}

export const setAccessField = async <TField extends keyof ChannelAccessConfig>(
  ctx: ChannelContext,
  field: TField,
  value: ChannelAccessConfig[TField]
) => {
  await updateChannelConfig(ctx, (current) => {
    const nextAccess: ChannelAccessConfig = {
      ...(current.access ?? {})
    }

    if (value === undefined) {
      delete nextAccess[field]
    } else {
      nextAccess[field] = value
    }

    return {
      ...current,
      access: Object.keys(nextAccess).length > 0 ? nextAccess : undefined
    }
  })
}

export const addToAccessList = async <TField extends AccessListField>(
  ctx: ChannelContext,
  field: TField,
  value: string
) => {
  const currentItems = ctx.config?.access?.[field] ?? []
  await setAccessField(ctx, field, dedupe([...currentItems, value]))
}

export const removeFromAccessList = async <TField extends AccessListField>(
  ctx: ChannelContext,
  field: TField,
  value: string
) => {
  const currentItems = ctx.config?.access?.[field] ?? []
  const nextItems = currentItems.filter((item: string) => item !== value)
  await setAccessField(ctx, field, nextItems.length > 0 ? nextItems : undefined)
}
