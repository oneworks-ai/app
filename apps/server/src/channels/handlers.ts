import type { ConfigSource, WSEvent } from '@oneworks/core'
import { truncateChannelTextMessage } from '@oneworks/core/channel'
import type { ChannelBaseConfig, ChannelConnection, ChannelInboundEvent } from '@oneworks/core/channel'

import { getDb } from '#~/db/index.js'
import { createServerAdapterAccountContext, isMissingAdapterPackageError } from '#~/services/adapter-accounts.js'
import { extractTextFromMessage } from '#~/services/session/events.js'
import { killSession, startAdapterSession } from '#~/services/session/index.js'
import { notifySessionUpdated } from '#~/services/session/runtime.js'
import { resolveSessionWorkspace } from '#~/services/session/workspace.js'
import { getSessionLogger, logger } from '#~/utils/logger.js'

import { buildInteractionText } from './interaction'
import { pipeline } from './middleware'
import type { ChannelContext, ChannelTextMessage } from './middleware/@types'
import { bindChannelSession } from './middleware/bind-session'
import { defineMessages } from './middleware/i18n'
import { isChannelSessionStopEvent } from './session-delivery'
import { buildChannelActionUrl, buildToolCallDetailUrl } from './session-detail-url'
import {
  clearAutoDeliveryState,
  clearPendingToolCallDisplay,
  consumePendingUnack,
  deleteBinding,
  resolveAutoDeliveryState,
  resolveBinding,
  resolvePendingToolCallDisplay,
  runPendingToolCallDisplayUpdate,
  setPendingToolCallDisplay
} from './state'
import { buildToolCallSummaryText, extractToolCallSummary, mergeToolCallSummaries } from './tool-call-summary'
import type { ChannelRuntimeState } from './types'

const normalizeSearchText = (value: string | undefined) => value?.trim().toLowerCase() ?? ''
const MAX_CHANNEL_ERROR_MESSAGE_LENGTH = 800
const MAX_CHANNEL_LOG_TEXT_PREVIEW_LENGTH = 160

type ChannelErrorEvent = Extract<WSEvent, { type: 'error' }>

const truncateChannelErrorMessage = (value: string) => {
  if (value.length <= MAX_CHANNEL_ERROR_MESSAGE_LENGTH) return value
  return `${value.slice(0, MAX_CHANNEL_ERROR_MESSAGE_LENGTH - 3)}...`
}

