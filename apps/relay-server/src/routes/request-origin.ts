import type { IncomingMessage } from 'node:http'

const firstHeaderValue = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value
  const first = raw?.split(',', 1)[0]?.trim()
  return first === '' ? undefined : first
}

const isLoopbackAddress = (value: string | undefined) => (
  value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'
)

export const requestOrigin = (req: IncomingMessage) => `http://${req.headers.host ?? 'localhost'}`

export const forwardedRequestOrigin = (req: IncomingMessage) => {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return undefined
  const host = firstHeaderValue(req.headers['x-forwarded-host'])
  if (host == null) return undefined
  const proto = firstHeaderValue(req.headers['x-forwarded-proto']) ?? 'http'
  return `${proto}://${host}`
}

export const publicRequestBaseUrl = (
  req: IncomingMessage,
  publicBaseUrl: string | undefined
) => publicBaseUrl?.replace(/\/+$/, '') ?? forwardedRequestOrigin(req) ?? requestOrigin(req)
