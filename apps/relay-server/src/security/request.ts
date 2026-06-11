import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

const firstHeaderValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0]
  return value
}

const cleanHeaderValue = (value: string | string[] | undefined, maxLength: number) => {
  const text = firstHeaderValue(value)?.trim()
  if (text == null || text === '') return undefined
  return text.slice(0, maxLength)
}

export const requestIp = (req: IncomingMessage) => {
  const forwarded = cleanHeaderValue(req.headers['x-forwarded-for'], 256)
  if (forwarded != null) {
    const [first] = forwarded.split(',')
    const ip = first?.trim()
    if (ip != null && ip !== '') return ip
  }
  return cleanHeaderValue(req.headers['x-real-ip'], 128) ?? req.socket.remoteAddress ?? 'unknown'
}

export const requestUserAgent = (req: IncomingMessage) => cleanHeaderValue(req.headers['user-agent'], 240)

export const requestId = (req: IncomingMessage) =>
  cleanHeaderValue(req.headers['x-request-id'], 120) ??
    cleanHeaderValue(req.headers['x-correlation-id'], 120)

export const tokenFingerprint = (token: string) => {
  if (token === '') return 'none'
  return createHash('sha256').update(token).digest('hex').slice(0, 16)
}
