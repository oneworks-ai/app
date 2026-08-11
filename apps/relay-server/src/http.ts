import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const relayJsonResponseBodySymbol = Symbol('relayJsonResponseBody')

export const responseJsonBody = (res: ServerResponse) => (
  (res as ServerResponse & { [relayJsonResponseBodySymbol]?: unknown })[relayJsonResponseBodySymbol]
)

export class RelayRequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes.`)
    this.name = 'RelayRequestBodyTooLargeError'
  }
}

export const readRequestBody = async (
  req: IncomingMessage,
  options: { maxBytes?: number } = {}
): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.byteLength
    if (options.maxBytes != null && totalBytes > options.maxBytes) {
      throw new RelayRequestBodyTooLargeError(options.maxBytes)
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export const sendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
  allowOrigin: string,
  headers: Record<string, string> = {}
) => {
  const response = res as ServerResponse & { [relayJsonResponseBodySymbol]?: unknown }
  response[relayJsonResponseBodySymbol] = body
  res.writeHead(status, {
    ...headers,
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-headers':
      'content-type, authorization, x-oneworks-device-id, x-oneworks-team-id, x-oneworks-room-operation-id',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  })
  res.end(`${JSON.stringify(body)}\n`)
}

export const sendHtml = (
  res: ServerResponse,
  status: number,
  body: string,
  allowOrigin: string,
  headers: Record<string, string> = {}
) => {
  res.writeHead(status, {
    ...headers,
    'content-type': 'text/html; charset=utf-8',
    'access-control-allow-origin': allowOrigin,
    'cache-control': 'no-store'
  })
  res.end(body)
}

export const redirect = (res: ServerResponse, location: string, allowOrigin: string) => {
  res.writeHead(302, {
    'access-control-allow-origin': allowOrigin,
    location
  })
  res.end()
}

export const getBearerToken = (req: IncomingMessage) => {
  const value = req.headers.authorization
  if (typeof value !== 'string') return ''
  const [scheme, ...rest] = value.trim().split(/\s+/)
  return scheme?.toLowerCase() === 'bearer' ? rest.join(' ').trim() : ''
}

export const isAdminAuthorized = (req: IncomingMessage, adminToken: string) => {
  if (adminToken === '') return true
  return getBearerToken(req) === adminToken
}
