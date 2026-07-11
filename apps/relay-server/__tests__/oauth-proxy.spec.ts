import { afterEach, describe, expect, it } from 'vitest'

import { cleanupRelayFixtures, listenRelay, requestRaw } from './helpers.js'

afterEach(cleanupRelayFixtures)

const googleOauth = {
  google: {
    clientId: 'google-client-id',
    clientSecret: 'google-client-secret'
  }
}

describe('relay OAuth proxy support', () => {
  it('keeps the configured public callback URL behind the admin dev proxy', async () => {
    const { baseUrl } = await listenRelay({
      loginRedirectOrigins: ['http://127.0.0.1:5180'],
      oauth: googleOauth,
      publicBaseUrl: 'http://127.0.0.1:48888'
    })
    const redirectUri = encodeURIComponent(
      'http://127.0.0.1:5180/login/complete?redirect_uri=http%3A%2F%2F127.0.0.1%3A5180%2Fadmin%2Fusers'
    )
    const response = await requestRaw(baseUrl, `/api/auth/oauth/google/start?redirect_uri=${redirectUri}`, {
      headers: {
        'x-forwarded-host': '127.0.0.1:5180',
        'x-forwarded-proto': 'http'
      },
      redirect: 'manual'
    })
    const location = response.headers.get('location') ?? ''
    const authorizeUrl = new URL(location)

    expect(response.status).toBe(302)
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:48888/api/auth/oauth/google/callback'
    )
  })

  it('uses forwarded origin for callback URLs when no public URL is configured', async () => {
    const { baseUrl } = await listenRelay({
      loginRedirectOrigins: ['http://127.0.0.1:5180'],
      oauth: googleOauth
    })
    const redirectUri = encodeURIComponent(
      'http://127.0.0.1:5180/login/complete?redirect_uri=http%3A%2F%2F127.0.0.1%3A5180%2Fadmin%2Fusers'
    )
    const response = await requestRaw(baseUrl, `/api/auth/oauth/google/start?redirect_uri=${redirectUri}`, {
      headers: {
        'x-forwarded-host': '127.0.0.1:5180',
        'x-forwarded-proto': 'http'
      },
      redirect: 'manual'
    })
    const location = response.headers.get('location') ?? ''
    const authorizeUrl = new URL(location)

    expect(response.status).toBe(302)
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:5180/api/auth/oauth/google/callback'
    )
  })
})
