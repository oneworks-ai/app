import { Client, Domain, EventDispatcher, WSClient } from '@larksuiteoapi/node-sdk'
import { Buffer } from 'node:buffer'

import type {
  ChannelConnection,
  ChannelConversationAvailabilityEvent,
  ChannelFileMessage,
  ChannelFollowUp,
  ChannelInboundEvent,
  ChannelLogger,
  ChannelNavigationReference
} from '@oneworks/core/channel'
import { defineCreateChannelConnection } from '@oneworks/core/channel'

import type {
  LarkBotInfoResponse,
  LarkChannelConfig,
  LarkChannelMessage,
  LarkMessagePayload,
  LarkPushFollowUpsResponse,
  LarkSendMessageResponse
} from '#~/types.js'

import { buildLarkOpenApiUrl } from './utils/open-api'
import { resolveLarkOutboundMessagePayload } from './utils/outbound-message'
import { parseLarkContent } from './utils/parse'
import { createTenantTokenProvider } from './utils/tenant-token'
import { resolveLarkId } from './utils/text-format'
import { buildToolCallSummaryCard } from './utils/tool-call-card'

const ensureLarkSuccess = <T extends { code?: number; msg?: string }>(label: string, result: T) => {
  if (result.code != null && result.code !== 0) {
    throw new Error(`${label}: ${result.msg ?? 'unknown error'}`)
  }
  return result
}

const ensureLarkMessageSuccess = (label: string, result: LarkSendMessageResponse) => {
  const success = ensureLarkSuccess(label, result)
  return { messageId: success.data?.message_id }
}

const sendLarkMessage = async (
  client: Client,
  message: LarkChannelMessage,
  logger?: ChannelLogger
) => {
  if (message.toolCallSummary != null && message.toolCallSummary.items.length > 0) {
    try {
      const result = await client.im.message.create({
        params: {
          receive_id_type: message.receiveIdType
        },
        data: {
          receive_id: message.receiveId,
          msg_type: 'interactive',
          content: JSON.stringify(buildToolCallSummaryCard(message.toolCallSummary))
        }
      }) as LarkSendMessageResponse
      return ensureLarkMessageSuccess('Lark tool summary card send failed', result)
    } catch (error) {
      await logger?.warn?.({
        receiveId: message.receiveId,
        receiveIdType: message.receiveIdType,
        error: error instanceof Error ? error.message : String(error)
      }, '[lark] Failed to send tool summary card, falling back to text message')
    }
  }

  const outbound = resolveLarkOutboundMessagePayload(message)
  const result = await client.im.message.create({
    params: {
      receive_id_type: message.receiveIdType
    },
    data: {
      receive_id: message.receiveId,
      msg_type: outbound.msgType,
      content: outbound.content ?? JSON.stringify({ text: message.text })
    }
  }) as LarkSendMessageResponse
  return ensureLarkMessageSuccess('Lark message send failed', result)
}

const updateLarkMessage = async (
  client: Client,
  messageId: string,
  message: LarkChannelMessage,
  logger?: ChannelLogger
) => {
  if (message.toolCallSummary != null && message.toolCallSummary.items.length > 0) {
    try {
      const result = await client.im.message.patch({
        path: {
          message_id: messageId
        },
        data: {
          content: JSON.stringify(buildToolCallSummaryCard(message.toolCallSummary))
        }
      }) as LarkSendMessageResponse
      return ensureLarkMessageSuccess('Lark tool summary card update failed', result)
    } catch (error) {
      await logger?.warn?.({
        messageId,
        error: error instanceof Error ? error.message : String(error)
      }, '[lark] Failed to update tool summary card, falling back to text update')
    }
  }

  const outbound = resolveLarkOutboundMessagePayload(message)
  const result = await client.im.message.update({
    path: {
      message_id: messageId
    },
    data: {
      msg_type: outbound.msgType === 'interactive' ? 'text' : outbound.msgType,
      content: outbound.content ?? JSON.stringify({ text: message.text })
    }
  }) as LarkSendMessageResponse
  return ensureLarkMessageSuccess('Lark message update failed', result)
}

