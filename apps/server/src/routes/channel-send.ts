import Router from '@koa/router'

import { sendChannelMessage } from '#~/channels/index.js'

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
