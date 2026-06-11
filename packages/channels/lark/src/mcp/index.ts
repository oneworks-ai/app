import { createRequire } from 'node:module'
import { dirname, resolve as resolvePath } from 'node:path'
import process from 'node:process'

import { defineResolveChannelSessionMcpServers } from '@oneworks/core/channel'

import type { LarkChannelConfig } from '../types.js'

const nodeRequire = createRequire(__filename)

const resolveMcpCliPath = () => {
  const packageJsonPath = nodeRequire.resolve('@oneworks/channel-lark/package.json')
  return resolvePath(dirname(packageJsonPath), 'mcp.js')
}

const sanitizeServerNamePart = (value: string) => {
  const sanitized = value.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized === '' ? 'default' : sanitized
}

export const resolveChannelSessionMcpServers = defineResolveChannelSessionMcpServers<LarkChannelConfig>(
  (config, context) => {
    if (config.enableSessionMcp === false) {
      return []
    }

    return [
      {
        name: `channel-lark-${sanitizeServerNamePart(context.channelKey)}`,
        config: {
          command: process.execPath,
          args: [resolveMcpCliPath()],
          env: {
            ONEWORKS_LARK_APP_ID: config.appId,
            ONEWORKS_LARK_APP_SECRET: config.appSecret,
            ONEWORKS_LARK_DOMAIN: config.domain ?? 'Feishu',
            ONEWORKS_CHANNEL_SESSION_ID: context.sessionId,
            ONEWORKS_CHANNEL_KEY: context.channelKey,
            ONEWORKS_CHANNEL_TYPE: context.channelType,
            ONEWORKS_CHANNEL_ID: context.channelId,
            ONEWORKS_CHANNEL_SESSION_TYPE: context.sessionType,
            ONEWORKS_LARK_DEFAULT_RECEIVE_ID: context.replyReceiveId ?? context.channelId,
            ONEWORKS_LARK_DEFAULT_RECEIVE_ID_TYPE: context.replyReceiveIdType ?? 'chat_id',
            ...(context.replyReceiveId == null ? {} : { ONEWORKS_CHANNEL_REPLY_RECEIVE_ID: context.replyReceiveId }),
            ...(context.replyReceiveIdType == null
              ? {}
              : { ONEWORKS_CHANNEL_REPLY_RECEIVE_ID_TYPE: context.replyReceiveIdType })
          }
        }
      }
    ] as const
  }
)

export { registerLarkMcpTools } from './register.js'
