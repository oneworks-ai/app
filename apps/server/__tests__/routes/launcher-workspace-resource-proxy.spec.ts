import { once } from 'node:events'
import { createServer } from 'node:http'

import Router from '@koa/router'
import Koa from 'koa'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { proxyLauncherWorkspaceResource } from '#~/routes/launcher-workspace-resource-proxy.js'

describe('launcher workspace resource proxy', () => {
  let proxyServer: ReturnType<typeof createServer>
  let proxyUrl: string
  let upstreamServer: ReturnType<typeof createServer>
  let upstreamUrl: string
  const requests: Array<{ method?: string; range?: string; url?: string }> = []

  beforeEach(async () => {
    requests.length = 0
    upstreamServer = createServer((request, response) => {
      requests.push({
        method: request.method,
        range: request.headers.range,
        url: request.url
      })
      const range = request.headers.range
      response.writeHead(range == null ? 200 : 206, {
        'accept-ranges': 'bytes',
        'content-length': range == null ? '10' : '3',
        ...(range == null ? {} : { 'content-range': 'bytes 2-4/10' }),
        'content-type': 'video/mp4',
        'x-content-type-options': 'nosniff'
      })
      response.end(request.method === 'HEAD' ? undefined : range == null ? '0123456789' : '234')
    })
    upstreamServer.listen(0, '127.0.0.1')
    await once(upstreamServer, 'listening')
    const upstreamAddress = upstreamServer.address()
    if (upstreamAddress == null || typeof upstreamAddress === 'string') throw new Error('Expected upstream port')
    upstreamUrl = `http://127.0.0.1:${upstreamAddress.port}`

    const app = new Koa()
    const router = new Router()
    const handle = async (ctx: Koa.Context) => await proxyLauncherWorkspaceResource(ctx, upstreamUrl)
    router.get('/resource', handle)
    router.head('/resource', handle)
    app.use(router.routes()).use(router.allowedMethods())
    proxyServer = createServer(app.callback())
    proxyServer.listen(0, '127.0.0.1')
    await once(proxyServer, 'listening')
    const proxyAddress = proxyServer.address()
    if (proxyAddress == null || typeof proxyAddress === 'string') throw new Error('Expected proxy port')
    proxyUrl = `http://127.0.0.1:${proxyAddress.port}`
  })

  afterEach(async () => {
    proxyServer.close()
    upstreamServer.close()
    await Promise.all([once(proxyServer, 'close'), once(upstreamServer, 'close')])
  })

  it('forwards only the fixed session resource path, Range, status, headers, and body', async () => {
    const url = new URL('/resource', proxyUrl)
    url.searchParams.set('sessionId', 'session/one')
    url.searchParams.set('path', '/tmp/oneworks-cua/run/clip.mp4')
    const response = await fetch(url, { headers: { Range: 'bytes=2-4' } })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-4/10')
    expect(response.headers.get('content-length')).toBe('3')
    expect(await response.text()).toBe('234')
    expect(requests).toEqual([{
      method: 'GET',
      range: 'bytes=2-4',
      url: '/api/sessions/session%2Fone/workspace/resource?path=%2Ftmp%2Foneworks-cua%2Frun%2Fclip.mp4'
    }])
  })

  it('preserves HEAD semantics without buffering a body', async () => {
    const url = new URL('/resource', proxyUrl)
    url.searchParams.set('path', 'assets/clip.mp4')
    const response = await fetch(url, { method: 'HEAD' })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('10')
    expect(await response.text()).toBe('')
    expect(requests[0]).toMatchObject({
      method: 'HEAD',
      url: '/api/workspace/resource?path=assets%2Fclip.mp4'
    })
  })
})
