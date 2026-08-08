import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { PiRpcClient } from '#~/runtime/protocol/client.js'
import type { PiProcess } from '#~/runtime/protocol/types.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('pi RPC client cleanup', () => {
  it('escalates a hung process from SIGTERM to SIGKILL', async () => {
    vi.useFakeTimers()
    const process = new EventEmitter() as PiProcess
    Object.assign(process, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn((signal: NodeJS.Signals) => {
        if (signal === 'SIGKILL') process.emit('exit', null, signal)
        return true
      })
    })
    const client = new PiRpcClient(process)

    const closing = client.close()
    await vi.advanceTimersByTimeAsync(750)
    expect(process.kill).toHaveBeenCalledWith('SIGTERM')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(process.kill).toHaveBeenCalledWith('SIGKILL')
    await closing
  })
})
