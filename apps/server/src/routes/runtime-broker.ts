import Router from '@koa/router'

import type { loadEnv } from '@oneworks/core'
import { RuntimeBrokerError } from '@oneworks/runtime-broker'
import type { RuntimeBrokerHttpRequest, RuntimeBrokerHttpResponse } from '@oneworks/runtime-broker'

import { authenticateRuntimeBrokerToken, getRuntimeBroker } from '#~/services/runtime-broker/index.js'
import { notFound } from '#~/utils/http.js'

const readBearerToken = (value: string) => {
  const normalized = value.trim()
  if (normalized.slice(0, 7).toLowerCase() !== 'bearer ') return undefined
  const token = normalized.slice(7).trim()
  return token === '' ? undefined : token
}

export const isRuntimeBrokerLoopbackAddress = (address: string | undefined) => (
  address === '::1' ||
  address?.startsWith('127.') === true ||
  address?.startsWith('::ffff:127.') === true
)

const requiredString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RuntimeBrokerError('invalid_request', `Runtime broker field "${field}" is required.`)
  }
  return value.trim()
}

const optionalNonNegativeInteger = (value: unknown, field: string) => {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RuntimeBrokerError(
      'invalid_request',
      `Runtime broker field "${field}" must be a non-negative integer.`
    )
  }
  return value
}

const toErrorResponse = (error: unknown): RuntimeBrokerHttpResponse => {
  if (error instanceof RuntimeBrokerError) {
    return {
      ok: false,
      error: { code: error.code, message: error.message, details: error.details }
    }
  }
  return {
    ok: false,
    error: {
      code: 'internal_error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export const runtimeBrokerRouter = (env: ReturnType<typeof loadEnv>) => {
  const router = new Router()

  router.post('/', async (ctx) => {
    if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ !== 'manager') throw notFound()
    if (!isRuntimeBrokerLoopbackAddress(ctx.req.socket.remoteAddress)) throw notFound()
    const principal = authenticateRuntimeBrokerToken(readBearerToken(ctx.get('Authorization')))
    if (principal == null) throw notFound()
    const body = (ctx.request.body ?? {}) as RuntimeBrokerHttpRequest
    const broker = getRuntimeBroker()

    try {
      let result: unknown
      if (body.action === 'callback') {
        if (principal.kind !== 'driver') throw notFound()
        const driverId = requiredString(body.driverId, 'driverId')
        if (driverId !== principal.driverId) throw notFound()
        result = await broker.callback(driverId, body.payload, {
          callbackId: requiredString(body.callbackId, 'callbackId'),
          leaseId: principal.leaseId,
          profileKey: principal.profileKey
        }, {
          executionTimeoutMs: optionalNonNegativeInteger(body.callbackTimeoutMs, 'callbackTimeoutMs'),
          retentionMs: optionalNonNegativeInteger(body.callbackRetentionMs, 'callbackRetentionMs')
        })
      } else if (body.action === 'callback_ack') {
        if (principal.kind !== 'driver') throw notFound()
        const driverId = requiredString(body.driverId, 'driverId')
        if (driverId !== principal.driverId) throw notFound()
        broker.acknowledgeCallback(driverId, {
          callbackId: requiredString(body.callbackId, 'callbackId'),
          leaseId: principal.leaseId,
          profileKey: principal.profileKey
        })
        result = {}
      } else {
        if (principal.kind !== 'workspace') throw notFound()
        switch (body.action) {
          case 'acquire':
            result = await broker.acquire(principal.ownerId, {
              driverId: requiredString(body.driverId, 'driverId'),
              profileKey: requiredString(body.profileKey, 'profileKey'),
              payload: body.payload
            })
            break
          case 'invoke':
            result = await broker.invoke(
              principal.ownerId,
              requiredString(body.leaseId, 'leaseId'),
              requiredString(body.operation, 'operation'),
              body.payload,
              body.invocationId == null ? undefined : requiredString(body.invocationId, 'invocationId')
            )
            break
          case 'poll':
            result = await broker.poll(
              principal.ownerId,
              requiredString(body.leaseId, 'leaseId'),
              optionalNonNegativeInteger(body.afterCursor, 'afterCursor') ?? 0,
              optionalNonNegativeInteger(body.timeoutMs, 'timeoutMs')
            )
            break
          case 'respond':
            broker.respond(
              principal.ownerId,
              requiredString(body.leaseId, 'leaseId'),
              requiredString(body.requestId, 'requestId'),
              body.payload
            )
            result = {}
            break
          case 'release':
            await broker.release(principal.ownerId, requiredString(body.leaseId, 'leaseId'))
            result = {}
            break
          default:
            throw new RuntimeBrokerError('invalid_action', 'Unknown runtime broker action.')
        }
      }
      ctx.body = { ok: true, result } satisfies RuntimeBrokerHttpResponse
    } catch (error) {
      ctx.body = toErrorResponse(error)
    }
  })

  return router
}
