import { describe, expect, it, vi } from 'vitest'

import { notifyNodeControlSocket } from '../src/platform/node-control.js'

describe('node relay control notifications', () => {
  it('contains stale socket send failures so a persisted job remains successful', () => {
    const socket = {
      send: vi.fn(() => {
        throw new Error('closed')
      }),
      terminate: vi.fn()
    }

    expect(() => notifyNodeControlSocket(socket as never)).not.toThrow()
    expect(socket.terminate).toHaveBeenCalledOnce()
  })
})
