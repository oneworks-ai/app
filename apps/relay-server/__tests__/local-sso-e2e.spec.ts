import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { readRelayStore } from '../src/server.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson, requestRaw } from './helpers.js'

interface LocalSsoTrace {
  authorizeRequests: Array<Record<string, string>>
  tokenRequests: Array<Record<string, string>>
  userInfoRequests: Array<{ authorization?: string }>
}

const readBodyText = async (req: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const closeServer = async (server: Server) =>
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error == null) {
        resolve()
      } else {
        reject(error)
      }
    })
  })

const formEntries = (params: URLSearchParams) => Object.fromEntries(params.entries())

const listenLocalSso = async () => {
  const trace: LocalSsoTrace = {
    authorizeRequests: [],
    tokenRequests: [],
    userInfoRequests: []
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')

      if (req.method === 'GET' && url.pathname === '/oauth2/authorize') {
        trace.authorizeRequests.push(formEntries(url.searchParams))
        const redirectUri = url.searchParams.get('redirect_uri') ?? ''
        const state = url.searchParams.get('state') ?? ''
        const callbackUrl = new URL(redirectUri)
        callbackUrl.searchParams.set('code', 'local-sso-code')
        callbackUrl.searchParams.set('state', state)
        res.writeHead(302, { location: callbackUrl.toString() })
        res.end()
        return
      }

      if (req.method === 'POST' && url.pathname === '/oauth2/token') {
        const body = new URLSearchParams(await readBodyText(req))
        trace.tokenRequests.push(formEntries(body))
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ access_token: 'local-sso-access-token' }))
        return
      }

      if (req.method === 'GET' && url.pathname === '/oauth2/userinfo') {
        trace.userInfoRequests.push({
          authorization: Array.isArray(req.headers.authorization)
            ? req.headers.authorization.join(', ')
            : req.headers.authorization
        })
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({
          email: 'owner@local-sso.test',
          email_verified: true,
          name: 'Local SSO Owner',
          picture: 'http://127.0.0.1/avatar.png',
          sub: 'local-sso-owner'
        }))
        return
      }

      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'not found' }))
    })().catch(error => {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`
  return {
    authorizationUrl: `${baseUrl}/oauth2/authorize`,
    close: async () => await closeServer(server),
    tokenUrl: `${baseUrl}/oauth2/token`,
    trace,
    userInfoUrl: `${baseUrl}/oauth2/userinfo`
  }
}

const readLoginConfig = (html: string) => {
  const match = /<script type="application\/json" id="relay-login-config">([^<]+)<\/script>/.exec(html)
  expect(match?.[1]).toBeDefined()
  return JSON.parse(match?.[1] ?? '{}') as {
    providers?: Array<{
      icon?: string
      id?: string
      startUrl?: string
    }>
  }
}

const relayTokenFrom = (location: string) => {
  const url = new URL(location)
  return new URLSearchParams(url.hash.replace(/^#/, '')).get('relay_token') ?? ''
}

afterEach(cleanupRelayFixtures)

describe('relay local SSO end-to-end', () => {
  it('completes login and device registration through a local mock SSO provider', async () => {
    const localSso = await listenLocalSso()
    try {
      const { args, baseUrl } = await listenRelay({
        loginRedirectOrigins: ['http://127.0.0.1'],
        oauth: {
          local: {
            authorizationUrl: localSso.authorizationUrl,
            clientId: 'local-client',
            clientSecret: 'local-secret',
            displayName: 'Local SSO',
            tokenUrl: localSso.tokenUrl,
            userInfoUrl: localSso.userInfoUrl
          }
        }
      })
      const finalPluginCallback = 'http://127.0.0.1/plugin/relay/callback'
      const loginParams = new URLSearchParams({
        redirect_uri: finalPluginCallback,
        scope: 'relay',
        server_id: 'local'
      })

      const loginPage = await requestRaw(baseUrl, `/login?${loginParams.toString()}`)
      const loginHtml = await loginPage.text()
      const loginConfig = readLoginConfig(loginHtml)
      const localProvider = loginConfig.providers?.find(provider => provider.id === 'local')
      expect(loginPage.status).toBe(200)
      expect(loginHtml).toContain('id="relay-login-root"')
      expect(localProvider).toMatchObject({
        icon: 'login',
        id: 'local',
        startUrl: expect.stringContaining('/api/auth/oauth/local/start')
      })

      const startUrl = new URL(localProvider?.startUrl ?? '')
      startUrl.searchParams.set('login_hint', 'owner@local-sso.test')
      startUrl.searchParams.set('prompt', 'select_account')
      const startResponse = await fetch(startUrl, { redirect: 'manual' })
      expect(startResponse.status).toBe(302)
      const authorizeLocation = startResponse.headers.get('location') ?? ''
      expect(authorizeLocation).toContain(localSso.authorizationUrl)

      const authorizeResponse = await fetch(authorizeLocation, { redirect: 'manual' })
      expect(authorizeResponse.status).toBe(302)
      const relayCallbackLocation = authorizeResponse.headers.get('location') ?? ''
      expect(relayCallbackLocation).toContain(`${baseUrl}/api/auth/oauth/local/callback`)

      const callbackResponse = await fetch(relayCallbackLocation, { redirect: 'manual' })
      expect(callbackResponse.status).toBe(302)
      const completeLocation = callbackResponse.headers.get('location') ?? ''
      expect(completeLocation).toContain(`${baseUrl}/login/complete`)
      expect(new URL(completeLocation).searchParams.get('redirect_uri')).toBe(finalPluginCallback)

      const relayToken = relayTokenFrom(completeLocation)
      expect(relayToken).not.toBe('')

      const me = await requestJson(baseUrl, '/api/auth/me', {
        headers: authHeaders(relayToken)
      })
      expect(me.response.status).toBe(200)
      expect(me.body.user).toMatchObject({
        email: 'owner@local-sso.test',
        name: 'Local SSO Owner',
        provider: 'local',
        role: 'owner'
      })

      const registered = await requestJson(baseUrl, '/api/relay/devices/register', {
        method: 'POST',
        headers: authHeaders(relayToken),
        body: JSON.stringify({
          capabilities: { sessions: true },
          deviceId: 'local-e2e-device',
          deviceName: 'Local E2E Device',
          pluginScope: 'relay',
          workspaceFolder: '/local/e2e'
        })
      })
      const store = await readRelayStore(args.dataPath)

      expect(registered.response.status).toBe(200)
      expect(registered.body.device).toMatchObject({
        id: 'local-e2e-device',
        name: 'Local E2E Device',
        pluginScope: 'relay',
        userId: String((me.body.user as { id?: unknown }).id),
        workspaceFolder: '/local/e2e'
      })
      expect(store.devices).toHaveLength(1)
      expect(store.devices[0]).toMatchObject({
        id: 'local-e2e-device',
        userId: String((me.body.user as { id?: unknown }).id)
      })
      expect(localSso.trace.authorizeRequests).toMatchObject([{
        client_id: 'local-client',
        login_hint: 'owner@local-sso.test',
        prompt: 'select_account',
        response_type: 'code',
        scope: 'openid email profile'
      }])
      expect(localSso.trace.authorizeRequests[0]?.redirect_uri).toBe(`${baseUrl}/api/auth/oauth/local/callback`)
      expect(localSso.trace.tokenRequests).toMatchObject([{
        client_id: 'local-client',
        client_secret: 'local-secret',
        code: 'local-sso-code',
        grant_type: 'authorization_code',
        redirect_uri: `${baseUrl}/api/auth/oauth/local/callback`
      }])
      expect(localSso.trace.userInfoRequests).toEqual([{
        authorization: 'Bearer local-sso-access-token'
      }])
    } finally {
      await localSso.close()
    }
  })
})
