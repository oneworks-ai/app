import { Buffer } from 'node:buffer'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'

import Router from '@koa/router'

import type { ServerEnv } from '@oneworks/core'
import { translateRequestToResponses, translateResponsesToResponse } from '@oneworks/model-protocol'
import type { JsonObject } from '@oneworks/model-protocol'
import { isCodexSharedModelEnabled } from '@oneworks/utils'

import { createServerAdapterAccountContext } from '#~/services/adapter-accounts.js'

const MAX_BODY_BYTES = 16 * 1024 * 1024

const safeEqual = (left: string, right: string) => (
  timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest())
)

const bearerToken = (header: string) => {
  const normalized = header.trim()
  return normalized.toLowerCase().startsWith('bearer ')
    ? normalized.slice('bearer '.length).trim() || undefined
    : undefined
}

const writeError = (ctx: Router.RouterContext, status: number, message: string, code = 'shared_model_error') => {
  ctx.status = status
  ctx.body = { error: { message, type: 'invalid_request_error', code } }
}

const writeChatStream = (ctx: Router.RouterContext, response: JsonObject) => {
  const choice = Array.isArray(response.choices) && response.choices.length > 0 && response.choices[0] != null &&
      typeof response.choices[0] === 'object'
    ? response.choices[0] as JsonObject
    : {}
  const message = choice.message != null && typeof choice.message === 'object'
    ? choice.message as JsonObject
    : {}
  const base = {
    id: response.id,
    object: 'chat.completion.chunk',
    created: response.created,
    model: response.model
  }
  const frames = [
    {
      ...base,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          ...(message.content == null ? {} : { content: message.content }),
          ...(Array.isArray(message.tool_calls)
            ? {
              tool_calls: message.tool_calls.map((toolCall, index) => (
                toolCall != null && typeof toolCall === 'object'
                  ? { ...toolCall, index }
                  : toolCall
              ))
            }
            : {})
        },
        finish_reason: null
      }]
    },
    {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason ?? 'stop' }],
      ...(response.usage == null ? {} : { usage: response.usage })
    }
  ]
  ctx.status = 200
  ctx.type = 'text/event-stream'
  ctx.set('Cache-Control', 'no-cache')
  ctx.set('Connection', 'keep-alive')
  ctx.body = `${frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`
}

export function codexSharedModelRouter(env: ServerEnv): Router {
  const router = new Router()

  router.post('/v1/chat/completions', async (ctx) => {
    ;(ctx.state as { skipApiEnvelope?: boolean }).skipApiEnvelope = true
    const expectedToken = env.__ONEWORKS_PROJECT_CODEX_SHARED_MODEL_TOKEN__
    const providedToken = bearerToken(ctx.get('Authorization'))
    if (typeof expectedToken !== 'string' || providedToken == null || !safeEqual(providedToken, expectedToken)) {
      writeError(ctx, 401, 'Invalid internal model-service credential.', 'invalid_api_key')
      return
    }
    const request = ctx.request.body
    if (request == null || typeof request !== 'object' || Array.isArray(request)) {
      writeError(ctx, 400, 'Request body must be a JSON object.')
      return
    }
    if (Buffer.byteLength(JSON.stringify(request)) > MAX_BODY_BYTES) {
      writeError(ctx, 413, 'Request body exceeds the 16 MiB limit.', 'request_too_large')
      return
    }

    const abortController = new AbortController()
    const abort = () => abortController.abort()
    ctx.req.once('aborted', abort)
    ctx.res.once('close', () => {
      if (!ctx.res.writableEnded) abort()
    })
    try {
      const { adapter, adapterCtx } = await createServerAdapterAccountContext('codex')
      if (!isCodexSharedModelEnabled(adapterCtx.configState?.mergedConfig)) {
        writeError(ctx, 404, 'Codex built-in model sharing is disabled.', 'shared_model_disabled')
        return
      }
      if (adapter.executeSharedModel == null) {
        writeError(
          ctx,
          501,
          'The installed Codex adapter does not support shared model execution.',
          'unsupported_adapter'
        )
        return
      }
      const responsesRequest = translateRequestToResponses({
        source: 'openai-chat-completions',
        request: request as JsonObject
      })
      const requestModel = (request as JsonObject).model
      const result = await adapter.executeSharedModel(adapterCtx, {
        request: responsesRequest,
        sessionId: `shared-model-${randomUUID()}`,
        signal: abortController.signal
      })
      const chatResponse = translateResponsesToResponse({
        target: 'openai-chat-completions',
        response: result.response as JsonObject,
        model: typeof requestModel === 'string' ? requestModel : undefined
      })
      if ((request as JsonObject).stream === true) writeChatStream(ctx, chatResponse)
      else {
        ctx.status = 200
        ctx.body = chatResponse
      }
    } catch (error) {
      if (abortController.signal.aborted) return
      writeError(ctx, 422, error instanceof Error ? error.message : String(error), 'unsupported_request')
    }
  })

  return router
}
