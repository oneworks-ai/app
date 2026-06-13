import { describe, expect, it } from 'vitest'

import { buildRelayProxyUrl, createRelayProxyHeaders, resolveRelayProxyOrigin } from '../src/platform/relayProxy'

describe('relay admin platform proxy helpers', () => {
  it('resolves the relay upstream from platform env', () => {
    expect(resolveRelayProxyOrigin({
      ONEWORKS_RELAY_ADMIN_PROXY_TARGET: 'https://relay.example.com/'
    })).toBe('https://relay.example.com')
  })

  it('builds an upstream URL while dropping internal routing params', () => {
    const url = buildRelayProxyUrl(
      '/api/auth/me',
      'https://admin.example.com/api/proxy?relay_path=/api/auth/me&lang=zh-CN',
      {
        ONEWORKS_RELAY_ADMIN_PROXY_TARGET: 'https://relay.example.com'
      }
    )

    expect(url.toString()).toBe('https://relay.example.com/api/auth/me?lang=zh-CN')
  })

  it('does not forward hop-by-hop headers', () => {
    const headers = createRelayProxyHeaders(
      new Headers({
        authorization: 'Bearer token',
        connection: 'keep-alive',
        host: 'admin.example.com'
      })
    )

    expect(headers.get('authorization')).toBe('Bearer token')
    expect(headers.has('connection')).toBe(false)
    expect(headers.has('host')).toBe(false)
  })
})
