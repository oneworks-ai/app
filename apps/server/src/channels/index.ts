/* eslint-disable max-lines -- Channel manager initialization and public helpers stay colocated. */
import type { ConfigSource, WSEvent } from '@oneworks/core'
import type { ChannelBaseConfig, ChannelInboundEvent, ChannelSessionMcpServer } from '@oneworks/core/channel'

import { getDb } from '#~/db/index.js'
import { loadChannelLinks } from '#~/services/channel-links/index.js'
import { logger } from '#~/utils/logger.js'

import { invokeChannelCommandForState, listInvokableChannelCommandTools } from './command-invocation'
import type { ChannelCommandInvocationInput } from './command-invocation'
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

const migrateUnambiguousLegacyIdentityNamespaces = (
  channels: ReadonlyMap<string, { source: ConfigSource; value: unknown }>
) => {
  const issuerKeysByType = new Map<string, Set<string>>()
  for (const [key, entry] of channels) {
    if (entry.value == null || typeof entry.value !== 'object') continue
    const type = (entry.value as Record<string, unknown>).type
    if (typeof type !== 'string' || type.trim() === '') continue
    const issuerKeys = issuerKeysByType.get(type) ?? new Set<string>()
    issuerKeys.add(key)
    issuerKeysByType.set(type, issuerKeys)
  }

  for (const [channelType, issuerKeys] of issuerKeysByType) {
    if (issuerKeys.size !== 1) {
      logger.warn(
        { channelType, issuerKeys: [...issuerKeys] },
        '[channels] skipped ambiguous legacy identity namespace migration'
      )
      continue
    }
    const issuerKey = [...issuerKeys][0]!
    const result = getDb().migrateLegacyChannelIdentityNamespace({ channelType, issuerKey })
    if (Object.values(result).some(count => count > 0)) {
      logger.info(
        { channelType, issuerKey, ...result },
        '[channels] migrated legacy identity namespace'
      )
    }
  }
}

let channelManager: ChannelManager | null = null

const getChannelLogContext = (key: string, type: string, configSource: ConfigSource) => ({
  channelKey: key,
  channelType: type,
  configSource
})

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const loadChannelLinksForRuntime = async () => {
  return await loadChannelLinks()
}

export const initChannels = async (
  configs: ReadonlyArray<ChannelConfigSourceEntry>,
  options: InitChannelsOptions = {}
): Promise<ChannelManager> => {
  const channels = collectChannelEntries(configs)
  migrateUnambiguousLegacyIdentityNamespaces(channels)
  const channelLinks = await loadChannelLinksForRuntime()
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
    const matchedChannelLinks = channelLinks.filter(link => link.channelKey === key)
    let connection: ChannelRuntimeState['connection']
    try {
      const mod = loadChannelModule(type)
      if (rawConfig.enabled === false) {
        states.set(key, {
          key,
          type,
          status: 'disabled',
          configSource: entry.source,
          channelLinks: matchedChannelLinks
        })
        logger.info(logContext, '[channels] channel disabled by config')
        continue
      }
      const parsed = mod.definition.configSchema.safeParse(rawConfig)
      if (parsed.success === false) {
        const error = parsed.error?.message ?? 'Invalid channel config'
        states.set(key, {
          key,
          type,
          status: 'error',
          error,
          configSource: entry.source,
          channelLinks: matchedChannelLinks
        })
        logger.error({ ...logContext, error }, '[channels] channel config validation failed')
        continue
      }
      const connectionConfig = parsed.success ? parsed.data : rawConfig
      connection = await mod.create(connectionConfig, {
        channelKey: key,
        logger,
        outboundStore: {
          upsert: delivery => {
            getDb().upsertChannelOutboundDelivery(delivery)
          }
        },
        webhookNonceStore: {
          commit: input => {
            getDb().commitChannelWebhookNonce(input)
          },
          release: input => {
            getDb().releaseChannelWebhookNonce(input)
          },
          reserve: input => getDb().reserveChannelWebhookNonce(input)
        }
      })
      const state: ChannelRuntimeState = {
        key,
        type,
        status: 'connected',
        connection,
        config: connectionConfig as ChannelBaseConfig,
        configSource: entry.source,
        channelLinks: matchedChannelLinks,
        resolveRuntime: channelKey => states.get(channelKey)
      }
      await connection.startReceiving?.({
        channelKey: key,
        handlers: {
          message: async (event: ChannelInboundEvent) =>
            await enqueueChannelInboundEvent(
              key,
              event,
              async () =>
                await handleInboundEvent(
                  key,
                  event,
                  connection,
                  state.config,
                  state.configSource,
                  state.channelLinks
                )
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
        configSource: entry.source,
        channelLinks: matchedChannelLinks
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

interface ChannelDebugOutboundConnection {
  clearLocalOutboxMessages?: () => Promise<void> | void
  getLocalOutboxMessages?: () => unknown[]
}

const getDebugOutboundConnection = (input: { channelKey: string }) => {
  if (channelManager == null) {
    return {
      ok: false as const,
      statusCode: 503,
      message: 'channel manager 还没有初始化。'
    }
  }

  const state = channelManager.states.get(input.channelKey)
  if (state == null) {
    return {
      ok: false as const,
      statusCode: 404,
      message: `Channel ${input.channelKey} was not found.`
    }
  }

  if (state.status !== 'connected' || state.connection == null) {
    return {
      ok: false as const,
      statusCode: 409,
      message: `Channel ${input.channelKey} is not connected.`
    }
  }

  const connection = state.connection as ChannelDebugOutboundConnection
  if (typeof connection.getLocalOutboxMessages !== 'function') {
    return {
      ok: false as const,
      statusCode: 404,
      message: `Channel ${input.channelKey} does not expose debug outbound messages.`
    }
  }

  return {
    connection,
    ok: true as const
  }
}

export const listChannelDebugOutboundMessages = (input: { channelKey: string }) => {
  const resolved = getDebugOutboundConnection(input)
  if (!resolved.ok) return resolved
  return {
    ok: true as const,
    messages: resolved.connection.getLocalOutboxMessages?.() ?? []
  }
}

export const clearChannelDebugOutboundMessages = async (input: { channelKey: string }) => {
  const resolved = getDebugOutboundConnection(input)
  if (!resolved.ok) return resolved
  await resolved.connection.clearLocalOutboxMessages?.()
  return {
    ok: true as const
  }
}

export const listChannelCommandToolsForRuntime = () => listInvokableChannelCommandTools()

export const invokeChannelCommand = async (input: ChannelCommandInvocationInput & { channelKey: string }) => {
  if (channelManager == null) {
    return {
      ok: false as const,
      statusCode: 503,
      message: 'channel manager 还没有初始化。'
    }
  }

  const state = channelManager.states.get(input.channelKey)
  if (state == null) {
    return {
      ok: false as const,
      statusCode: 404,
      message: `Channel ${input.channelKey} was not found.`
    }
  }

  if (state.status !== 'connected') {
    return {
      ok: false as const,
      statusCode: 409,
      message: `Channel ${input.channelKey} is not connected.`
    }
  }

  return await invokeChannelCommandForState(state, input)
}
