import type { RelayController } from './controller.js'
import { normalizeOptions } from './options.js'
import { createErrorResponse, createJsonResponse, readBody } from './responses.js'
import type { PluginProxyRequest } from './types.js'

const controllerJson = async (action: () => Promise<unknown>, errorStatus = 400) => {
  try {
    return createJsonResponse(await action())
  } catch (error) {
    return createErrorResponse(error instanceof Error ? error.message : String(error), errorStatus)
  }
}

export const handleRelayApi = async (request: PluginProxyRequest, controller: RelayController) => {
  const route = request.path.replace(/^\/+|\/+$/g, '')
  if (request.method === 'GET' && (route === '' || route === 'status')) {
    return createJsonResponse(await controller.getPublicStatus())
  }
  if (request.method === 'POST' && route === 'connect') {
    return createJsonResponse(await controller.connect(readBody(request)))
  }
  if (request.method === 'POST' && route === 'login-url') {
    return await controllerJson(async () => await controller.createLoginUrl(readBody(request)))
  }
  if (request.method === 'POST' && route === 'login-callback') {
    return await controllerJson(async () => await controller.completeLogin(readBody(request)))
  }
  if (request.method === 'POST' && route === 'config-refresh') {
    return createJsonResponse(await controller.refreshConfigDistribution(readBody(request)))
  }
  if (request.method === 'POST' && route === 'disconnect') {
    return createJsonResponse(await controller.disconnect(readBody(request)))
  }
  if (request.method === 'POST' && route === 'forget') {
    return createJsonResponse(await controller.forget(readBody(request)))
  }
  if (request.method === 'POST' && route === 'options-preview') {
    return createJsonResponse({
      options: normalizeOptions(readBody(request))
    })
  }
  return createErrorResponse(`Unknown relay plugin API route: ${request.method} /${route}`, 404)
}