const truncateChannelLogTextPreview = (value: string) => {
  if (value.length <= MAX_CHANNEL_LOG_TEXT_PREVIEW_LENGTH) return value
  return `${value.slice(0, MAX_CHANNEL_LOG_TEXT_PREVIEW_LENGTH - 3)}...`
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const buildChannelMessageLogContext = (
  message: ChannelTextMessage,
  extra?: Record<string, unknown>
) => ({
  ...extra,
  receiveId: message.receiveId,
  receiveIdType: message.receiveIdType,
  textLength: message.text.length,
  textPreview: truncateChannelLogTextPreview(message.text),
  hasToolCallSummary: message.toolCallSummary != null
})

const limitChannelTextMessage = (message: ChannelTextMessage): ChannelTextMessage => {
  const text = truncateChannelTextMessage(message.text)
  return text === message.text ? message : { ...message, text }
}

const buildChannelErrorText = (language: string, event: ChannelErrorEvent) => {
  const isEnglish = language === 'en'
  const message = truncateChannelErrorMessage(event.message?.trim() || event.data.message.trim())
  const code = event.data.code?.trim()
  const errorLine = code == null || code === '' ? message : `${code}: ${message}`

  return isEnglish
    ? [
      'Task execution failed and stopped.',
      '',
      `Error: ${errorLine}`,
      '',
      'Open the web session or server log for details.'
    ].join('\n')
    : [
      '任务执行失败，已停止回复。',
      '',
      `错误：${errorLine}`,
      '',
      '可以打开 Web 会话或服务端日志查看详情。'
    ].join('\n')
}

const matchesSessionSearch = (session: ReturnType<ReturnType<typeof getDb>['getSession']>, query: string) => {
  const normalizedQuery = normalizeSearchText(query)
  if (normalizedQuery === '') return true
  const haystack = [
    session?.id,
    session?.title,
    session?.lastMessage,
    session?.lastUserMessage,
    session?.model,
    session?.adapter,
    ...(session?.tags ?? [])
  ]
    .map(value => normalizeSearchText(value))
    .filter(Boolean)
    .join('\n')
  return haystack.includes(normalizedQuery)
}

export const handleInboundEvent = async (
  channelKey: string,
  inbound: ChannelInboundEvent,
  connection: ChannelConnection<ChannelTextMessage> | undefined,
  config?: ChannelBaseConfig,
  configSource?: ConfigSource
) => {
  const ctx: ChannelContext = {
    channelKey,
    configSource,
    inbound,
    connection,
    config,
    sessionId: undefined,
    channelAdapter: undefined,
    channelPermissionMode: undefined,
    channelEffort: undefined,
    contentItems: undefined,
    commandText: '',
    defineMessages,
    t: (key) => key,
    reply: async (text: string) => {
      if (!connection) return undefined
      const receiveId = inbound.replyTo?.receiveId ?? inbound.channelId
      const receiveIdType = inbound.replyTo?.receiveIdType ?? 'chat_id'
      const message = limitChannelTextMessage({ receiveId, receiveIdType, text })
      const startedAt = Date.now()
      logger.info(
        buildChannelMessageLogContext(message, {
          channelKey,
          channelType: inbound.channelType,
          channelId: inbound.channelId,
          sessionType: inbound.sessionType
        }),
        '[channel] Sending inbound pipeline reply to channel'
      )
      try {
        const result = await connection.sendMessage(message)
        logger.info(
          buildChannelMessageLogContext(message, {
            channelKey,
            channelType: inbound.channelType,
            channelId: inbound.channelId,
            sessionType: inbound.sessionType,
            messageId: result?.messageId,
            elapsedMs: Date.now() - startedAt
          }),
          '[channel] Sent inbound pipeline reply to channel'
        )
        return result
      } catch (error) {
        logger.error(
          buildChannelMessageLogContext(message, {
            channelKey,
            channelType: inbound.channelType,
            channelId: inbound.channelId,
            sessionType: inbound.sessionType,
            elapsedMs: Date.now() - startedAt,
            error: getErrorMessage(error)
          }),
          '[channel] Failed to send inbound pipeline reply to channel'
        )
        throw error
      }
    },
    pushFollowUps: async ({ messageId, followUps }) => {
      if (!connection?.pushFollowUps || !messageId || followUps.length === 0) return
      await connection.pushFollowUps({ messageId, followUps })
    },
    getBoundSession: () => {
      if (!ctx.sessionId) return undefined
      return getDb().getSession(ctx.sessionId)
    },
    searchSessions: (query) => {
      const db = getDb()
      const sessions = db.getSessions('all')
        .filter(session => matchesSessionSearch(session, query))
      return sessions.map(session => {
        const binding = db.getChannelSessionBySessionId(session.id)
        return {
          session,
          binding: binding == null
            ? undefined
            : {
              channelType: binding.channelType,
              sessionType: binding.sessionType,
              channelId: binding.channelId,
              channelKey: binding.channelKey
            }
        }
      })
    },
    bindSession: (sessionId) => {
      const db = getDb()
      const session = db.getSession(sessionId)
      if (session == null) {
        return { alreadyBound: false }
      }
      const bindingResult = bindChannelSession({
        channelType: inbound.channelType,
        sessionType: inbound.sessionType,
        channelId: inbound.channelId,
        channelKey,
        senderId: inbound.senderId,
        replyReceiveId: inbound.replyTo?.receiveId,
        replyReceiveIdType: inbound.replyTo?.receiveIdType,
        sessionId
      })
      if (bindingResult.previousSessionId != null && bindingResult.previousSessionId !== sessionId) {
        deleteBinding(bindingResult.previousSessionId)
      }
      ctx.sessionId = sessionId
      return {
        alreadyBound: bindingResult.alreadyBound,
        session,
        previousSessionId: bindingResult.previousSessionId,
        transferredFrom: bindingResult.transferredFrom == null
          ? undefined
          : {
            channelType: bindingResult.transferredFrom.channelType,
            sessionType: bindingResult.transferredFrom.sessionType,
            channelId: bindingResult.transferredFrom.channelId,
            channelKey: bindingResult.transferredFrom.channelKey
          }
      }
    },
    unbindSession: () => {
      const currentBinding = getDb().getChannelSession(inbound.channelType, inbound.sessionType, inbound.channelId)
      const sessionId = currentBinding?.sessionId ?? ctx.sessionId
      getDb().deleteChannelSession(inbound.channelType, inbound.sessionType, inbound.channelId)
      if (sessionId) {
        deleteBinding(sessionId)
      }
      ctx.sessionId = undefined
      return { sessionId }
    },
    resetSession: () => {
      const { sessionId } = ctx
      if (sessionId) {
        const updatedIds = getDb().updateSessionArchivedWithChildren(sessionId, true)
        for (const updatedId of updatedIds) {
          const updatedSession = getDb().getSession(updatedId)
          if (updatedSession != null) {
            notifySessionUpdated(updatedId, updatedSession)
          }
        }
        getDb().deleteChannelSessionBySessionId(sessionId)
        deleteBinding(sessionId)
        ctx.sessionId = undefined
      }
    },
    stopSession: () => {
      if (ctx.sessionId) {
        killSession(ctx.sessionId)
      }
    },
    restartSession: async () => {
      if (ctx.sessionId) {
        killSession(ctx.sessionId)
        await startAdapterSession(ctx.sessionId)
      }
    },
    resolveSessionWorkspace: async (sessionId) => {
      const targetSessionId = sessionId ?? ctx.sessionId
      if (targetSessionId == null || targetSessionId === '') {
        return undefined
      }
      return await resolveSessionWorkspace(targetSessionId)
    },
    getBoundSessionAccountDetail: async (options) => {
      const session = ctx.getBoundSession()
      if (session == null) {
        return undefined
      }

      const adapterKey = session?.adapter?.trim()
      const accountKey = session?.account?.trim()
      if (adapterKey == null || adapterKey === '' || accountKey == null || accountKey === '') {
        return undefined
      }

      try {
        const { adapter, adapterCtx } = await createServerAdapterAccountContext(adapterKey)
        if (adapter.getAccountDetail == null) {
          return undefined
        }
        const detail = await adapter.getAccountDetail(adapterCtx, {
          account: accountKey,
          model: session.model,
          refresh: options?.refresh
        })
        return detail.account
      } catch (error) {
        if (isMissingAdapterPackageError(error, adapterKey)) {
          return undefined
        }
        throw error
      }
    },
    updateSession: (updates) => {
      if (ctx.sessionId) {
        getDb().updateSession(ctx.sessionId, updates)
      }
    },
    getChannelAdapterPreference: () => ctx.channelAdapter,
    setChannelAdapterPreference: (adapter) => {
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
    getChannelPermissionModePreference: () => ctx.channelPermissionMode,
    setChannelPermissionModePreference: (permissionMode) => {
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
    getChannelEffortPreference: () => ctx.channelEffort,
    setChannelEffortPreference: (effort) => {
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
  }

  await pipeline(ctx)
}

export const handleSessionEvent = async (
  states: Map<string, ChannelRuntimeState>,
  sessionId: string,
  event: WSEvent
) => {
  const binding = resolveBinding(sessionId)
  if (!binding) return false
  const serverLogger = getSessionLogger(sessionId, 'server')
  const state = states.get(binding.channelKey)
  if (!state?.connection) {
    serverLogger.warn({
      sessionId,
      eventType: event.type,
      channelType: binding.channelType,
      channelKey: binding.channelKey,
      channelId: binding.channelId,
      sessionType: binding.sessionType,
      channelStatus: state?.status,
      channelError: state?.error
    }, '[channel] Skipped session event because bound channel connection is unavailable')
    return false
  }
  const connection = state.connection
  const receiveId = binding.replyReceiveId ?? binding.channelId
  const receiveIdType = binding.replyReceiveIdType ?? 'chat_id'
  const deliveryBaseContext = {
    sessionId,
    channelType: binding.channelType,
    channelKey: binding.channelKey,
    channelId: binding.channelId,
    sessionType: binding.sessionType
  }
  const isGroupSession = binding.sessionType === 'group'
  const isWechatDirectSession = binding.channelType === 'wechat' && binding.sessionType === 'direct'
  const attachToolCallDetailUrl = (
    summary: NonNullable<ReturnType<typeof extractToolCallSummary>>,
    messageId?: string
  ) => ({
    ...summary,
    items: summary.items.map(item => ({
      ...item,
      detailUrl: buildToolCallDetailUrl(state.config, {
        sessionId,
        toolUseId: item.toolUseId,
        messageId
      }),
      exportJsonUrl: buildChannelActionUrl(state.config, {
        action: 'tool-call-export',
        sessionId,
        toolUseId: item.toolUseId,
        messageId
      })
    }))
  })
  const releasePendingUnack = async (reason: string) => {
    const unack = consumePendingUnack(sessionId)
    if (!unack) return
    try {
      await unack()
      serverLogger.info({
        ...deliveryBaseContext,
        reason
      }, '[channel] Released pending channel ack')
    } catch (error) {
      serverLogger.warn({
        ...deliveryBaseContext,
        reason,
        error: getErrorMessage(error)
      }, '[channel] Pending channel ack failed')
    }
  }
  const deliverMessage = async (message: ChannelTextMessage) => {
    const outboundMessage = limitChannelTextMessage(message)
    const startedAt = Date.now()
    serverLogger.info(
      buildChannelMessageLogContext(outboundMessage, deliveryBaseContext),
      '[channel] Sending session event to bound channel'
    )
    await releasePendingUnack('before_delivery')

    try {
      const result = await connection.sendMessage(outboundMessage)
      serverLogger.info(
        buildChannelMessageLogContext(outboundMessage, {
          ...deliveryBaseContext,
          messageId: result?.messageId,
          elapsedMs: Date.now() - startedAt
        }),
        '[channel] Sent session event to bound channel'
      )
      return result
    } catch (error) {
      serverLogger.warn(
        buildChannelMessageLogContext(outboundMessage, {
          ...deliveryBaseContext,
          elapsedMs: Date.now() - startedAt,
          error: getErrorMessage(error)
        }),
        '[channel] Failed to send session event to bound channel'
      )
      throw error
    }
  }
  const upsertToolCallSummary = async (nextSummary: NonNullable<ReturnType<typeof extractToolCallSummary>>) => {
    return await runPendingToolCallDisplayUpdate(sessionId, async () => {
      const mergedSummary = mergeToolCallSummaries(
        resolvePendingToolCallDisplay(sessionId)?.summary,
        nextSummary
      )
      const message: ChannelTextMessage = {
        receiveId,
        receiveIdType,
        text: buildToolCallSummaryText(mergedSummary),
        toolCallSummary: mergedSummary
      }
      const outboundMessage = limitChannelTextMessage(message)
      const pendingDisplay = resolvePendingToolCallDisplay(sessionId)

      if (pendingDisplay?.messageId != null && typeof connection.updateMessage === 'function') {
        const result = await connection.updateMessage(pendingDisplay.messageId, outboundMessage)
        setPendingToolCallDisplay(sessionId, {
          summary: mergedSummary,
          messageId: result?.messageId ?? pendingDisplay.messageId
        })
        return true
      }

      const result = await deliverMessage(message)
      setPendingToolCallDisplay(sessionId, {
        summary: mergedSummary,
        messageId: result?.messageId ?? pendingDisplay?.messageId
      })
      return true
    })
  }

  if (isGroupSession) {
    if (isChannelSessionStopEvent(event)) {
      await releasePendingUnack('group_session_stop')
      clearPendingToolCallDisplay(sessionId)
      clearAutoDeliveryState(sessionId)
      serverLogger.info({
        ...deliveryBaseContext,
        eventType: event.type
      }, '[channel] Suppressed automatic session event delivery for group channel')
      return false
    } else if (event.type === 'error' && event.data.fatal !== false) {
      serverLogger.info({
        ...deliveryBaseContext,
        eventType: event.type,
        errorCode: event.data.code
      }, '[channel] Delivering fatal session error to group channel')
    } else if (event.type === 'interaction_request') {
      serverLogger.info({
        ...deliveryBaseContext,
        eventType: event.type
      }, '[channel] Delivering interaction request to group channel')
    } else {
      serverLogger.info({
        ...deliveryBaseContext,
        eventType: event.type
      }, '[channel] Suppressed automatic session event delivery for group channel')
      return false
    }
  }

  if (isChannelSessionStopEvent(event)) {
    if (!isWechatDirectSession) {
      return false
    }

    const autoDelivery = resolveAutoDeliveryState(sessionId)
    const stopText = event.data.message == null
      ? undefined
      : extractTextFromMessage(event.data.message)
    if (stopText != null && stopText !== '') {
      autoDelivery.latestText = stopText
    }

    const finalText = autoDelivery.latestText
    if (
      finalText != null &&
      finalText !== '' &&
      !autoDelivery.deliveredFinal &&
      finalText !== autoDelivery.firstText
    ) {
      autoDelivery.deliveredFinal = true
      await deliverMessage({ receiveId, receiveIdType, text: finalText })
      clearAutoDeliveryState(sessionId)
      return true
    }

    clearAutoDeliveryState(sessionId)
    return false
  }

  if (event.type === 'error') {
    if (event.data.fatal === false) {
      serverLogger.info({
        ...deliveryBaseContext,
        errorCode: event.data.code
      }, '[channel] Skipped non-fatal session error for bound channel')
      return false
    }

    clearPendingToolCallDisplay(sessionId)
    await deliverMessage({
      receiveId,
      receiveIdType,
      text: buildChannelErrorText(state.config?.language ?? 'zh', event)
    })
    serverLogger.warn({
      sessionId,
      receiveId,
      errorCode: event.data.code
    }, '[channel] Delivered session error to bound channel')
    return true
  }

  if (event.type === 'interaction_request') {
    const language = state.config?.language ?? 'zh'
    const options = event.payload.options ?? []
    const hasDescriptions = options.some(option => (option.description?.trim() ?? '') !== '')
    const text = buildInteractionText(language, event.payload)
    const result = await deliverMessage({ receiveId, receiveIdType, text })
    let followUpsPushed = false

    if (
      !event.payload.multiselect &&
      options.length > 0 &&
      result?.messageId != null &&
      connection.pushFollowUps
    ) {
      try {
        await connection.pushFollowUps({
          messageId: result.messageId,
          followUps: options.map(option => ({ content: option.value ?? option.label }))
        })
        followUpsPushed = true
      } catch (error) {
        serverLogger.warn({
          sessionId,
          interactionId: event.id,
          receiveId,
          messageId: result.messageId,
          error: error instanceof Error ? error.message : String(error)
        }, '[channel] Failed to push follow-up actions for interaction request')
      }
    }

    serverLogger.info({
      sessionId,
      interactionId: event.id,
      receiveId,
      optionCount: options.length,
      hasDescriptions,
      pushedFollowUps: followUpsPushed
    }, '[channel] Delivered interaction request to bound channel')
    return true
  }

  if (event.type === 'message') {
    if (isWechatDirectSession) {
      if (event.message.role !== 'assistant') {
        serverLogger.info({
          ...deliveryBaseContext,
          messageId: event.message.id,
          role: event.message.role
        }, '[channel] Skipped non-assistant session message for WeChat direct delivery policy')
        return false
      }

      const text = extractTextFromMessage(event.message)
      if (text == null || text === '') {
        serverLogger.info({
          ...deliveryBaseContext,
          messageId: event.message.id,
          role: event.message.role
        }, '[channel] Skipped assistant session message because no text was extracted')
        return false
      }

      clearPendingToolCallDisplay(sessionId)
      const autoDelivery = resolveAutoDeliveryState(sessionId)
      autoDelivery.latestText = text
      if (autoDelivery.firstText == null) {
        autoDelivery.firstText = text
        await deliverMessage({ receiveId, receiveIdType, text })
        return true
      }

      serverLogger.info({
        ...deliveryBaseContext,
        messageId: event.message.id,
        role: event.message.role
      }, '[channel] Deferred WeChat direct assistant message until session stop')
      return false
    }

    const toolCallSummary = extractToolCallSummary(event.message)
    if (toolCallSummary != null) {
      await upsertToolCallSummary(attachToolCallDetailUrl(toolCallSummary, event.message.id))
    }

    if (event.message.role !== 'assistant') {
      serverLogger.info({
        ...deliveryBaseContext,
        messageId: event.message.id,
        role: event.message.role,
        hasToolCallSummary: toolCallSummary != null
      }, '[channel] Skipped non-assistant session message for bound channel')
      return toolCallSummary != null
    }

    const text = extractTextFromMessage(event.message)
    if (text == null || text === '') {
      serverLogger.info({
        ...deliveryBaseContext,
        messageId: event.message.id,
        role: event.message.role,
        hasToolCallSummary: toolCallSummary != null
      }, '[channel] Skipped assistant session message because no text was extracted')
      return toolCallSummary != null
    }

    clearPendingToolCallDisplay(sessionId)
    await deliverMessage({ receiveId, receiveIdType, text })
    return true
  }

  return false
}
