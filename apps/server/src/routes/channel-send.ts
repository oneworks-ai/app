import Router from '@koa/router'

import {
  clearChannelDebugOutboundMessages,
  invokeChannelCommand,
  listChannelCommandToolsForRuntime,
  listChannelDebugOutboundMessages,
  sendChannelMessage
} from '#~/channels/index.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function channelSendRouter(): Router {
  const router = new Router()

  router.get('/:channelKey/commands', async (ctx) => {
    ctx.body = {
      tools: listChannelCommandToolsForRuntime()
    }
  })

  router.get('/:channelKey/debug/outbound', async (ctx) => {
    const result = listChannelDebugOutboundMessages({
      channelKey: ctx.params.channelKey
    })

    if (!result.ok) {
      ctx.status = result.statusCode
      ctx.body = { message: result.message }
      return
    }

    ctx.body = {
      messages: result.messages
    }
  })

  router.delete('/:channelKey/debug/outbound', async (ctx) => {
    const result = await clearChannelDebugOutboundMessages({
      channelKey: ctx.params.channelKey
    })

    if (!result.ok) {
      ctx.status = result.statusCode
      ctx.body = { message: result.message }
      return
    }

    ctx.body = { ok: true }
  })

  router.post('/:channelKey/commands/invoke', async (ctx) => {
    const body = isRecord(ctx.request.body) ? ctx.request.body : {}
    const toolName = trimNonEmpty(body.toolName)
    if (toolName == null) {
      ctx.status = 400
      ctx.body = { message: 'Missing toolName.' }
      return
    }

    const result = await invokeChannelCommand({
      channelKey: ctx.params.channelKey,
      toolName,
      context: isRecord(body.context) ? body.context : undefined,
      input: body.input,
      sessionId: trimNonEmpty(body.sessionId)
    })

    if (!result.ok) {
      ctx.status = result.statusCode
      ctx.body = {
        message: result.message,
        replies: result.replies,
        result: result.result
      }
      return
    }

    ctx.body = {
      replies: result.replies,
      result: result.result
    }
  })

  router.post('/:channelKey/send', async (ctx) => {
    const body = isRecord(ctx.request.body) ? ctx.request.body : {}
    const result = await sendChannelMessage({
      channelKey: ctx.params.channelKey,
      cwd: trimNonEmpty(body.cwd),
      mentions: body.mentions,
      payload: body.message ?? body.payload ?? body.text,
      receiveId: trimNonEmpty(body.receiveId) ?? trimNonEmpty(body.channelId),
      receiveIdType: trimNonEmpty(body.receiveIdType),
      sessionId: trimNonEmpty(body.sessionId)
    })

    if (!result.ok) {
      ctx.status = result.statusCode
      ctx.body = { message: result.message }
      return
    }

    ctx.body = {
      messageId: result.messageId,
      type: result.type
    }
  })

  return router
}
