import { z } from 'zod'

import type { Config } from '@oneworks/types'

export interface ChannelMap {}

export type ChannelType = keyof ChannelMap

export const channelAccessSchema = z.object({
  // 管理员
  admins: z.array(z.string()).optional().describe(
    '频道管理员账号（sender ID），管理员拥有管理操作权限；blockedGroups 停收时仅允许管理员用 /start 恢复'
  ),
  // 会话类型控制
  allowPrivateChat: z.boolean().optional().describe('是否允许私聊消息，默认 true'),
  allowGroupChat: z.boolean().optional().describe('是否允许群聊消息，默认 true'),
  // 群组访问控制
  allowedGroups: z.array(z.string()).optional().describe('群组白名单（channel ID），设置后仅在指定群中响应'),
  blockedGroups: z.array(z.string()).optional().describe('群组黑名单（channel ID），在指定群中不响应'),
  // 用户访问控制
  allowedSenders: z.array(z.string()).optional().describe('发送者白名单（sender ID），设置后仅白名单内的用户可交互'),
  blockedSenders: z.array(z.string()).optional().describe('发送者黑名单（sender ID），黑名单内的用户消息将被忽略')
})

export type ChannelAccessConfig = z.infer<typeof channelAccessSchema>

export const channelBaseSchema = z.object({
  // 基础配置
  type: z
    .string().min(1)
    .describe('频道类型'),
  title: z
    .string().optional()
    .describe('频道标题'),
  description: z
    .string().optional()
    .describe('频道说明'),
  enabled: z
    .boolean().optional()
    .describe('是否启用'),
  enableWebhook: z
    .boolean().optional()
    .describe('是否启用该 channel 的 HTTP webhook，默认 true'),
  // 会话行为
  systemPrompt: z
    .string().optional()
    .describe('在此频道启动会话时注入的系统提示词'),
  multimodalModel: z
    .string().optional()
    .describe('频道收到图片等多媒体内容时使用的模型；未设置时沿用默认模型'),
  // 指令
  commandPrefix: z
    .string().optional()
    .describe('频道指令前缀，默认 /'),
  groupMessageDebounceMs: z
    .number().int().min(0).max(30000).optional()
    .describe('群聊普通消息防抖合并时间，单位毫秒，默认 1200；设为 0 可关闭'),
  silentSessions: z
    .array(z.string()).optional()
    .describe('静默的 OneWorks session ID 列表；这些 session 不能通过 oneworks channel 主动发送频道消息'),
  language: z
    .enum(['zh', 'en']).optional()
    .describe('频道提示语言，默认 zh'),
  enableSessionMcp: z
    .boolean().optional()
    .describe('是否在通过该频道启动的会话中自动挂载该频道提供的 companion MCP，默认 true'),
  serverBaseUrl: z
    .string().optional()
    .describe(
      '用户可访问的 server 基础地址，例如 http://192.168.1.10:8787 或 https://example.com/oneworks；用于生成频道内跳转和 server 动作链接'
    ),
  sessionDetailBaseUrl: z
    .string().optional()
    .describe(
      '用户可访问的会话详情页面基础地址，例如 https://example.com/ui；用于生成频道内跳转到 server 会话详情的链接'
    ),
  // 访问权限控制
  access: channelAccessSchema
    .optional()
    .describe('频道访问权限配置')
})

export type ChannelBaseConfig = z.infer<typeof channelBaseSchema>

export type ChannelConfigByType<K extends ChannelType> = ChannelBaseConfig & { type: K } & ChannelMap[K]

export type ChannelConfig = {
  [K in ChannelType]: ChannelConfigByType<K>
}[ChannelType]

export interface ChannelSendResult {
  messageId?: string
}

export const MAX_CHANNEL_TEXT_MESSAGE_LENGTH = 200

export const countChannelTextMessageCharacters = (value: string) => Array.from(value).length

export const truncateChannelTextMessage = (
  value: string,
  maxLength = MAX_CHANNEL_TEXT_MESSAGE_LENGTH
) => {
  const characters = Array.from(value)
  if (characters.length <= maxLength) return value
  if (maxLength <= 0) return ''
  if (maxLength === 1) return '…'
  return `${characters.slice(0, maxLength - 1).join('')}…`
}

export interface ChannelEmojiReference {
  aliases?: string[]
  id: string
  label?: string
  metadata?: Record<string, unknown>
  note?: string
  platform: string
  tags?: string[]
}

export interface ChannelTextMention {
  id: string
  label?: string
  platform?: string
  type?: 'all' | 'user'
}

export interface ChannelFollowUp {
  content: string
  i18nContents?: Array<{
    content: string
    language: string
  }>
}

export interface ChannelFileMessage {
  receiveId: string
  receiveIdType: string
  fileName: string
  content: string | Uint8Array
}

