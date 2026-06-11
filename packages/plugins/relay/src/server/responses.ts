import type { PluginProxyRequest, PluginProxyResponse } from './types.js'
import { parseJson } from './utils.js'

export const readBody = (request: PluginProxyRequest) => {
  if (request.body == null || request.body.length === 0) return {}
  return parseJson(request.body.toString('utf8'))
}

export const createJsonResponse = (body: unknown, status = 200): PluginProxyResponse => ({
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8'
  },
  body
})

export const createErrorResponse = (message: string, status = 400) =>
  createJsonResponse({
    error: message
  }, status)
