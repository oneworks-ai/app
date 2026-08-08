import { channelDefinition as discordChannelDefinition } from '@oneworks/channel-discord'
import { channelDefinition as imessageChannelDefinition } from '@oneworks/channel-imessage'
import { channelDefinition } from '@oneworks/channel-lark'
import { channelDefinition as qqChannelDefinition } from '@oneworks/channel-qq-channel'
import { channelDefinition as slackChannelDefinition } from '@oneworks/channel-slack'
import { channelDefinition as smsChannelDefinition } from '@oneworks/channel-sms'
import { channelDefinition as telegramChannelDefinition } from '@oneworks/channel-telegram'
import { channelDefinition as wechatChannelDefinition } from '@oneworks/channel-wechat'
import { channelDefinition as wecomChannelDefinition } from '@oneworks/channel-wecom'
import type { ChannelDescriptor } from '@oneworks/core/channel'

export const channelDefinitions: ChannelDescriptor[] = [
  channelDefinition,
  imessageChannelDefinition,
  wecomChannelDefinition,
  qqChannelDefinition,
  slackChannelDefinition,
  discordChannelDefinition,
  telegramChannelDefinition,
  wechatChannelDefinition,
  smsChannelDefinition
]
