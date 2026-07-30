import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { assetCreateBodyMiddleware } from '#~/middlewares/asset-create-body.js'

describe('assetCreateBodyMiddleware', () => {
  it('maps a request stream read fault to explicit committed false', async () => {
    const request = Readable.from((async function*() {
      yield Buffer.from('{"kind":"rule",')
      throw new Error('request stream failed')
    })())
    const context = {
      get: vi.fn(() => ''),
      is: vi.fn(() => 'application/json'),
      method: 'POST',
      path: '/api/ai/assets',
      req: request,
      request: { body: undefined },
      set: vi.fn()
    }

    await expect(assetCreateBodyMiddleware()(context as any, vi.fn()))
      .rejects.toMatchObject({
        code: 'asset_request_read_failed',
        details: { committed: false },
        status: 500
      })
  })
})
