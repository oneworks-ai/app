import type { IncomingMessage } from 'node:http'

import { getBearerToken } from '../http.js'
import type { RelayRateLimitCategory } from './rate-limit.js'
import { requestIp, tokenFingerprint } from './request.js'

export interface RelayRateLimitTarget {
  category: RelayRateLimitCategory
  key: string
}

const decodeSegment = (value: string | undefined) => {
  if (value == null) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const method = (req: IncomingMessage) => req.method ?? 'GET'

export const classifyRateLimitedRequest = (req: IncomingMessage, url: URL): RelayRateLimitTarget | undefined => {
  const requestMethod = method(req)
  const ip = requestIp(req)
  const tokenHash = tokenFingerprint(getBearerToken(req))
  const oauthMatch = /^\/api\/auth\/oauth\/([^/]+)\/(start|callback)$/.exec(url.pathname)
  if (requestMethod === 'GET' && oauthMatch != null) {
    const provider = decodeSegment(oauthMatch[1]) ?? 'unknown'
    const action = oauthMatch[2]
    return {
      category: 'auth',
      key: `${ip}:oauth:${provider}:${action}`
    }
  }
  if (requestMethod === 'POST' && url.pathname === '/api/auth/invite-login') {
    return {
      category: 'auth',
      key: `${ip}:invite-login`
    }
  }
  if (requestMethod === 'POST' && url.pathname === '/api/auth/password-login') {
    return {
      category: 'auth',
      key: `${ip}:password-login`
    }
  }
  if (requestMethod === 'POST' && url.pathname === '/api/relay/devices/register') {
    return {
      category: 'device-registration',
      key: `${ip}:register:${tokenHash}`
    }
  }
  if (['DELETE', 'PATCH', 'POST'].includes(requestMethod) && /^\/api\/admin\//.test(url.pathname)) {
    return {
      category: 'admin-mutation',
      key: `${ip}:admin:${tokenHash}:${requestMethod}:${url.pathname}`
    }
  }
  const claimMatch = /^\/api\/relay\/devices\/([^/]+)\/session-jobs$/.exec(url.pathname)
  if (requestMethod === 'GET' && claimMatch != null) {
    return {
      category: 'device-session-claim',
      key: `${ip}:claim:${decodeSegment(claimMatch[1]) ?? 'unknown'}:${tokenHash}`
    }
  }
  return undefined
}
