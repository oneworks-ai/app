/* eslint-disable max-lines -- Channel manager initialization and public helpers stay colocated. */
import type { ConfigSource, WSEvent } from '@oneworks/core'
import type { ChannelBaseConfig, ChannelInboundEvent, ChannelSessionMcpServer } from '@oneworks/core/channel'

import { logger } from '#~/utils/logger.js'

import { applyChannelServerDefaults } from './defaults'
import type { InitChannelsOptions } from './defaults'
import { handleInboundEvent, handleSessionEvent } from './handlers'
import { enqueueChannelInboundEvent } from './inbound-queue'
import { loadChannelModule } from './loader'
import { sendManualChannelMessage } from './manual-send'
import { logAdminBootstrapAuthorizationCommand } from './middleware/admin-bootstrap'
import { resolveBinding } from './state'
import { sendToolCallJsonFile } from './tool-call-file'
import type { ChannelManager, ChannelRuntimeState } from './types'

export interface ChannelConfigSourceEntry {
  config?: { channels?: Record<string, unknown> }
  source: ConfigSource
}

const collectChannelEntries = (configs: ReadonlyArray<ChannelConfigSourceEntry>) => {
  const entries = new Map<string, { source: ConfigSource; value: unknown }>()
  for (const { config, source } of configs) {
    for (const [key, value] of Object.entries(config?.channels ?? {})) {
      entries.set(key, { source, value })
    }
  }
  return entries
}

let channelManager: ChannelManager | null = null

const getChannelLogContext = (key: string, type: string, configSource: ConfigSource) => ({
  channelKey: key,
  channelType: type,
  configSource
})

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const initChannels = async (
  configs: ReadonlyArray<ChannelConfigSourceEntry>,
  options: InitChannelsOptions = {}
): Promise<ChannelManager> => {
  const channels = collectChannelEntries(configs)
  const states = new Map<string, ChannelRuntimeState>()
  for (const [key, entry] of channels.entries()) {
    const value = entry.value
    if (value == null || typeof value !== 'object') {
      logger.warn(
        { channelKey: key, configSource: entry.source, valueType: value == null ? 'nullish' : typeof value },
        '[channels] skipped invalid channel config entry'
      )
      continue
    }
    const rawConfig = applyChannelServerDefaults(value as Record<string, unknown>, options)
    const type = rawConfig.type
    if (typeof type !== 'string' || type === '') {
      logger.warn(
        { channelKey: key, configSource: entry.source },
        '[channels] skipped channel config without a valid type'
      )
      continue
    }

    const logContext = getChannelLogContext(key, type, entry.source)
    let connection: ChannelRuntimeState['connection']
    try {
      const mod = loadChannelModule(type)
      if (rawConfig.enabled === false) {
        states.set(key, { key, type, status: 'disabled', configSource: entry.source })
        logger.info(logContext, '[channels] channel disabled by config')
        continue
      }
      const parsed = mod.definition.configSchema.safeParse(rawConfig)
      if (parsed.success === false) {
        const error = parsed.error?.message ?? 'Invalid channel config'
        states.set(key, { key, type, status: 'error', error, configSource: entry.source })
        logger.error({ ...logContext, error }, '[channels] channel config validation failed')
        continue
      }
      const connectionConfig = parsed.success ? parsed.data : rawConfig
      connection = await mod.create(connectionConfig, { logger })
      const state: ChannelRuntimeState = {
        key,
        type,
        status: 'connected',
        connection,
        config: connectionConfig as ChannelBaseConfig,
        configSource: entry.source
      }
      await connection.startReceiving?.({
        channelKey: key,
        handlers: {
          message: async (event: ChannelInboundEvent) =>
            await enqueueChannelInboundEvent(
              key,
              event,
              async () => await handleInboundEvent(key, event, connection, state.config, state.configSource)
            )
        }
      })
      states.set(key, state)
      logAdminBootstrapAuthorizationCommand({
        channelKey: key,
        channelType: type,
        config: state.config,
        configSource: state.configSource
      })
      logger.info(logContext, '[channels] channel connected')
    } catch (err) {
      if (connection != null) {
        try {
          await connection.close?.()
        } catch (closeError) {
          logger.warn(
            { ...logContext, error: getErrorMessage(closeError) },
            '[channels] failed to close channel connection after init failure'
          )
        }
      }

      const error = getErrorMessage(err)
      states.set(key, {
        key,
        type,
        status: 'error',
        error,
        configSource: entry.source
      })
      logger.error({ ...logContext, error }, '[channels] channel initialization failed')
    }
  }

  const closeAll = async () => {
    for (const state of states.values()) {
      await state.connection?.close?.()
    }
  }

  const manager: ChannelManager = {
    states,
    handleSessionEvent: async (sessionId: string, event: WSEvent) => await handleSessionEvent(states, sessionId, event),
    closeAll
  }
  channelManager = manager
  return manager
}

export const handleChannelSessionEvent = async (sessionId: string, event: WSEvent) => {
  if (!channelManager) return false
  return await channelManager.handleSessionEvent(sessionId, event)
}

export const getChannelManager = () => channelManager

export const resolveChannelSessionMcpServers = async (sessionId: string) => {
  if (!channelManager) {
    return {} satisfies Record<string, ChannelSessionMcpServer['config']>
  }

  const binding = resolveBinding(sessionId)
  if (binding == null) {
    return {} satisfies Record<string, ChannelSessionMcpServer['config']>
  }

  const state = channelManager.states.get(binding.channelKey)
  if (state?.config == null) {
    return {} satisfies Record<string, ChannelSessionMcpServer['config']>
  }

  const mod = loadChannelModule(state.type)
  const servers = await mod.resolveSessionMcpServers?.(state.config, {
    sessionId,
    channelKey: binding.channelKey,
    channelType: binding.channelType,
    channelId: binding.channelId,
    sessionType: binding.sessionType,
    replyReceiveId: binding.replyReceiveId,
    replyReceiveIdType: binding.replyReceiveIdType
  })

  return Object.fromEntries(
    (servers ?? []).map(server => [server.name, server.config])
  ) satisfies Record<string, ChannelSessionMcpServer['config']>
}

export const sendChannelToolCallJsonFile = async (
  sessionId: string,
  toolUseId: string,
  messageId?: string
) => {
  if (channelManager == null) {
    return {
      ok: false,
      statusCode: 503,
      message: 'channel manager 还没有初始化。'
    }
  }

  return await sendToolCallJsonFile(channelManager.states, {
    sessionId,
    toolUseId,
    messageId
  })
}

export const sendChannelMessage = async (input: {
  channelKey: string
  cwd?: string
  mentions?: unknown
  payload: unknown
  receiveId?: string
  receiveIdType?: string
  sessionId?: string
}) => {
  if (channelManager == null) {
    return {
      ok: false as const,
      statusCode: 503,
      message: 'channel manager 还没有初始化。'
    }
  }

  return await sendManualChannelMessage(channelManager.states, input)
}
