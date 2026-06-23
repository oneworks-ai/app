import Router from '@koa/router'

import {
  applyMobileDeviceEnvironmentAction,
  captureMobileDeviceScreenshot,
  dumpMobileElementTree,
  listMobileDebugTargets,
  readMobileDeviceLogs,
  sendMobileDeviceInput
} from '#~/services/mobile-debug/index.js'
import { HttpError, badRequest } from '#~/utils/http.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const getDeviceId = (body: unknown) => {
  if (!isRecord(body)) throw badRequest('Invalid mobile debug request body', undefined, 'invalid_mobile_debug_request')
  const deviceId = body.deviceId
  if (typeof deviceId !== 'string' || deviceId.trim() === '') {
    throw badRequest('Missing deviceId', undefined, 'missing_device_id')
  }
  return deviceId
}

const normalizeMobileDebugError = (error: unknown): never => {
  if (error instanceof HttpError) throw error
  const message = error instanceof Error ? error.message : String(error)
  throw new HttpError(502, 'mobile_debug_failed', message, undefined, { expose: true })
}

export function mobileDebugRouter(): Router {
  const router = new Router()

  router.post('/targets', async (ctx) => {
    try {
      ctx.body = await listMobileDebugTargets(ctx.request.body)
    } catch (error) {
      normalizeMobileDebugError(error)
    }
  })

  router.post('/screenshots', async (ctx) => {
    try {
      ctx.body = await captureMobileDeviceScreenshot(getDeviceId(ctx.request.body))
    } catch (error) {
      normalizeMobileDebugError(error)
    }
  })

  router.post('/elements', async (ctx) => {
    try {
      ctx.body = await dumpMobileElementTree(getDeviceId(ctx.request.body))
    } catch (error) {
      normalizeMobileDebugError(error)
    }
  })

  router.post('/logs', async (ctx) => {
    try {
      const body = ctx.request.body
      ctx.body = await readMobileDeviceLogs(getDeviceId(body), body)
    } catch (error) {
      normalizeMobileDebugError(error)
    }
  })

  router.post('/input', async (ctx) => {
    try {
      const body = ctx.request.body
      if (!isRecord(body)) {
        throw badRequest('Invalid mobile debug input body', undefined, 'invalid_mobile_debug_input')
      }
      ctx.body = await sendMobileDeviceInput(getDeviceId(body), body.input)
    } catch (error) {
      normalizeMobileDebugError(error)
    }
  })

  router.post('/environment', async (ctx) => {
    try {
      const body = ctx.request.body
      if (!isRecord(body)) {
        throw badRequest('Invalid mobile debug environment body', undefined, 'invalid_mobile_debug_environment')
      }
      ctx.body = await applyMobileDeviceEnvironmentAction(getDeviceId(body), body.action)
    } catch (error) {
      normalizeMobileDebugError(error)
    }
  })

  return router
}