const sendLarkFileMessage = async (
  client: Client,
  message: ChannelFileMessage
) => {
  const fileBytes = typeof message.content === 'string'
    ? Buffer.from(message.content, 'utf8')
    : Buffer.from(message.content)
  const uploadResult = ensureLarkSuccess(
    'Lark file upload failed',
    await client.im.file.create({
      data: {
        file_type: 'stream',
        file_name: message.fileName,
        file: fileBytes
      }
    }) as { code?: number; msg?: string; file_key?: string }
  )
  if (uploadResult.file_key == null || uploadResult.file_key === '') {
    throw new Error('Lark file upload failed: missing file_key')
  }

  return await ensureLarkMessageSuccess(
    'Lark file send failed',
    await client.im.message.create({
      params: {
        receive_id_type: message.receiveIdType as LarkChannelMessage['receiveIdType']
      },
      data: {
        receive_id: message.receiveId,
        msg_type: 'file',
        content: JSON.stringify({ file_key: uploadResult.file_key })
      }
    }) as LarkSendMessageResponse
  )
}

const pushLarkFollowUps = async (
  messageId: string,
  followUps: readonly ChannelFollowUp[],
  tenantTokenProvider: () => Promise<string | undefined>,
  domain?: LarkChannelConfig['domain']
) => {
  const accessToken = await tenantTokenProvider()
  if (!accessToken) {
    throw new Error('Lark push follow up failed: missing tenant access token')
  }

  const response = await globalThis.fetch(
    buildLarkOpenApiUrl(`/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/push_follow_up`, domain),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        follow_ups: followUps.map(followUp => ({
          content: followUp.content,
          i18n_contents: followUp.i18nContents?.map(item => ({
            content: item.content,
            language: item.language
          }))
        }))
      })
    }
  )

  if (!response.ok) {
    throw new Error(`Lark push follow up failed: HTTP ${response.status ?? 0}`)
  }

  const result = await response.json().catch(() => undefined) as LarkPushFollowUpsResponse | undefined
  if (result?.code != null && result.code !== 0) {
    throw new Error(`Lark push follow up failed: ${result.msg ?? 'unknown error'}`)
  }
}

const reactionPool = [
  'STRIVE',
  'MeMeMe',
  'Typing',
  'OnIt',
  'OneSecond',
  'SHAKE',
  'HIGHFIVE',
  'SaluteFace'
]

const buildLarkNavigation = (domain: LarkChannelConfig['domain']): ChannelNavigationReference => ({
  appHomeUrl: domain === 'Lark'
    ? 'https://www.larksuite.com/messenger/'
    : 'https://www.feishu.cn/messenger/',
  embeddable: false
})

const toStandardSessionType = (chatType: string) => {
  if (chatType === 'p2p') return 'direct'
  return 'group'
}

const resolveCurrentBotOpenId = async (client: Client) => {
  const result = ensureLarkSuccess(
    'Lark bot identity resolution failed',
    await client.request<LarkBotInfoResponse>({
      url: '/open-apis/bot/v3/info',
      method: 'GET'
    })
  )
  const openId = result.bot?.open_id
  if (openId == null || openId === '') {
    throw new Error('Lark bot identity resolution failed: missing bot open_id')
  }
  return openId
}

const toChannelInboundEvent = async (
  payload: LarkMessagePayload,
  client: Client,
  options?: {
    currentBotOpenId?: string
    navigation?: ChannelNavigationReference
    tenantTokenProvider?: () => Promise<string | undefined>
  }
): Promise<ChannelInboundEvent | null> => {
  const message = payload.message
  if (message == null || message.chat_id == null || message.chat_type == null) {
    return null
  }
  const senderId = resolveLarkId(payload.sender?.sender_id)
  let reactionId: string | undefined
  let acked = false
  const emojiType = reactionPool[Math.floor(Math.random() * reactionPool.length)]
  const ack = async () => {
    if (acked) return
    if (message.message_id == null) return
    const res = await client.im.v1.messageReaction.create({
      path: {
        message_id: message.message_id
      },
      data: {
        reaction_type: {
          emoji_type: emojiType
        }
      }
    })
    if (res.code == null || res.code === 0) {
      reactionId = res.data?.reaction_id
      acked = true
    }
  }
  const unack = async () => {
    if (!acked) return
    if (message.message_id == null || reactionId == null) return
    const res = await client.im.v1.messageReaction.delete({
      path: {
        message_id: message.message_id,
        reaction_id: reactionId
      }
    })
    void res
  }

  const parsed = await parseLarkContent({
    content: message.content,
    mentions: message.mentions,
    client,
    tenantTokenProvider: options?.tenantTokenProvider
  })
  const rawText = parsed.rawText
  const formattedText = parsed.formattedText
  const displayText = formattedText?.replace(
    /<at\s+type="lark"\s+user_id="[^"]*">([^<]*)<\/at>/gu,
    '@$1'
  )
  const groupMentions = message.chat_type === 'group' ? message.mentions : undefined
  const mentionedBot = groupMentions == null || groupMentions.length === 0
    ? undefined
    : groupMentions.some(mention => mention.id?.open_id === options?.currentBotOpenId)

  return {
    channelType: 'lark',
    sessionType: toStandardSessionType(message.chat_type),
    channelId: message.chat_id,
    mentionedBot,
    senderId,
    messageId: message.message_id,
    ...(options?.navigation != null ? { navigation: options.navigation } : {}),
    replyMessageId: message.parent_id || undefined,
    rootMessageId: message.root_id || undefined,
    threadId: message.thread_id ?? message.root_id ?? message.parent_id,
    displayText,
    text: formattedText,
    replyTo: {
      receiveId: message.chat_id,
      receiveIdType: 'chat_id'
    },
    ack,
    unack,
    raw: {
      payload,
      rawText,
      formattedText,
      contentItems: parsed.contentItems,
      images: parsed.images,
      rich: parsed.rich
    }
  }
}

