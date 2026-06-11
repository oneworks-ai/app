import { afterEach, describe, expect, it, vi } from 'vitest'

import { readRelayStore } from '../src/server.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson, requestRaw } from './helpers.js'

afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupRelayFixtures()
})

const managedProviderInput = {
  id: 'acme',
  name: 'Acme SSO',
  type: 'oidc',
  authorizationUrl: 'https://sso.acme.example/oauth2/authorize',
  tokenUrl: 'https://sso.acme.example/oauth2/token',
  userInfoUrl: 'https://sso.acme.example/oauth2/userinfo',
  scope: 'openid email profile groups',
  enabled: true,
  clientId: 'acme-client',
  clientSecret: 'acme-secret'
}

const managedGoogleProviderInput = {
  id: 'google-sso',
  name: 'Google',
  type: 'oidc',
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  scope: 'openid email profile',
  enabled: true,
  clientId: 'google-client-id',
  clientSecret: 'google-client-secret'
}

describe('relay server admin managed SSO providers', () => {
  it('creates, lists, updates, and deletes providers without exposing client secrets', async () => {
    const { args, baseUrl } = await listenRelay()

    const created = await requestJson(baseUrl, '/api/admin/sso-providers', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify(managedProviderInput)
    })
    const listed = await requestJson(baseUrl, '/api/admin/sso-providers', {
      headers: authHeaders('admin-token')
    })
    const detail = await requestJson(baseUrl, '/api/admin/sso-providers/acme', {
      headers: authHeaders('admin-token')
    })
    const disabled = await requestJson(baseUrl, '/api/admin/sso-providers/acme', {
      method: 'PATCH',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ enabled: false, name: 'Acme Workforce' })
    })
    const rotated = await requestJson(baseUrl, '/api/admin/sso-providers/acme', {
      method: 'PATCH',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ clientSecret: 'new-acme-secret', enabled: true })
    })
    const storeAfterRotate = await readRelayStore(args.dataPath)
    const deleted = await requestJson(baseUrl, '/api/admin/sso-providers/acme', {
      method: 'DELETE',
      headers: authHeaders('admin-token')
    })
    const store = await readRelayStore(args.dataPath)

    expect(created.response.status).toBe(200)
    expect(created.body.provider).toMatchObject({
      clientSecret: '********',
      id: 'acme',
      name: 'Acme SSO',
      type: 'oidc'
    })
    expect(JSON.stringify(listed.body)).not.toContain('acme-secret')
    expect(JSON.stringify(detail.body)).not.toContain('acme-secret')
    expect(disabled.body.provider).toMatchObject({
      clientSecret: '********',
      enabled: false,
      name: 'Acme Workforce'
    })
    expect(rotated.body.provider).toMatchObject({
      clientSecret: '********',
      enabled: true
    })
    expect(storeAfterRotate.ssoProviders[0]).toMatchObject({
      clientSecret: 'new-acme-secret',
      id: 'acme'
    })
    expect(deleted.body).toMatchObject({
      deleted: true,
      provider: { clientSecret: '********', id: 'acme' }
    })
    expect(store.ssoProviders).toEqual([])
  })

  it('resolves enabled managed providers for auth discovery and OAuth start', async () => {
    const { args, baseUrl } = await listenRelay({
      publicBaseUrl: 'https://relay.example'
    })

    await requestJson(baseUrl, '/api/admin/sso-providers', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify(managedProviderInput)
    })
    const providers = await requestJson(baseUrl, '/api/auth/providers')
    const start = await requestRaw(baseUrl, '/api/auth/oauth/acme/start', {
      redirect: 'manual'
    })
    const store = await readRelayStore(args.dataPath)

    expect(providers.body).toEqual({
      providers: [{ id: 'acme', displayName: 'Acme SSO' }]
    })
    expect(start.status).toBe(302)
    expect(start.headers.get('location')).toContain('https://sso.acme.example/oauth2/authorize')
    expect(start.headers.get('location')).toContain('client_id=acme-client')
    expect(start.headers.get('location')).toContain('scope=openid+email+profile+groups')
    expect(start.headers.get('location')).toContain(
      encodeURIComponent('https://relay.example/api/auth/oauth/acme/callback')
    )
    expect(store.oauthStates[0]).toMatchObject({
      provider: 'acme'
    })
  })

  it('runs managed Google SSO through OAuth start and callback', async () => {
    const { args, baseUrl } = await listenRelay({
      publicBaseUrl: 'https://relay.example'
    })

    await requestJson(baseUrl, '/api/admin/sso-providers', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify(managedGoogleProviderInput)
    })
    const providers = await requestJson(baseUrl, '/api/auth/providers')
    const start = await requestRaw(
      baseUrl,
      '/api/auth/oauth/google-sso/start?login_hint=owner%40example.com&prompt=select_account',
      {
        redirect: 'manual'
      }
    )
    const state = (await readRelayStore(args.dataPath)).oauthStates[0]?.state ?? ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === 'https://oauth2.googleapis.com/token') {
          return new Response(JSON.stringify({ access_token: 'google-access-token' }), { status: 200 })
        }
        if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
          return new Response(
            JSON.stringify({
              sub: 'google-owner',
              email: 'owner@example.com',
              name: 'Google Owner',
              picture: 'https://example.com/avatar.png'
            }),
            { status: 200 }
          )
        }
        return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 500 })
      })
    )
    const callback = await requestJson(baseUrl, `/api/auth/oauth/google-sso/callback?code=ok&state=${state}`)

    expect(providers.body).toEqual({
      providers: [{ id: 'google-sso', displayName: 'Google' }]
    })
    expect(start.status).toBe(302)
    expect(start.headers.get('location')).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(start.headers.get('location')).toContain('client_id=google-client-id')
    expect(start.headers.get('location')).toContain('scope=openid+email+profile')
    expect(start.headers.get('location')).toContain('login_hint=owner%40example.com')
    expect(start.headers.get('location')).toContain('prompt=select_account')
    expect(start.headers.get('location')).toContain(
      encodeURIComponent('https://relay.example/api/auth/oauth/google-sso/callback')
    )
    expect(callback.response.status).toBe(200)
    expect(callback.body.user).toMatchObject({
      avatarUrl: 'https://example.com/avatar.png',
      email: 'owner@example.com',
      name: 'Google Owner',
      provider: 'google-sso',
      role: 'owner'
    })
  })
})
