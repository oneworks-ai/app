import { EventEmitter } from 'node:events'

import type Koa from 'koa'
import { describe, expect, it, vi } from 'vitest'

import { createAssetOperationRegistry } from '#~/services/ai/asset-create-operation.js'

describe('asset create operation connection fence', () => {
  it('treats a response-finished socket close with an error as indeterminate', async () => {
    const response = new EventEmitter()
    const socket = new EventEmitter()
    const context = { req: { socket }, res: response } as unknown as Koa.Context
    const registry = createAssetOperationRegistry<{ ok: true }>()
    const run = vi.fn(async () => ({ ok: true as const }))

    const operationId = registry.queue(context, run)
    response.emit('finish')
    socket.emit('close', true)
    await new Promise(resolve => setImmediate(resolve))

    expect(run).not.toHaveBeenCalled()
    expect(registry.get(operationId)).toMatchObject({
      error: {
        code: 'asset_request_transport_indeterminate',
        details: { committed: 'indeterminate' }
      },
      state: 'failed'
    })
  })
})