export const createChannelConnection = defineCreateChannelConnection(async (
  config: LarkChannelConfig,
  options?: {
    logger?: ChannelLogger
  }
): Promise<ChannelConnection<LarkChannelMessage>> => {
  const logger = options?.logger
  const domain = {
    Feishu: Domain.Feishu,
    Lark: Domain.Lark
  }[config.domain ?? 'Feishu']
  const commonClientOptions = {
    appId: config.appId,
    appSecret: config.appSecret,
    domain,
    logger
  }
  const client = new Client({
    ...commonClientOptions
  })
  const wsClient = new WSClient({
    ...commonClientOptions
  })
  const tenantTokenProvider = createTenantTokenProvider(config)
  const navigation = buildLarkNavigation(config.domain ?? 'Feishu')
  const withNavigation = async <Result extends { messageId?: string }>(result: Promise<Result>) => ({
    ...await result,
    navigation
  })
  return {
    sendMessage: async (message) => {
      return await withNavigation(sendLarkMessage(client, message, logger))
    },
    sendPrivateMessage: async ({ accountId, text }) => {
      return await withNavigation(sendLarkMessage(client, {
        receiveId: accountId,
        receiveIdType: 'open_id',
        text
      }, logger))
    },
    sendFileMessage: async (message) => {
      return await withNavigation(sendLarkFileMessage(client, message))
    },
    updateMessage: async (messageId, message) => {
      return await withNavigation(updateLarkMessage(client, messageId, message, logger))
    },
    pushFollowUps: async ({ messageId, followUps }) => {
      await pushLarkFollowUps(messageId, followUps, tenantTokenProvider, config.domain)
    },
    startReceiving: async ({ handlers }) => {
      const currentBotOpenId = await resolveCurrentBotOpenId(client)
      const dispatcher = new EventDispatcher({})
      const reportAvailability = async (
        payload: { app_id?: string; chat_id?: string },
        status: ChannelConversationAvailabilityEvent['status'],
        reason?: string
      ) => {
        if (payload.chat_id == null || (payload.app_id != null && payload.app_id !== config.appId)) return
        await handlers.availability?.({
          channelId: payload.chat_id,
          channelType: 'lark',
          ...(reason == null ? {} : { reason }),
          status
        })
      }
      dispatcher.register({
        'im.chat.disbanded_v1': async (payload: { chat_id?: string }) => {
          await reportAvailability(payload, 'unavailable', 'The Lark group was disbanded.')
        },
        'im.chat.member.bot.added_v1': async (payload: { app_id?: string; chat_id?: string }) => {
          await reportAvailability(payload, 'active')
        },
        'im.chat.member.bot.deleted_v1': async (payload: { app_id?: string; chat_id?: string }) => {
          await reportAvailability(payload, 'unavailable', 'The Lark bot was removed from the group.')
        },
        'im.message.receive_v1': async (payload: unknown) => {
          const inbound = await toChannelInboundEvent(payload as LarkMessagePayload, client, {
            currentBotOpenId,
            navigation,
            tenantTokenProvider
          })
          if (inbound == null) return
          await handlers.message?.(inbound)
        }
      })
      await wsClient.start({
        eventDispatcher: dispatcher
      })
    },
    close: async () => wsClient.close()
  }
})
