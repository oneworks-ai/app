import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { killChildProcess } from '../src/main/process-utils'

const createNonExitingChild = () =>
  Object.assign(new EventEmitter(), {
    exitCode: null,
    kill: vi.fn(() => true),
    pid: 4242,
    signalCode: null
  }) as unknown as ChildProcess

describe('desktop process utilities', () => {
  it('rejects when a child remains alive after TERM and KILL timeouts', async () => {
    const child = createNonExitingChild()

    await expect(killChildProcess(child, { timeoutMs: 5 }))
      .rejects.toThrow('did not exit after SIGKILL')
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
  })
})
