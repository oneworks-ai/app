import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseRelayServerArgs, readRelayStore } from '../src/server.js'
import { cleanupRelayFixtures, listenRelay, requestJson, requestRaw } from './helpers.js'

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await cleanupRelayFixtures()
})

const ssoProviders = {
  acme: {
    name: 'Acme SSO',
    clientId: 'acme-client',
    clientSecret: 'acme-secret',
    authorizationUrl: 'https://sso.acme.example/oauth2/authorize',
    tokenUrl: 'https://sso.acme.example/oauth2/token',
    userInfoUrl: 'https://sso.acme.example/oauth2/userinfo',
    scope: 'openid email profile groups'
  },
  okta: {
    name: 'Okta Workforce',
    clientId: 'okta-client',
    clientSecret: 'okta-secret',
    authorizationUrl: 'https://okta.example/oauth2/v1/authorize',
    tokenUrl: 'https://okta.example/oauth2/v1/token',
    userInfoUrl: 'https://okta.example/oauth2/v1/userinfo'
  }
}

const startSsoFlow = async (baseUrl: string, provider: string) => {
  const response = await requestRaw(baseUrl, `/api/auth/oauth/${provider}/start`, {
    redirect: 'manual'
  })

  expect(response.status).toBe(302)
  return response.headers.get('location') ?? ''
}

const stubSsoProfile = (tokenUrl: string, userInfoUrl: string, email: string) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === tokenUrl) {
        return new Response(JSON.stringify({ access_token: 'sso-provider-token' }), { status: 200 })
      }
      if (url === userInfoUrl) {
        return new Response(
          JSON.stringify({
            sub: `sso-${email}`,
            email,
            preferred_username: email.split('@')[0],
            picture: 'https://sso.example/avatar.png'
          }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 500 })
    })
  )
}

describe('relay server custom SSO providers', () => {
  it('parses multiple custom SSO providers from JSON env', () => {
    vi.stubEnv('ONEWORKS_RELAY_SSO_PROVIDERS', JSON.stringify(ssoProviders))

    const args = parseRelayServerArgs([])

    expect(args.oauth?.acme).toMatchObject({
      authorizationUrl: ssoProviders.acme.authorizationUrl,
      clientId: 'acme-client',
      displayName: 'Acme SSO',
      scope: 'openid email profile groups',
      tokenUrl: ssoProviders.acme.tokenUrl,
      userInfoUrl: ssoProviders.acme.userInfoUrl
    })
    expect(args.oauth?.okta).toMatchObject({
      clientId: 'okta-client',
      displayName: 'Okta Workforce',
      scope: 'openid email profile'
    })
  })

  it('rejects invalid custom SSO provider declarations', () => {
    vi.stubEnv(
      'ONEWORKS_RELAY_SSO_PROVIDERS',
      JSON.stringify({
        google: ssoProviders.acme
      })
    )

    expect(() => parseRelayServerArgs([])).toThrow(/cannot override built-in provider "google"/)
  })

  it('lists and starts multiple custom SSO providers', async () => {
    const { args, baseUrl } = await listenRelay({
      oauth: {
        acme: { ...ssoProviders.acme, displayName: ssoProviders.acme.name },
        okta: { ...ssoProviders.okta, displayName: ssoProviders.okta.name }
      },
      publicBaseUrl: 'https://relay.example'
    })
    const providers = await requestJson(baseUrl, '/api/auth/providers')
    const location = await startSsoFlow(baseUrl, 'acme')
    const store = await readRelayStore(args.dataPath)

    expect(providers.body).toEqual({
      providers: [
        { id: 'acme', displayName: 'Acme SSO' },
        { id: 'okta', displayName: 'Okta Workforce' }
      ]
    })
    expect(location).toContain('https://sso.acme.example/oauth2/authorize')
    expect(location).toContain('client_id=acme-client')
    expect(location).toContain('scope=openid+email+profile+groups')
    expect(location).toContain(encodeURIComponent('https://relay.example/api/auth/oauth/acme/callback'))
    expect(store.oauthStates[0]).toMatchObject({
      provider: 'acme'
    })
  })

  it('creates a session from a custom SSO callback', async () => {
    const { args, baseUrl } = await listenRelay({
      oauth: {
        acme: { ...ssoProviders.acme, displayName: ssoProviders.acme.name }
      }
    })
    await startSsoFlow(baseUrl, 'acme')
    const state = (await readRelayStore(args.dataPath)).oauthStates[0].state
    stubSsoProfile(ssoProviders.acme.tokenUrl, ssoProviders.acme.userInfoUrl, 'owner@acme.example')

    const callback = await requestJson(baseUrl, `/api/auth/oauth/acme/callback?code=ok&state=${state}`)

    expect(callback.response.status).toBe(200)
    expect(callback.body.user).toMatchObject({
      email: 'owner@acme.example',
      name: 'owner',
      provider: 'acme',
      role: 'owner'
    })
    expect(typeof callback.body.token).toBe('string')
  })
})