export interface ChannelEmojiMessage {
  receiveId: string
  receiveIdType: string
  emoji: ChannelEmojiReference
}

export interface ChannelMediaMessage {
  receiveId: string
  receiveIdType: string
  type: 'file' | 'image'
  src: string
  fileName?: string
}

export interface ChannelConnection<TMessage> {
  sendMessage: (message: TMessage) => Promise<ChannelSendResult | undefined>
  sendEmojiMessage?: (message: ChannelEmojiMessage) => Promise<ChannelSendResult | undefined>
  sendFileMessage?: (message: ChannelFileMessage) => Promise<ChannelSendResult | undefined>
  sendMediaMessage?: (message: ChannelMediaMessage) => Promise<ChannelSendResult | undefined>
  updateMessage?: (messageId: string, message: TMessage) => Promise<ChannelSendResult | undefined>
  handleWebhook?: (request: ChannelWebhookRequest) => Promise<ChannelWebhookResponse>
  pushFollowUps?: (input: {
    messageId: string
    followUps: readonly ChannelFollowUp[]
  }) => Promise<void>
  startReceiving?: (options: {
    channelKey?: string
    handlers: ChannelEventHandlers
  }) => Promise<void>
  /**
   * Called when a new session is being created for this channel.
   * The channel implementation can use this to inject channel-specific context
   * (e.g. bot profile fetched from platform API) into the system prompt.
   */
  generateSystemPrompt?: (inbound: ChannelInboundEvent) => Promise<string | undefined>
  close?: () => Promise<void>
}

export interface ChannelLogger {
  error: (...msg: unknown[]) => void | Promise<void>
  warn: (...msg: unknown[]) => void | Promise<void>
  info: (...msg: unknown[]) => void | Promise<void>
  debug: (...msg: unknown[]) => void | Promise<void>
  trace: (...msg: unknown[]) => void | Promise<void>
}

export interface ChannelConnectionOptions {
  logger?: ChannelLogger
}

export interface ChannelWebhookRequest {
  method: string
  headers: Record<string, string | string[] | undefined>
  query: Record<string, string | string[] | undefined>
  body: unknown
}

export interface ChannelWebhookResponse {
  statusCode?: number
  headers?: Record<string, string>
  body?: unknown
}

export interface ChannelInboundEvent {
  channelType: string
  sessionType: string
  channelId: string
  senderId?: string
  messageId?: string
  text?: string
  replyTo?: {
    receiveId: string
    receiveIdType: string
  }
  ack?: () => Promise<void>
  unack?: () => Promise<void>
  raw: unknown
}

export type ChannelEventHandler<TPayload = unknown> = (payload: TPayload) => void | Promise<void>

export interface ChannelEventHandlers {
  message?: ChannelEventHandler<ChannelInboundEvent>
  [event: string]: ChannelEventHandler | ChannelEventHandler<ChannelInboundEvent> | undefined
}

export interface ChannelSessionMcpContext {
  sessionId: string
  channelKey: string
  channelType: string
  channelId: string
  sessionType: string
  replyReceiveId?: string
  replyReceiveIdType?: string
}

export interface ChannelSessionMcpServer {
  name: string
  config: NonNullable<Config['mcpServers']>[string]
}

export type ResolveChannelSessionMcpServersFn<TConfig = unknown> = (
  config: TConfig,
  context: ChannelSessionMcpContext
) => Promise<readonly ChannelSessionMcpServer[] | undefined> | readonly ChannelSessionMcpServer[] | undefined

export interface ChannelDescriptor<
  TConfigSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TMessageSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
  type: string
  label: string
  description?: string
  configSchema: TConfigSchema
  messageSchema: TMessageSchema
}

export const defineChannelDescriptor = <TConfigSchema extends z.ZodTypeAny, TMessageSchema extends z.ZodTypeAny>(
  descriptor: ChannelDescriptor<TConfigSchema, TMessageSchema>
) => descriptor

export const defineChannel = <TConfigSchema extends z.ZodTypeAny, TMessageSchema extends z.ZodTypeAny>(
  descriptor: ChannelDescriptor<TConfigSchema, TMessageSchema>
) => descriptor

export type ChannelCreateFn<TConfig = unknown, TMessage = unknown> = (
  config: TConfig,
  options?: ChannelConnectionOptions
) => Promise<ChannelConnection<TMessage>>

export const defineCreateChannelConnection = <TConfigSchema extends z.ZodTypeAny, TMessageSchema extends z.ZodTypeAny>(
  connect: ChannelCreateFn<z.infer<TConfigSchema>, z.infer<TMessageSchema>>
): ChannelCreateFn<z.infer<TConfigSchema>, z.infer<TMessageSchema>> => connect

export const defineResolveChannelSessionMcpServers = <TConfig = unknown>(
  resolve: ResolveChannelSessionMcpServersFn<TConfig>
): ResolveChannelSessionMcpServersFn<TConfig> => resolve
