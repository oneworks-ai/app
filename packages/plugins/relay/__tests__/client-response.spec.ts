import { describe, expect, it } from 'vitest'

import { readJsonResponse } from '../src/client/react-view.js'

describe('relay client responses', () => {
  it('uses JSON error fields instead of displaying the raw JSON body', async () => {
    await expect(readJsonResponse(
      new Response(JSON.stringify({ error: 'fetch failed' }), { status: 500 }),
      'profile'
    )).rejects.toThrow('fetch failed')
    await expect(readJsonResponse(
      new Response(JSON.stringify({ message: 'Profile service unavailable' }), { status: 503 }),
      'profile'
    )).rejects.toThrow('Profile service unavailable')
  })
})
