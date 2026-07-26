import { afterEach, describe, expect, it } from 'vitest'

import { VERSION } from '../src/server.js'
import { cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

afterEach(cleanupRelayFixtures)

describe('relay health', () => {
  it('returns package and immutable build metadata', async () => {
    const { baseUrl } = await listenRelay({
      buildSha: '49a96a48025febc8554f0c65cddd9a21f0cfd779'
    })

    const health = await requestJson(baseUrl, '/health')

    expect(health.response.status).toBe(200)
    expect(health.body).toEqual({
      buildSha: '49a96a48025febc8554f0c65cddd9a21f0cfd779',
      ok: true,
      version: VERSION
    })
  })

  it('keeps build metadata nullable outside release deployments', async () => {
    const { baseUrl } = await listenRelay()

    const health = await requestJson(baseUrl, '/health')

    expect(health.body.buildSha).toBeNull()
  })
})
